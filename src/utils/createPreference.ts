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
    if (!auth.currentUser)
        throw new Error('Esperá a que termine de cargar tu sesión.');
    const token = await auth.currentUser.getIdToken();
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
    const url = new URL(data.init_point);
    if (url.protocol !== 'https:' || url.hostname !== 'www.mercadopago.com.uy')
        throw new Error('Destino de pago inválido.');
    return { id: data.id, url: data.init_point };
}
