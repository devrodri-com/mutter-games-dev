import type { IncomingHttpHeaders } from 'node:http';
import { CheckoutError, record, type Quote } from './checkout-domain.js';
import type { Preference, Provider } from './checkout-service.js';
import { mercadoPagoNumericId } from './mercado-pago-payments.js';
import { PAYMENT_WINDOW_MS } from './reconciliation-policy.js';

type PaymentReturnOrigin = 'https://muttergames.com' | 'https://www.muttergames.com';
function isReturnOrigin(value: unknown): value is PaymentReturnOrigin {
    return value === 'https://muttergames.com' || value === 'https://www.muttergames.com';
}
function invalidReturnOrigin(): never {
    throw new CheckoutError(400, 'RETURN_ORIGIN_UNAVAILABLE', 'No pudimos validar el sitio de retorno del pago. Volvé a abrir la tienda para continuar.');
}

/** Validate before checkout can reserve units. Forwarded headers never select a
 * destination; the same allowlisted Origin and Host must identify the browser. */
export function mercadoPagoProviderForRequest(headers: IncomingHttpHeaders, rawHeaders?: readonly string[]): Provider {
    const origin = headers.origin;
    if (!isReturnOrigin(origin) || headers.host !== origin.slice('https://'.length)) invalidReturnOrigin();
    for (const name of ['origin', 'host'] as const) {
        const names = Object.keys(headers).filter(key => key.toLowerCase() === name);
        if (names.length !== 1 || names[0] !== name) invalidReturnOrigin();
        if (rawHeaders) {
            if (rawHeaders.length % 2 !== 0) invalidReturnOrigin();
            let count = 0;
            for (let index = 0; index < rawHeaders.length; index += 2) {
                if (rawHeaders[index].toLowerCase() === name) {
                    count++;
                    if (rawHeaders[index + 1] !== headers[name]) invalidReturnOrigin();
                }
            }
            if (count !== 1) invalidReturnOrigin();
        }
    }
    return (id, quote, expiresAt, collectorId) => createMercadoPagoPreference(id, quote, expiresAt, collectorId, origin);
}

// The default retains the direct legacy adapter contract. HTTP starts always
// select their validated origin through mercadoPagoProviderForRequest first.
export async function createMercadoPagoPreference(id: string, quote: Quote, expiresAt: number, expectedCollectorId: string,
    returnOrigin: PaymentReturnOrigin = 'https://www.muttergames.com'): Promise<Preference> {
    if (!isReturnOrigin(returnOrigin)) invalidReturnOrigin();
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
    const returnUrl = `${returnOrigin}/success?orderId=${encodeURIComponent(id)}`;
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
