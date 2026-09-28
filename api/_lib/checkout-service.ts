import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { CheckoutError, hash, parsePurchase, quotePurchase, record, type Quote } from './checkout-domain.js';
export type Preference = {
    id: string;
    init_point: string;
};
export type Provider = (id: string, quote: Quote) => Promise<Preference>;
export async function checkout(db: Firestore, uid: string, input: unknown, provider: Provider) {
    const body = record(input);
    if (Object.keys(body).some(k => !['action', 'purchase', 'key', 'quoteHash'].includes(k)))
        throw new CheckoutError(400, 'UPDATE_REQUIRED', 'Actualizá la página para continuar.');
    if (body.action !== 'quote' && body.action !== 'start')
        throw new CheckoutError(400, 'UPDATE_REQUIRED', 'Actualizá la página para continuar.');
    const purchase = parsePurchase(body.purchase);
    const productRefs = [...new Set(purchase.items.map(i => i.id))].map(id => db.collection('products').doc(id));
    if (body.action === 'quote') {
        const docs = await db.getAll(...productRefs);
        return { quote: quotePurchase(purchase, new Map(docs.map(d => [d.id, d.data()]))) };
    }
    if (typeof body.key !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(body.key) || typeof body.quoteHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.quoteHash))
        throw new CheckoutError(400, 'INVALID_INTENT', 'Actualizá la cotización antes de continuar.');
    const id = hash([uid, body.key]);
    const requestHash = hash([purchase, body.quoteHash]);
    const intent = db.collection('checkoutIntents').doc(id);
    const order = db.collection('orders').doc(id);
    const acquired = await db.runTransaction(async (tx) => {
        const existing = await tx.get(intent);
        if (existing.exists) {
            const data = record(existing.data());
            if (data.uid !== uid)
                throw new CheckoutError(403, 'FORBIDDEN', 'No tenés acceso a esta compra.');
            if (data.requestHash !== requestHash)
                throw new CheckoutError(409, 'INTENT_CONFLICT', 'Este intento pertenece a otro contenido. Revisá tu carrito.');
            if (data.state === 'ready' && typeof data.preferenceId === 'string' && typeof data.initPoint === 'string')
                return { ready: { id, init_point: data.initPoint }, quote: null };
            throw new CheckoutError(409, 'RECOVERY_REQUIRED', 'El intento está en proceso o requiere verificación. No inicies otro pago.');
        }
        const docs = await tx.getAll(...productRefs);
        const quote = quotePurchase(purchase, new Map(docs.map(d => [d.id, d.data()])));
        if (quote.hash !== body.quoteHash)
            throw new CheckoutError(409, 'QUOTE_CHANGED', 'Cambió el precio o la disponibilidad. Revisá la cotización antes de continuar.');
        if ((await tx.get(order)).exists)
            throw new CheckoutError(409, 'ORDER_CONFLICT', 'Este intento requiere verificación.');
        tx.create(intent, { uid, requestHash, state: 'creating', quote, createdAt: FieldValue.serverTimestamp() });
        tx.create(order, {
            uid,
            items: quote.items.map(line => ({...line, title:{es:line.title,en:line.title}, name:line.title, priceUSD:line.unitPrice, price:line.unitPrice, variantLabel:line.variantId})),
            client: {name:purchase.shipping.name,email:purchase.shipping.email,phone:purchase.shipping.phone},
            shipping: {...purchase.shipping,state:purchase.shipping.department,country:'UY',cost:quote.shippingCost},
            shippingCost: quote.shippingCost,
            total: quote.total, currency: quote.currency, checkoutIntentId: id,
            paymentStatus: 'pending', estado: 'En proceso', status:'En proceso',
            createdAt: FieldValue.serverTimestamp()
        });
        return { ready: null, quote };
    });
    if (acquired.ready)
        return acquired.ready;
    if (!acquired.quote)
        throw new CheckoutError(500, 'INVALID_STATE', 'No se pudo iniciar el pago.');
    // Never call the provider from a retryable Firestore transaction. A crashed/uncertain call stays locked.
    try {
        const preference = await provider(id, acquired.quote);
        await db.runTransaction(async (tx) => {
            tx.update(intent, { state: 'ready', preferenceId: preference.id, initPoint: preference.init_point, updatedAt: FieldValue.serverTimestamp() });
            tx.update(order, { preferenceId: preference.id, updatedAt: FieldValue.serverTimestamp() });
        });
        return { id, init_point: preference.init_point };
    }
    catch {
        // Keep durable creating if this write also fails; neither state permits a second provider POST.
        await intent.update({ state: 'uncertain', updatedAt: FieldValue.serverTimestamp() });
        throw new CheckoutError(409, 'RECOVERY_REQUIRED', 'No pudimos confirmar el resultado del proveedor. El intento requiere verificación; no inicies otro pago.');
    }
}
