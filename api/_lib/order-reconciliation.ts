import { randomUUID } from 'node:crypto';
import { FieldValue, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { CheckoutError, record } from './checkout-domain.js';
import { readInventory } from './inventory-transactions.js';
import { applyProviderObservation, type ReconciliationOutcome } from './payment-transitions.js';
import type { PaymentGateway } from './mercado-pago-payments.js';
import type { AdmissionContext } from './web-admission.js';
import { configuredCollector, followingCheck, initialReconciliation, knownPaymentIds, MIN_RECHECK_MS,
    PAYMENT_WINDOW_MS, PROVIDER_BUDGET_MS, readReconciliation, RECONCILIATION_LEASE_MS } from './reconciliation-policy.js';

export type { ReconciliationOutcome } from './payment-transitions.js';
export type CheckoutOptions = { now?: () => number; gateway?: PaymentGateway; collectorId?: string; admission?: AdmissionContext };
type Trigger = 'buyer' | 'sweep';

function context(order: Record<string, unknown>, collector?: string) {
    const inventory = readInventory(order.inventory);
    // Legacy prepared v2 rows already contain the exact server-generated deadline.
    // Seller recovery uses trusted server configuration, never a payment or browser field.
    const createdAt = typeof order.paymentCreatedAt === 'number' ? order.paymentCreatedAt : inventory.expiresAt - PAYMENT_WINDOW_MS;
    const expiresAt = typeof order.paymentDeadline === 'number' ? order.paymentDeadline : inventory.expiresAt;
    if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(expiresAt) || expiresAt !== inventory.expiresAt || expiresAt <= createdAt) {
        throw new Error('Invalid stored payment deadline');
    }
    const collectorId = configuredCollector(order.expectedCollectorId ?? collector);
    if (order.preferenceCollectorId !== undefined && order.preferenceCollectorId !== collectorId) throw new Error('Seller configuration mismatch');
    return { inventory, createdAt, expiresAt, collectorId };
}

async function recordFailure(db: Firestore, observed: DocumentSnapshot, now: number, leaseOwner?: string): Promise<void> {
    await db.runTransaction(async tx => {
        const latest = await tx.get(observed.ref);
        if (!latest.exists || latest.data()?.commerceVersion !== 2) return;
        const data = record(latest.data());
        const raw = data.reconciliation && typeof data.reconciliation === 'object' && !Array.isArray(data.reconciliation) ? record(data.reconciliation) : {};
        if (leaseOwner ? raw.leaseOwner !== leaseOwner : !latest.updateTime?.isEqual(observed.updateTime ?? latest.updateTime)) return;
        if (!leaseOwner && typeof raw.leaseOwner === 'string' && typeof raw.leaseUntil === 'number' &&
            Number.isSafeInteger(raw.leaseUntil) && raw.leaseUntil > now && raw.leaseUntil <= now + RECONCILIATION_LEASE_MS) return;
        const createdAt = typeof data.paymentCreatedAt === 'number' && Number.isSafeInteger(data.paymentCreatedAt) && data.paymentCreatedAt <= now ? data.paymentCreatedAt : now;
        let previous;
        try { previous = readReconciliation(data.reconciliation, createdAt); }
        catch { previous = initialReconciliation(createdAt); }
        const inventory = data.inventory && typeof data.inventory === 'object' && !Array.isArray(data.inventory) ? record(data.inventory) : {};
        tx.update(latest.ref, {
            reconciliation: followingCheck({ ...previous, lastAttemptAt: now }, String(inventory.state), now, createdAt, true),
            // Closed sales retain their commercial truth; follow-up errors remain technical.
            ...(inventory.state !== 'committed' && inventory.state !== 'released' && !data.attention ? { attention: 'reservation_reconciliation_failed' } : {}),
            lastVerificationFailedAt: FieldValue.serverTimestamp(),
        });
    });
}

export async function reconcileOrder(db: Firestore, orderId: string, options: CheckoutOptions,
    trigger: Trigger = 'buyer', paymentHint?: string): Promise<ReconciliationOutcome> {
    const now = (options.now ?? Date.now)();
    const orderRef = db.collection('orders').doc(orderId);
    const leaseOwner = randomUUID();
    let observed = await orderRef.get();
    let claimed = false;
    try {
        claimed = await db.runTransaction(async tx => {
            const snapshot = await tx.get(orderRef);
            observed = snapshot;
            if (!snapshot.exists || snapshot.data()?.commerceVersion !== 2) return false;
            const order = record(snapshot.data());
            const payment = context(order, options.collectorId);
            const previous = readReconciliation(order.reconciliation, payment.createdAt);
            // Another request can claim after this request sampled its clock. A bounded
            // future attempt defers; corrupt timestamps still produce a technical diagnosis.
            const lastAttempt = previous.lastAttemptAt ?? now;
            if (lastAttempt > now + RECONCILIATION_LEASE_MS ||
                (previous.leaseUntil ?? 0) > Math.max(now, lastAttempt) + RECONCILIATION_LEASE_MS) {
                throw new Error('Invalid future reconciliation lease');
            }
            if ((previous.leaseUntil ?? 0) > now || (previous.lastAttemptAt ?? -Infinity) + MIN_RECHECK_MS > now) return false;
            if (trigger === 'sweep' && (previous.nextCheckAt === null || previous.nextCheckAt > now)) return false;
            if (previous.failures > 0 && previous.nextCheckAt !== null && previous.nextCheckAt > now) return false;
            if (!options.gateway) throw new Error('Payment verification unavailable');
            tx.update(orderRef, {
                expectedCollectorId: payment.collectorId, paymentCreatedAt: payment.createdAt, paymentDeadline: payment.expiresAt,
                reconciliation: { ...previous, lastAttemptAt: now, leaseOwner,
                    leaseUntil: now + RECONCILIATION_LEASE_MS, nextCheckAt: now + RECONCILIATION_LEASE_MS },
            });
            return true;
        });
        if (!claimed) return 'deferred';
        observed = await orderRef.get();
        const order = record(observed.data());
        const state = readReconciliation(order.reconciliation, now);
        if (state.leaseOwner !== leaseOwner) return 'deferred';
        const payment = context(order, options.collectorId);
        if (!options.gateway) throw new Error('Payment verification unavailable');
        const observation = await options.gateway.inspectOrder({
            orderId, collectorId: payment.collectorId, createdAt: payment.createdAt, expiresAt: payment.expiresAt,
            ...(typeof order.preferenceId === 'string' ? { preferenceId: order.preferenceId } : {}),
            knownPaymentIds: knownPaymentIds(order.knownPaymentIds),
            ...(paymentHint ? { paymentHint } : {}), now, timeoutMs: PROVIDER_BUDGET_MS,
        });
        const outcome = await applyProviderObservation(db, observed, observation, now, leaseOwner);
        if (paymentHint && !observation.payments.some(p => p.id === paymentHint && p.externalReference === orderId && p.collectorId === payment.collectorId)) {
            throw new CheckoutError(409, 'PAYMENT_UNCERTAIN', 'Todavía no pudimos vincular ese pago con la compra. La reserva se conserva.');
        }
        return outcome;
    } catch (error) {
        await recordFailure(db, observed, now, claimed ? leaseOwner : undefined);
        if (error instanceof CheckoutError) throw error;
        throw new CheckoutError(503, 'RESERVATION_RECONCILIATION_FAILED', 'No pudimos verificar esta reserva. Conservamos las unidades comprometidas y volveremos a comprobarla.');
    }
}
