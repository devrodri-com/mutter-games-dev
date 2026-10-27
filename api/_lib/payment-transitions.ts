import { FieldValue, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { record } from './checkout-domain.js';
import { readInventory, releaseOwnedProducts, transitionProducts } from './inventory-transactions.js';
import type { ProviderObservation, VerifiedProviderPayment } from './mercado-pago-payments.js';
import { followingCheck, knownPaymentIds, PAYMENT_WINDOW_MS, readReconciliation, RECONCILIATION_GRACE_MS } from './reconciliation-policy.js';
import { readQuotaRelease, writeQuotaRelease } from './web-admission.js';

export type ReconciliationOutcome = 'verified' | 'unverified' | 'deferred';

const reviewStates = new Set(['pending', 'in_process', 'authorized', 'in_mediation']);
const unpaidStates = new Set(['rejected', 'cancelled']);
function paymentMatches(payment: VerifiedProviderPayment, orderId: string, order: Record<string, unknown>): boolean {
    return payment.externalReference === orderId && payment.collectorId === (order.expectedCollectorId ?? order.preferenceCollectorId) &&
        payment.currency === 'UYU' && order.currency === 'UYU' && payment.liveMode === true &&
        typeof order.total === 'number' && Number.isSafeInteger(Math.round(payment.amount * 100)) &&
        Math.round(payment.amount * 100) === Math.round(order.total * 100);
}
export async function applyProviderObservation(db: Firestore, observedOrder: DocumentSnapshot, observation: ProviderObservation,
    now: number, leaseOwner?: string): Promise<ReconciliationOutcome> {
    const orderRef = observedOrder.ref;
    return db.runTransaction(async tx => {
        const snapshot = await tx.get(orderRef);
        const order = record(snapshot.data());
        const inventory = readInventory(order.inventory);
        const createdAt = typeof order.paymentCreatedAt === 'number' ? order.paymentCreatedAt : inventory.expiresAt - PAYMENT_WINDOW_MS;
        const reconciliation = readReconciliation(order.reconciliation, createdAt);
        if (leaseOwner && reconciliation.leaseOwner !== leaseOwner) return 'deferred';
        const sameBase = snapshot.updateTime?.isEqual(observedOrder.updateTime ?? snapshot.updateTime) === true;
        const valid = observation.payments.filter(p => paymentMatches(p, orderRef.id, order));
        const intentRef = db.collection('checkoutIntents').doc(orderRef.id);
        const intent = await tx.get(intentRef);
        const movementRef = db.collection('inventoryMovements').doc(`${orderRef.id}:commit`);
        const movement = await tx.get(movementRef);
        const paymentRefs = valid.map(p => db.collection('payments').doc(p.id));
        const stored = paymentRefs.length ? await tx.getAll(...paymentRefs) : [];
        const products = await tx.getAll(...[...new Set(inventory.lines.map(line => line.productId))].map(id => db.collection('products').doc(id)));
        const quota = await readQuotaRelease(tx, db, orderRef.id);
        const lockRef = typeof order.checkoutLockId === 'string' && /^[a-f0-9]{64}$/.test(order.checkoutLockId) ?
            db.collection('webCheckoutLocks').doc(order.checkoutLockId) : null;
        const lock = lockRef ? await tx.get(lockRef) : null;
        const ownerRef = db.collection('webReservationOwners').doc(inventory.reservationId);
        const owner = await tx.get(ownerRef);
        // All reads above, including quota and ownership checks, precede any write.
        const close = () => {
            if (intent.exists) tx.update(intentRef, { state: 'closed', updatedAt: FieldValue.serverTimestamp() });
            if (lock?.data()?.orderId === orderRef.id) tx.delete(lock.ref);
            if (owner.data()?.orderId === orderRef.id) tx.delete(ownerRef);
            writeQuotaRelease(tx, quota);
        };
        // A buyer-controlled hint never makes a canonically foreign payment a permanent dependency.
        // Unresolved search/known IDs remain tracked; only a successful GET can disprove ownership.
        const foreignIds = new Set(observation.payments.filter(p => p.externalReference !== orderRef.id ||
            p.collectorId !== (order.expectedCollectorId ?? order.preferenceCollectorId)).map(p => p.id));
        const seenIds = [...new Set([...knownPaymentIds(order.knownPaymentIds), ...observation.observedPaymentIds])].filter(id => !foreignIds.has(id));
        const overflow = seenIds.length > 100 || observation.capacityExceeded === true || order.paymentTrackingOverflow === true;
        const resolvedAllKnown = seenIds.every(id => observation.payments.some(p => p.id === id));
        const partial = !observation.searchComplete || Boolean(observation.verificationError) || overflow ||
            observation.historyWindowExceeded === true || !resolvedAllKnown;
        const commercialAttention = typeof order.attention === 'string' && order.attention !== 'reservation_reconciliation_failed' ? order.attention : undefined;
        const cleanAttention = commercialAttention ?? FieldValue.delete();
        const retainedCommercial = commercialAttention && !['awaiting_provider_evidence', 'payment_tracking_capacity_exceeded',
            'provider_history_window_exceeded'].includes(commercialAttention) ? commercialAttention : undefined;
        const update: Record<string, unknown> = {
            ...(!partial ? { lastVerifiedAt: FieldValue.serverTimestamp() } : { lastVerificationFailedAt: FieldValue.serverTimestamp() }),
            knownPaymentIds: seenIds.slice(0, 100), ...(overflow ? { paymentTrackingOverflow: true } : {}),
        };
        const finish = (state: string, extra: Record<string, unknown>): ReconciliationOutcome => {
            tx.update(orderRef, { ...update, reconciliation: followingCheck(reconciliation, state, now, createdAt, partial), ...extra });
            return partial ? 'unverified' : 'verified';
        };
        let reason: string | undefined;
        if (order.commerceVersion !== 2 || observation.collectorId !== (order.expectedCollectorId ?? order.preferenceCollectorId) ||
            observation.preferenceId !== order.preferenceId) reason = 'payment_identity_mismatch';
        if (stored.some(p => p.exists && p.data()?.orderId !== orderRef.id)) reason = 'payment_already_linked';
        if (reason) return finish(inventory.state, { attention: reason });
        // Foreign/wrong-amount payments never gain ownership of a ledger ID or a valid-payment state.
        const identityMismatch = valid.length !== observation.payments.length;
        const effective = valid.map((payment, index) => {
            const previous = stored[index].data();
            const newer = typeof previous?.providerUpdatedAt === 'number' && previous.providerUpdatedAt > payment.updatedAt;
            const preserveApproved = previous?.status === 'approved' && unpaidStates.has(payment.status);
            const status = (newer || preserveApproved) && typeof previous?.status === 'string' ? previous.status : payment.status;
            if (!newer && !preserveApproved) tx.set(paymentRefs[index], {
                orderId: orderRef.id, status: payment.status, statusDetail: payment.statusDetail,
                providerUpdatedAt: payment.updatedAt, amount: payment.amount, currency: payment.currency,
                collectorId: payment.collectorId, liveMode: payment.liveMode, verifiedAt: FieldValue.serverTimestamp(),
            });
            return { ...payment, status };
        });
        const approved = effective.filter(p => p.status === 'approved').sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
        const inReview = effective.some(p => reviewStates.has(p.status));
        const exceptional = effective.some(p => !reviewStates.has(p.status) && !unpaidStates.has(p.status) && p.status !== 'approved');
        const selected = approved[0];
        if (inventory.state === 'committed' || movement.exists) {
            if (inventory.state !== 'committed' || !movement.exists) reason = 'inventory_ledger_mismatch';
            if (approved.some(p => p.id !== order.approvedPaymentId)) reason = 'duplicate_approved_payment';
            if (exceptional) reason = 'payment_requires_attention';
            if (identityMismatch) reason = 'payment_identity_mismatch';
            return finish(inventory.state, { ...(reason ? { attention: reason } : !partial ? { attention: cleanAttention } : {}) });
        }
        if (selected) {
            let writes: ReturnType<typeof transitionProducts>;
            try { writes = transitionProducts(products, inventory, true); }
            catch {
                // A late paid basket is all-or-nothing. Clear only its remaining holds, never another buyer's.
                for (const { snapshot: product, update: change } of releaseOwnedProducts(products, inventory)) tx.update(product.ref, change);
                close();
                return finish('released', { inventory: { ...inventory, state: 'released', releasedAt: now },
                    paymentStatus: 'approved', approvedPaymentId: selected.id, attention: 'approved_without_stock' });
            }
            for (const { snapshot: product, update: change } of writes) tx.update(product.ref, change);
            tx.create(movementRef, { orderId: orderRef.id, paymentId: selected.id, reservationId: inventory.reservationId,
                kind: 'web_sale', lines: inventory.lines, createdAt: FieldValue.serverTimestamp() });
            close();
            return finish('committed', { inventory: { ...inventory, state: 'committed', committedAt: now }, paymentStatus: 'approved', approvedPaymentId: selected.id,
                attention: approved.length > 1 ? 'duplicate_approved_payment' : identityMismatch ? 'payment_identity_mismatch' : retainedCommercial ?? FieldValue.delete() });
        }
        if (order.paymentStatus === 'approved' || typeof order.approvedPaymentId === 'string') {
            return finish(inventory.state, { attention: order.attention ?? 'approved_payment_requires_attention' });
        }
        if (inventory.state === 'released') {
            return finish('released', { ...(inReview || exceptional ? { attention: 'late_payment_requires_attention' } : {}) });
        }
        if (inReview) {
            return finish('reserved', { paymentStatus: 'in_review', attention: retainedCommercial ?? (identityMismatch ? 'payment_identity_mismatch' : partial ? 'reservation_reconciliation_failed' : FieldValue.delete()) });
        }
        if (!exceptional && !identityMismatch && !partial && !observation.historyWindowExceeded && resolvedAllKnown && sameBase &&
            now >= inventory.expiresAt + RECONCILIATION_GRACE_MS && effective.every(p => unpaidStates.has(p.status))) {
            let writes: ReturnType<typeof transitionProducts>;
            try { writes = transitionProducts(products, inventory, false); }
            catch { return finish('reserved', { attention: 'reservation_ledger_mismatch' }); }
            for (const { snapshot: product, update: change } of writes) tx.update(product.ref, change);
            close();
            return finish('released', { inventory: { ...inventory, state: 'released', releasedAt: now }, paymentStatus: 'expired',
                attention: identityMismatch ? 'payment_identity_mismatch' : retainedCommercial ?? FieldValue.delete() });
        }
        return finish('reserved', {
            ...(effective.length && effective.every(p => unpaidStates.has(p.status)) ? { paymentStatus: 'rejected' } : {}),
            attention: overflow ? 'payment_tracking_capacity_exceeded' : observation.historyWindowExceeded ? 'provider_history_window_exceeded' :
                partial ? 'reservation_reconciliation_failed' : identityMismatch ? 'payment_identity_mismatch' :
                    exceptional ? 'payment_requires_attention' : now >= inventory.expiresAt ? 'awaiting_provider_evidence' : FieldValue.delete(),
        });
    });
}
