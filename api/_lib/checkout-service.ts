import { randomUUID } from 'node:crypto';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { CheckoutError, hash, parsePurchase, quotePurchase, record, type Quote } from './checkout-domain.js';
import { inventoryForQuote, readInventory, reserveProducts } from './inventory-transactions.js';
import { checkoutStatus, reconcileProducts, type CheckoutOptions } from './payment-service.js';
export type Preference = { id: string; init_point: string; collectorId: string };
export type Provider = (id: string, quote: Quote, expiresAt: number) => Promise<Preference>;
export const RESERVATION_DURATION_MS = 30 * 60 * 1000;
export async function checkout(db: Firestore, uid: string, input: unknown, provider: Provider, options: CheckoutOptions = {}) {
    const body = record(input);
    const now = options.now ?? Date.now;
    if (body.action === 'status' || body.action === 'verify') return checkoutStatus(db, uid, body, options);
    if (body.action === 'availability') {
        if (Object.keys(body).some(k => !['action', 'productIds'].includes(k)) || !Array.isArray(body.productIds) ||
            !body.productIds.length || body.productIds.length > 100 || body.productIds.some(id => typeof id !== 'string' || !id || id.length > 200 || id.includes('/'))) {
            throw new CheckoutError(400, 'INVALID_INPUT', 'Productos inválidos.');
        }
        const ids = body.productIds.filter((id): id is string => typeof id === 'string');
        await reconcileProducts(db, ids, options);
        return { checked: true };
    }
    if (Object.keys(body).some(k => !['action', 'purchase', 'key', 'quoteHash'].includes(k)) || !['quote', 'start'].includes(String(body.action))) {
        throw new CheckoutError(400, 'UPDATE_REQUIRED', 'Actualizá la página para continuar con una compra segura.');
    }
    const purchase = parsePurchase(body.purchase);
    const productIds = [...new Set(purchase.items.map(i => i.id))];
    const productRefs = productIds.map(id => db.collection('products').doc(id));
    await reconcileProducts(db, productIds, options);
    if (body.action === 'quote') {
        const docs = await db.getAll(...productRefs);
        return { quote: quotePurchase(purchase, new Map(docs.map(d => [d.id, d.data()]))) };
    }
    if (typeof body.key !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(body.key) || typeof body.quoteHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.quoteHash)) {
        throw new CheckoutError(400, 'INVALID_INTENT', 'Actualizá la cotización antes de continuar.');
    }
    const id = hash([uid, body.key]);
    const requestHash = hash([purchase, body.quoteHash]);
    const intent = db.collection('checkoutIntents').doc(id);
    const order = db.collection('orders').doc(id);
    const lock = db.collection('webCheckoutLocks').doc(hash([uid, purchase]));
    const reservationId = randomUUID();
    const acquired = await db.runTransaction(async tx => {
        const existing = await tx.get(intent);
        if (existing.exists) {
            const data = record(existing.data());
            if (data.uid !== uid) throw new CheckoutError(403, 'FORBIDDEN', 'No tenés acceso a esta compra.');
            if (data.state === 'not_started') throw new CheckoutError(409, 'INTENT_CLOSED', 'Este intento fue cerrado. Volvé a revisar la compra.');
            if (data.requestHash !== requestHash) throw new CheckoutError(409, 'INTENT_CONFLICT', 'Este intento pertenece a otro contenido. Revisá tu carrito.');
            const snapshot = await tx.get(order);
            const orderData = record(snapshot.data());
            if (orderData.commerceVersion !== 2) throw new CheckoutError(409, 'RECOVERY_REQUIRED', 'Este intento histórico requiere verificación.');
            const inventory = readInventory(orderData.inventory);
            if (data.state !== 'ready' || inventory.state !== 'reserved' || orderData.attention || inventory.expiresAt <= now() ||
                orderData.paymentStatus !== 'pending' && orderData.paymentStatus !== 'rejected' ||
                typeof data.preferenceId !== 'string' || typeof data.initPoint !== 'string') {
                throw new CheckoutError(409, 'RECOVERY_REQUIRED', 'El intento está cerrado o requiere verificación. No inicies otro pago.');
            }
            const docs = await tx.getAll(...productRefs);
            quotePurchase(purchase, new Map(docs.map(d => [d.id, d.data()])), inventory.reservationId);
            return { ready: { id, init_point: data.initPoint }, quote: null, expiresAt: inventory.expiresAt };
        }
        const lockSnapshot = await tx.get(lock);
        if (lockSnapshot.exists) {
            const previousId = lockSnapshot.data()?.orderId;
            if (typeof previousId !== 'string') throw new Error('Invalid checkout lock');
            const previous = await tx.get(db.collection('orders').doc(previousId));
            const data = record(previous.data());
            if (data.commerceVersion !== 2 || readInventory(data.inventory).state === 'reserved') {
                throw new CheckoutError(409, 'RECOVERY_REQUIRED', 'Hay un intento de esta compra pendiente de verificación. No inicies otro pago.');
            }
        }
        const docs = await tx.getAll(...productRefs);
        const quote = quotePurchase(purchase, new Map(docs.map(d => [d.id, d.data()])));
        if (quote.hash !== body.quoteHash) throw new CheckoutError(409, 'QUOTE_CHANGED', 'Cambió el precio. Revisá la cotización antes de continuar.');
        if ((await tx.get(order)).exists) throw new CheckoutError(409, 'ORDER_CONFLICT', 'Este intento requiere verificación.');
        const expiresAt = now() + RESERVATION_DURATION_MS;
        const inventory = inventoryForQuote(quote, reservationId, expiresAt);
        reserveProducts(tx, docs, inventory);
        tx.create(db.collection('webReservationOwners').doc(reservationId), { orderId: id });
        tx.set(lock, { orderId: id });
        tx.create(intent, { uid, requestHash, state: 'creating', commerceVersion: 2, quote, expiresAt, createdAt: FieldValue.serverTimestamp() });
        tx.create(order, {
            uid, commerceVersion: 2, inventory,
            items: quote.items.map(line => ({ ...line, title: { es: line.title, en: line.title }, name: line.title, priceUSD: line.unitPrice, price: line.unitPrice, variantLabel: line.variantId })),
            client: { name: purchase.shipping.name, email: purchase.shipping.email, phone: purchase.shipping.phone },
            shipping: { ...purchase.shipping, state: purchase.shipping.department, country: 'UY', cost: quote.shippingCost },
            shippingCost: quote.shippingCost, total: quote.total, currency: quote.currency, checkoutIntentId: id,
            paymentStatus: 'pending', estado: 'En proceso', status: 'En proceso', createdAt: FieldValue.serverTimestamp()
        });
        return { ready: null, quote, expiresAt };
    });
    if (acquired.ready) return acquired.ready;
    if (!acquired.quote) throw new CheckoutError(500, 'INVALID_STATE', 'No se pudo iniciar el pago.');
    // No provider request is made within a retryable transaction. Admission is durable before POST.
    try {
        const preference = await provider(id, acquired.quote, acquired.expiresAt);
        if (!preference.collectorId) throw new Error('Provider seller missing');
        await db.runTransaction(async tx => {
            const current = await tx.get(order);
            const inventory = readInventory(current.data()?.inventory);
            if (inventory.state !== 'reserved') throw new Error('Reservation changed during preference creation');
            tx.update(intent, { state: 'ready', preferenceId: preference.id, preferenceCollectorId: preference.collectorId, initPoint: preference.init_point, updatedAt: FieldValue.serverTimestamp() });
            tx.update(order, { preferenceId: preference.id, preferenceCollectorId: preference.collectorId, updatedAt: FieldValue.serverTimestamp() });
        });
        return { id, init_point: preference.init_point };
    } catch {
        // Failure of this write leaves durable creating; both states forbid a second POST.
        await intent.update({ state: 'uncertain', updatedAt: FieldValue.serverTimestamp() });
        throw new CheckoutError(409, 'RECOVERY_REQUIRED', 'No pudimos confirmar el resultado del proveedor. El intento requiere verificación; no inicies otro pago.');
    }
}
