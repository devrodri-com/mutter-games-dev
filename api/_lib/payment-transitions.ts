import { FieldValue, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { record } from './checkout-domain.js';
import { readInventory, transitionProducts } from './inventory-transactions.js';
import type { ProviderObservation, VerifiedProviderPayment } from './mercado-pago-payments.js';

const reviewStates = new Set(['pending', 'in_process', 'authorized']);
const terminalUnpaidStates = new Set(['rejected', 'cancelled']);
function paymentMatches(payment: VerifiedProviderPayment, orderId: string, order: Record<string, unknown>): boolean {
    return payment.externalReference === orderId && payment.collectorId === order.preferenceCollectorId &&
        payment.currency === 'UYU' && order.currency === 'UYU' && payment.liveMode === true &&
        typeof order.total === 'number' && Number.isSafeInteger(Math.round(payment.amount * 100)) &&
        Math.round(payment.amount * 100) === Math.round(order.total * 100);
}
export async function applyProviderObservation(db: Firestore, observedOrder: DocumentSnapshot, observation: ProviderObservation, now: number): Promise<void> {
    const orderRef = observedOrder.ref;
    await db.runTransaction(async tx => {
        const snapshot = await tx.get(orderRef);
        const order = record(snapshot.data());
        const inventory = readInventory(order.inventory);
        const intentRef = db.collection('checkoutIntents').doc(orderRef.id);
        const intent = await tx.get(intentRef);
        const movementRef = db.collection('inventoryMovements').doc(`${orderRef.id}:commit`);
        const movement = await tx.get(movementRef);
        const paymentRefs = observation.payments.map(p => db.collection('payments').doc(p.id));
        const storedPayments = paymentRefs.length ? await tx.getAll(...paymentRefs) : [];
        const productRefs = [...new Set(inventory.lines.map(line => line.productId))].map(id => db.collection('products').doc(id));
        const products = await tx.getAll(...productRefs);
        const update: Record<string, unknown> = { lastVerifiedAt: FieldValue.serverTimestamp() };
        let reason: string | undefined;
        if (order.commerceVersion !== 2 || observation.preferenceId !== order.preferenceId || observation.collectorId !== order.preferenceCollectorId ||
            observation.payments.some(p => !paymentMatches(p, orderRef.id, order))) reason = 'payment_identity_mismatch';
        if (storedPayments.some(p => p.exists && p.data()?.orderId !== orderRef.id)) reason = 'payment_already_linked';
        if (reason) {
            tx.update(orderRef, { ...update, attention: reason });
            return;
        }
        // Only whitelisted provider fields are persisted; payer/card/customer data never enter the ledger.
        const effective = observation.payments.map((payment, index) => {
            const previous = storedPayments[index].data();
            const newer = typeof previous?.providerUpdatedAt === 'number' && previous.providerUpdatedAt > payment.updatedAt;
            const preserveApproved = previous?.status === 'approved' && terminalUnpaidStates.has(payment.status);
            const status = (newer || preserveApproved) && typeof previous?.status === 'string' ? previous.status : payment.status;
            if (!newer && !preserveApproved) tx.set(paymentRefs[index], {
                orderId: orderRef.id, status: payment.status, statusDetail: payment.statusDetail,
                providerUpdatedAt: payment.updatedAt, amount: payment.amount, currency: payment.currency,
                collectorId: payment.collectorId, liveMode: payment.liveMode, verifiedAt: FieldValue.serverTimestamp()
            });
            return { ...payment, status };
        });
        const approved = effective.filter(p => p.status === 'approved').sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
        const inReview = effective.some(p => reviewStates.has(p.status));
        const exceptional = effective.some(p => !reviewStates.has(p.status) && !terminalUnpaidStates.has(p.status) && p.status !== 'approved');
        const selected = approved[0];
        if (inventory.state === 'committed' || movement.exists) {
            if (inventory.state !== 'committed' || !movement.exists) reason = 'inventory_ledger_mismatch';
            if (approved.some(p => p.id !== order.approvedPaymentId)) reason = 'duplicate_approved_payment';
            if (exceptional) reason = 'payment_requires_attention';
            tx.update(orderRef, { ...update, ...(reason ? { attention: reason } : {}) });
            return;
        }
        if (selected) {
            let writes: ReturnType<typeof transitionProducts>;
            try { writes = transitionProducts(products, inventory, true); }
            catch {
                tx.update(orderRef, { ...update, paymentStatus: 'approved', approvedPaymentId: selected.id, attention: 'approved_without_stock' });
                return;
            }
            for (const { snapshot: product, update: change } of writes) tx.update(product.ref, change);
            tx.create(movementRef, { orderId: orderRef.id, paymentId: selected.id, reservationId: inventory.reservationId, kind: 'web_sale', lines: inventory.lines, createdAt: FieldValue.serverTimestamp() });
            tx.update(intentRef, { state: 'closed', updatedAt: FieldValue.serverTimestamp() });
            tx.update(orderRef, { ...update, inventory: { ...inventory, state: 'committed' }, paymentStatus: 'approved', approvedPaymentId: selected.id,
                    attention: approved.length > 1 ? 'duplicate_approved_payment' : FieldValue.delete() });
            return;
        }
        if (order.paymentStatus === 'approved' || typeof order.approvedPaymentId === 'string') {
            tx.update(orderRef, { ...update, attention: 'approved_payment_requires_attention' });
            return;
        }
        if (inventory.state === 'released') {
            // A late nonterminal payment must not silently reacquire or release another buyer's units.
            tx.update(orderRef, { ...update, ...(inReview || exceptional ? { attention: 'late_payment_requires_attention' } : {}) });
            return;
        }
        if (inReview) {
            tx.update(orderRef, { ...update, paymentStatus: 'in_review', attention: FieldValue.delete() });
            return;
        }
        const sameObservationBase = snapshot.updateTime?.isEqual(observedOrder.updateTime ?? snapshot.updateTime) === true;
        if (!exceptional && observation.terminalUnpaid && now >= inventory.expiresAt && intent.data()?.state === 'ready' && sameObservationBase &&
            effective.every(p => terminalUnpaidStates.has(p.status))) {
            let writes: ReturnType<typeof transitionProducts>;
            try { writes = transitionProducts(products, inventory, false); }
            catch {
                tx.update(orderRef, { ...update, attention: 'reservation_ledger_mismatch' });
                return;
            }
            for (const { snapshot: product, update: change } of writes) tx.update(product.ref, change);
            tx.update(orderRef, { ...update, inventory: { ...inventory, state: 'released' }, paymentStatus: 'expired', attention: FieldValue.delete() });
            tx.update(intentRef, { state: 'closed', updatedAt: FieldValue.serverTimestamp() });
            return;
        }
        tx.update(orderRef, { ...update,
            ...(effective.length && effective.every(p => terminalUnpaidStates.has(p.status)) ? { paymentStatus: 'rejected' } : {}),
            attention: exceptional ? 'payment_requires_attention' : now >= inventory.expiresAt ? 'awaiting_provider_evidence' : FieldValue.delete() });
    });
}
