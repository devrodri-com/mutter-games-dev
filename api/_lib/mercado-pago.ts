import { record, type Quote } from './checkout-domain.js';
import type { Preference } from './checkout-service.js';
export async function createMercadoPagoPreference(id: string, quote: Quote): Promise<Preference> {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token)
        throw new Error('Payment configuration unavailable');
    const items = quote.items.map(item => ({ id: item.id, title: item.title, quantity: item.quantity, unit_price: item.unitPrice, currency_id: quote.currency }));
    if (quote.shippingCost)
        items.push({ id: 'shipping', title: 'Envío', quantity: 1, unit_price: quote.shippingCost, currency_id: quote.currency });
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ items, external_reference: id }), signal: AbortSignal.timeout(15000) });
    if (!response.ok)
        throw new Error('Provider outcome requires verification');
    const result = record(await response.json());
    if (typeof result.id !== 'string' || typeof result.init_point !== 'string' || result.external_reference !== id)
        throw new Error('Unverified preference response');
    const url = new URL(result.init_point);
    if (url.protocol !== 'https:' || url.hostname !== 'www.mercadopago.com.uy')
        throw new Error('Unverified provider URL');
    return { id: result.id, init_point: result.init_point };
}
