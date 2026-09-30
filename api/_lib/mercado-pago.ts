import { record, type Quote } from './checkout-domain.js';
import type { Preference } from './checkout-service.js';
import { mercadoPagoNumericId } from './mercado-pago-payments.js';
import { PAYMENT_WINDOW_MS } from './reconciliation-policy.js';

export async function createMercadoPagoPreference(id: string, quote: Quote, expiresAt: number, expectedCollectorId: string): Promise<Preference> {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token)
        throw new Error('Payment configuration unavailable');
    const collectorId = mercadoPagoNumericId(expectedCollectorId);
    const now = Date.now();
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id) || !Number.isSafeInteger(expiresAt) || expiresAt % 1000 !== 0 ||
        expiresAt <= now || expiresAt > now + PAYMENT_WINDOW_MS || quote.currency !== 'UYU')
        throw new Error('Invalid payment preference lifetime');
    const items = quote.items.map(item => ({ id: item.id, title: item.title, quantity: item.quantity, unit_price: item.unitPrice, currency_id: quote.currency }));
    if (quote.shippingCost)
        items.push({ id: 'shipping', title: 'Envío', quantity: 1, unit_price: quote.shippingCost, currency_id: quote.currency });
    const returnUrl = `https://www.muttergames.com/success?orderId=${encodeURIComponent(id)}`;
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            items,
            external_reference: id,
            auto_return: 'approved',
            payment_methods: {
                excluded_payment_types: [{ id: 'ticket' }],
                excluded_payment_methods: [{ id: 'abitab' }, { id: 'redpagos' }],
            },
            expires: true,
            expiration_date_from: new Date(expiresAt - PAYMENT_WINDOW_MS).toISOString(),
            expiration_date_to: new Date(expiresAt).toISOString(),
            back_urls: { success: returnUrl, pending: returnUrl, failure: returnUrl },
        }),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
    });
    if (!response.ok)
        throw new Error('Provider outcome requires verification');
    const result = record(await response.json());
    if (typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(result.id) || typeof result.init_point !== 'string' || result.external_reference !== id
        || mercadoPagoNumericId(result.collector_id) !== collectorId || result.expires !== undefined && result.expires !== true
        || typeof result.expiration_date_to !== 'string' || Math.floor(Date.parse(result.expiration_date_to) / 1000) !== expiresAt / 1000)
        throw new Error('Unverified preference response');
    const url = new URL(result.init_point);
    if (url.protocol !== 'https:' || url.hostname !== 'www.mercadopago.com.uy' || url.username || url.password || url.port)
        throw new Error('Unverified provider URL');
    return { id: result.id, init_point: result.init_point, collectorId };
}
