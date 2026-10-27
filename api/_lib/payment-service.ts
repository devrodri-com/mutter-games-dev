import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { CheckoutError, hash, parsePurchase, quotePurchase, record } from './checkout-domain.js';
import { readInventory } from './inventory-transactions.js';
import { parseReservations } from '../../src/domain/webInventory.js';
export type { CheckoutOptions } from './order-reconciliation.js';
import { reconcileOrder, type CheckoutOptions } from './order-reconciliation.js';
export async function reconcileProducts(db: Firestore, productIds: string[]): Promise<void> {
    // Availability depends only on the authoritative ledger. Provider failures concern their own order.
    try {
        const products = await db.getAll(...productIds.map(id => db.collection('products').doc(id)));
        for (const product of products) parseReservations(product.data()?.webReservations);
    } catch {
        throw new CheckoutError(503, 'INVENTORY_READ_FAILED', 'No pudimos comprobar la disponibilidad. Intentá nuevamente.');
    }
}
async function statusView(db: Firestore, id: string, order: Record<string, unknown>, intent: Record<string, unknown>, now: number) {
    if (order.commerceVersion !== 2) return { id, inventoryState: 'attention' as const, paymentStatus: 'historical_unverified', reservedUntil: 0, canRetry: false };
    const inventory = readInventory(order.inventory);
    let reusable = inventory.state === 'reserved' && inventory.expiresAt > now && intent.state === 'ready' && !order.attention &&
        ['pending', 'rejected'].includes(String(order.paymentStatus)) && typeof intent.initPoint === 'string';
    if (reusable) {
        const shipping = record(order.shipping);
        if (!Array.isArray(order.items)) throw new CheckoutError(409, 'RECOVERY_REQUIRED', 'Esta compra requiere verificación.');
        const purchase = parsePurchase({
            items: order.items.map(raw => {
                const item = record(raw);
                return { id: item.id, variantId: item.variantId, quantity: item.quantity, customName: item.customName, customNumber: item.customNumber };
            }),
            shipping: {
                pickup: shipping.pickup, department: shipping.department, name: shipping.name,
                address: shipping.address, city: shipping.city, postalCode: shipping.postalCode,
                phone: shipping.phone, email: shipping.email,
            },
        });
        const products = await db.getAll(...[...new Set(purchase.items.map(item => item.id))].map(productId => db.collection('products').doc(productId)));
        try {
            // Reuse the same catalog validation as start; the buyer retains their own held units.
            quotePurchase(purchase, new Map(products.map(product => [product.id, product.data()])), inventory.reservationId);
        } catch (error) {
            if (!(error instanceof CheckoutError)) throw error;
            reusable = false;
        }
    }
    const confirmed = inventory.state === 'committed' && order.paymentStatus === 'approved';
    const technicalAttention = order.attention === 'reservation_reconciliation_failed';
    const needsAttention = Boolean(order.attention) && !(confirmed && technicalAttention);
    const reconciliation = record(order.reconciliation ?? {});
    return { id, inventoryState: needsAttention ? 'attention' as const : inventory.state, paymentStatus: String(order.paymentStatus),
        ...(reconciliation.lastError || technicalAttention ? { verificationPending: true } : {}),
        reservedUntil: inventory.expiresAt, canRetry: inventory.state === 'released' && !order.attention && order.paymentStatus !== 'approved',
        ...(reusable ? { init_point: String(intent.initPoint) } : {}) };
}
export async function checkoutStatus(db: Firestore, uid: string, body: Record<string, unknown>, options: CheckoutOptions) {
    const isVerify = body.action === 'verify';
    const allowed = isVerify ? ['action', 'orderId', 'paymentId'] : ['action', 'orderId', 'key'];
    if (Object.keys(body).some(key => !allowed.includes(key)) || Boolean(body.orderId) === Boolean(body.key) ||
        body.orderId !== undefined && (typeof body.orderId !== 'string' || !/^[a-f0-9]{64}$/.test(body.orderId)) ||
        body.key !== undefined && (typeof body.key !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(body.key)) ||
        isVerify && (typeof body.paymentId !== 'string' || !/^\d{1,30}$/.test(body.paymentId))) {
        throw new CheckoutError(400, 'INVALID_INPUT', 'Intento de compra inválido.');
    }
    const id = typeof body.orderId === 'string' ? body.orderId : hash([uid, body.key]);
    const orderRef = db.collection('orders').doc(id);
    const intentRef = db.collection('checkoutIntents').doc(id);
    const resolved = await db.runTransaction(async tx => {
        const [snapshot, intent] = await tx.getAll(orderRef, intentRef);
        if (body.key && !snapshot.exists && !intent.exists) {
            // Close an unadmitted key atomically: a delayed start cannot race this recovery response.
            tx.create(intentRef, { uid, commerceVersion: 2, state: 'not_started', createdAt: FieldValue.serverTimestamp() });
            return null;
        }
        if (body.key && !snapshot.exists && intent.data()?.uid === uid && intent.data()?.state === 'not_started') return null;
        if (!snapshot.exists || !intent.exists) throw new CheckoutError(404, 'ORDER_NOT_FOUND', 'No encontramos esta compra.');
        return { snapshot, intent };
    });
    if (!resolved) return { id, inventoryState: 'released' as const, paymentStatus: 'not_started', reservedUntil: 0, canRetry: true };
    const { snapshot, intent } = resolved;
    if (snapshot.data()?.uid !== uid || intent.data()?.uid !== uid) throw new CheckoutError(403, 'FORBIDDEN', 'No tenés acceso a esta compra.');
    let technicalFailure = false;
    try {
        await reconcileOrder(db, id, options, 'buyer', isVerify && typeof body.paymentId === 'string' ? body.paymentId : undefined);
    } catch (error) {
        if (!(error instanceof CheckoutError) || error.code !== 'RESERVATION_RECONCILIATION_FAILED') throw error;
        // A follow-up outage cannot invalidate a previously verified, durably committed sale.
        const preserved = record((await orderRef.get()).data());
        if (readInventory(preserved.inventory).state !== 'committed' || preserved.paymentStatus !== 'approved') throw error;
        technicalFailure = true;
    }
    const [latest, latestIntent] = await db.getAll(orderRef, intentRef);
    const view = await statusView(db, id, record(latest.data()), record(latestIntent.data()), (options.now ?? Date.now)());
    return { ...view, ...(technicalFailure ? { verificationPending: true } : {}) };
}
