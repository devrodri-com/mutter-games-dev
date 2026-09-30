import { auth } from '../firebase';
import type { CartItem } from '../data/types';
import type { ShippingData } from '../context/CartContext';
export type CheckoutQuote = {
    hash: string;
    total: number;
    shippingCost: number;
    currency: string;
    items: {
        id: string;
        variantId: string;
        quantity: number;
        unitPrice: number;
        stock: number;
        title: string;
    }[];
};
export class CheckoutRequestError extends Error {
    constructor(message: string, public code: string) { super(message); }
}
export function purchaseInput(items: CartItem[], shipping: ShippingData, pickup: boolean) {
    return { items: items.map(i => ({ id: i.id, variantId: i.variantId ?? '', quantity: i.quantity, customName: i.customName ?? '', customNumber: i.customNumber ?? '' })), shipping: { pickup, department: shipping.state, name: shipping.name, address: [shipping.address, shipping.address2].filter(Boolean).join(', '), city: shipping.city, postalCode: shipping.postalCode, phone: shipping.phone, email: shipping.email } };
}
async function request(body: unknown): Promise<Record<string, unknown>> {
    const user = auth.currentUser;
    if (!user)
        throw new Error('Esperá a que termine de cargar tu sesión.');
    const token = await user.getIdToken();
    if (auth.currentUser?.uid !== user.uid)
        throw new Error('Cambió la sesión. Revisá la compra antes de continuar.');
    const response = await fetch('/api/create-mp-preference', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error('Respuesta de compra inválida.');
    const result = data as Record<string, unknown>;
    if (!response.ok)
        throw new CheckoutRequestError(typeof result.error === 'string' ? result.error : 'No se pudo verificar la compra.', typeof result.code === 'string' ? result.code : 'UNAVAILABLE');
    return result;
}
export async function requestQuote(purchase: ReturnType<typeof purchaseInput>): Promise<CheckoutQuote> {
    const data = await request({ action: 'quote', purchase });
    const q = data.quote;
    if (!q || typeof q !== 'object' || !('hash' in q) || typeof q.hash !== 'string' || !('items' in q) || !Array.isArray(q.items) || !('total' in q) || typeof q.total !== 'number' || !('shippingCost' in q) || typeof q.shippingCost !== 'number' || !('currency' in q) || q.currency !== 'UYU')
        throw new Error('Cotización inválida.');
    const items = q.items.map((i: unknown) => { if (!i || typeof i !== 'object' || !('id' in i) || typeof i.id !== 'string' || !('variantId' in i) || typeof i.variantId !== 'string' || !('quantity' in i) || typeof i.quantity !== 'number' || !('unitPrice' in i) || typeof i.unitPrice !== 'number' || !('stock' in i) || typeof i.stock !== 'number' || !('title' in i) || typeof i.title !== 'string')
        throw new Error('Cotización inválida.'); return { id: i.id, variantId: i.variantId, quantity: i.quantity, unitPrice: i.unitPrice, stock: i.stock, title: i.title }; });
    return { hash: q.hash, items, total: q.total, shippingCost: q.shippingCost, currency: q.currency };
}
export async function startCheckout(purchase: ReturnType<typeof purchaseInput>, quoteHash: string, key: string) {
    const data = await request({ action: 'start', purchase, quoteHash, key });
    if (typeof data.id !== 'string' || typeof data.init_point !== 'string')
        throw new Error('El intento requiere verificación.');
    return { id: data.id, url: paymentUrl(data.init_point) };
}

function paymentUrl(value: string): string {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.mercadopago.com.uy' || url.username || url.password || url.port)
        throw new Error('Destino de pago inválido.');
    return value;
}
export type CheckoutStatus = {
    id: string;
    inventoryState: 'reserved' | 'committed' | 'released' | 'attention';
    paymentStatus: string;
    reservedUntil: number;
    canRetry: boolean;
    verificationPending?: boolean;
    url?: string;
};
function checkoutStatus(data: Record<string, unknown>): CheckoutStatus {
    if (typeof data.id !== 'string' || !data.id.trim() ||
        typeof data.paymentStatus !== 'string' || typeof data.reservedUntil !== 'number' || !Number.isFinite(data.reservedUntil) ||
        typeof data.canRetry !== 'boolean') throw new Error('No pudimos verificar el estado de la compra.');
    if (data.verificationPending !== undefined && typeof data.verificationPending !== 'boolean') throw new Error('Estado de verificación inválido.');
    const inventoryState = data.inventoryState;
    if (inventoryState !== 'reserved' && inventoryState !== 'committed' && inventoryState !== 'released' && inventoryState !== 'attention')
        throw new Error('Estado de inventario inválido.');
    if (data.canRetry && inventoryState !== 'released') throw new Error('La compra requiere verificación.');
    if (data.init_point !== undefined && typeof data.init_point !== 'string') throw new Error('Destino de pago inválido.');
    return { ...(typeof data.verificationPending === 'boolean' ? { verificationPending: data.verificationPending } : {}), id: data.id, inventoryState, paymentStatus: data.paymentStatus, reservedUntil: data.reservedUntil, canRetry: data.canRetry,
        ...(typeof data.init_point === 'string' ? { url: paymentUrl(data.init_point) } : {}) };
}
export async function requestCheckoutStatus(identity: { key: string } | { orderId: string }): Promise<CheckoutStatus> {
    return checkoutStatus(await request({ action: 'status', ...identity }));
}
export async function verifyCheckoutPayment(orderId: string, paymentId: string): Promise<CheckoutStatus> {
    return checkoutStatus(await request({ action: 'verify', orderId, paymentId }));
}
export async function refreshAvailability(productIds: string[]): Promise<void> {
    const data = await request({ action: 'availability', productIds });
    if (data.checked !== true) throw new Error('No pudimos verificar la disponibilidad.');
}
