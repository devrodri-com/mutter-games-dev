import { record } from './checkout-domain.js';

export type VerifiedProviderPayment = {
    id: string;
    status: string;
    statusDetail: string;
    externalReference: string;
    collectorId: string;
    currency: string;
    amount: number;
    liveMode: boolean;
    updatedAt: number;
    merchantOrderId?: string;
};
export type ProviderObservation = {
    payments: VerifiedProviderPayment[];
    terminalUnpaid: boolean;
    preferenceId: string;
    collectorId: string;
};
export type PaymentGateway = {
    readPayment(paymentId: string): Promise<VerifiedProviderPayment>;
    inspectOrder(orderId: string, preferenceId: string, collectorId: string): Promise<ProviderObservation>;
};

const PAGE_SIZE = 50;
const MAX_RESULTS = 100;
const MERCHANT_SEARCH_WINDOW_MS = 89 * 24 * 60 * 60 * 1000;
const terminalUnpaidStatuses = new Set(['rejected', 'cancelled']);

function unverified(): never {
    throw new Error('Unverified payment provider response');
}
export function mercadoPagoNumericId(value: unknown): string {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
        return String(value);
    if (typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value))
        return value;
    return unverified();
}
function providerText(value: unknown, max = 200): string {
    if (typeof value !== 'string' || !value || value.length > max)
        return unverified();
    return value;
}
function timestamp(value: unknown): number {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value))
        return unverified();
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed))
        return unverified();
    return parsed;
}
function nonnegativeInteger(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
        return unverified();
    return value;
}
function amount(value: unknown): number {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)))
        return unverified();
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isSafeInteger(Math.round(parsed * 100)) || Math.round(parsed * 100) / 100 !== parsed)
        return unverified();
    return parsed;
}
function parsePayment(value: unknown, expectedId: string): VerifiedProviderPayment {
    const payment = record(value);
    const id = mercadoPagoNumericId(payment.id);
    if (id !== expectedId || typeof payment.live_mode !== 'boolean')
        return unverified();
    const currency = providerText(payment.currency_id, 3);
    if (!/^[A-Z]{3}$/.test(currency))
        return unverified();
    const order = payment.order == null ? undefined : record(payment.order);
    return {
        id,
        status: providerText(payment.status, 80),
        statusDetail: providerText(payment.status_detail, 120),
        externalReference: providerText(payment.external_reference),
        collectorId: mercadoPagoNumericId(payment.collector_id),
        currency,
        amount: amount(payment.transaction_amount),
        liveMode: payment.live_mode,
        updatedAt: timestamp(payment.date_last_updated),
        ...(order ? { merchantOrderId: mercadoPagoNumericId(order.id) } : {}),
    };
}
function getContext() {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token)
        throw new Error('Payment configuration unavailable');
    // One deadline covers the whole observation, including every page and exact read.
    const signal = AbortSignal.timeout(10_000);
    return async (path: string, query?: Record<string, string>): Promise<unknown> => {
        signal.throwIfAborted();
        const url = new URL(path, 'https://api.mercadopago.com');
        if (query)
            url.search = new URLSearchParams(query).toString();
        const response = await fetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            signal,
            redirect: 'error',
            cache: 'no-store',
        });
        if (!response.ok)
            throw new Error('Provider verification unavailable');
        const result: unknown = await response.json();
        signal.throwIfAborted();
        return result;
    };
}
type ProviderGet = ReturnType<typeof getContext>;

async function paymentSearch(get: ProviderGet, orderId: string, collectorId: string, createdAt: number): Promise<string[]> {
    const ids = new Set<string>();
    let offset = 0;
    let total: number | undefined;
    do {
        const result = record(await get('/v1/payments/search', {
            external_reference: orderId, 'collector.id': collectorId,
            sort: 'id', criteria: 'asc', range: 'date_created',
            begin_date: new Date(createdAt - 1000).toISOString(), end_date: 'NOW',
            limit: String(PAGE_SIZE), offset: String(offset),
        }));
        const paging = record(result.paging);
        const pageTotal = nonnegativeInteger(paging.total);
        const limit = nonnegativeInteger(paging.limit);
        if (pageTotal > MAX_RESULTS || (total !== undefined && pageTotal !== total) || paging.offset !== offset || limit < 1 || limit > PAGE_SIZE || !Array.isArray(result.results) || result.results.length > limit)
            return unverified();
        total = pageTotal;
        for (const item of result.results) {
            const id = mercadoPagoNumericId(record(item).id);
            if (ids.has(id))
                return unverified();
            ids.add(id);
        }
        if ((result.results.length === 0 && offset < total) || ids.size > total)
            return unverified();
        offset += result.results.length;
    } while (offset < total);
    return [...ids];
}
async function merchantOrderSearch(get: ProviderGet, orderId: string, preferenceId: string): Promise<string[]> {
    const ids = new Set<string>();
    let offset = 0;
    let total: number | undefined;
    do {
        const result = record(await get('/merchant_orders/search', {
            preference_id: preferenceId, external_reference: orderId,
            limit: String(PAGE_SIZE), offset: String(offset),
        }));
        const pageTotal = nonnegativeInteger(result.total);
        if (pageTotal > MAX_RESULTS || (total !== undefined && pageTotal !== total) || !Array.isArray(result.elements) || result.elements.length > PAGE_SIZE)
            return unverified();
        if (result.next_offset !== undefined)
            nonnegativeInteger(result.next_offset);
        total = pageTotal;
        for (const item of result.elements) {
            const id = mercadoPagoNumericId(record(item).id);
            if (ids.has(id))
                return unverified();
            ids.add(id);
        }
        if ((result.elements.length === 0 && ids.size < total) || ids.size > total)
            return unverified();
        if (ids.size === total)
            break;
        // Mercado Pago supplies the next offset; it need not equal the number of returned elements.
        const nextOffset = nonnegativeInteger(result.next_offset);
        if (nextOffset <= offset)
            return unverified();
        offset = nextOffset;
    } while (ids.size < total);
    return [...ids];
}
type MerchantOrder = { id: string; status: string; payments: Map<string, string> };
function parseMerchantOrder(value: unknown, id: string, orderId: string, preferenceId: string, collectorId: string): MerchantOrder {
    const order = record(value);
    if (mercadoPagoNumericId(order.id) !== id || order.external_reference !== orderId || order.preference_id !== preferenceId || mercadoPagoNumericId(record(order.collector).id) !== collectorId || !Array.isArray(order.payments) || order.payments.length > MAX_RESULTS)
        return unverified();
    const payments = new Map<string, string>();
    for (const raw of order.payments) {
        const payment = record(raw);
        const paymentId = mercadoPagoNumericId(payment.id);
        if (payments.has(paymentId))
            return unverified();
        payments.set(paymentId, providerText(payment.status, 80));
    }
    return { id, status: providerText(order.status, 80), payments };
}

async function readPayment(paymentId: string, get?: ProviderGet): Promise<VerifiedProviderPayment> {
    const id = mercadoPagoNumericId(paymentId);
    return parsePayment(await (get ?? getContext())(`/v1/payments/${id}`), id);
}
async function inspectOrder(orderId: string, preferenceId: string, collectorId: string): Promise<ProviderObservation> {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(orderId) || !/^[a-zA-Z0-9_-]{1,200}$/.test(preferenceId))
        return unverified();
    const seller = mercadoPagoNumericId(collectorId);
    const get = getContext();
    const now = Date.now();
    const preference = record(await get(`/checkout/preferences/${preferenceId}`));
    if (preference.id !== preferenceId || preference.external_reference !== orderId || mercadoPagoNumericId(preference.collector_id) !== seller || preference.expires !== true)
        return unverified();
    const expiresAt = timestamp(preference.expiration_date_to);
    const createdAt = timestamp(preference.date_created);
    // Search APIs have a finite history. Never interpret out-of-window absence as unpaid.
    if (createdAt > now || createdAt < now - MERCHANT_SEARCH_WINDOW_MS || expiresAt <= createdAt)
        return unverified();
    const paymentIds = await paymentSearch(get, orderId, seller, createdAt);
    const merchantIds = await merchantOrderSearch(get, orderId, preferenceId);
    const payments = new Map<string, VerifiedProviderPayment>();
    const merchants = new Map<string, MerchantOrder>();
    const loadPayment = async (id: string) => {
        const existing = payments.get(id);
        if (existing)
            return existing;
        if (payments.size >= MAX_RESULTS)
            return unverified();
        const payment = await readPayment(id, get);
        if (payment.externalReference !== orderId || payment.collectorId !== seller || !payment.merchantOrderId)
            return unverified();
        payments.set(id, payment);
        return payment;
    };
    const loadMerchant = async (id: string) => {
        const existing = merchants.get(id);
        if (existing)
            return existing;
        if (merchants.size >= MAX_RESULTS)
            return unverified();
        const merchant = parseMerchantOrder(await get(`/merchant_orders/${id}`), id, orderId, preferenceId, seller);
        merchants.set(id, merchant);
        return merchant;
    };
    for (const id of paymentIds) {
        const payment = await loadPayment(id);
        if (!payment.merchantOrderId)
            return unverified();
        const merchant = await loadMerchant(payment.merchantOrderId);
        if (merchant.payments.get(id) !== payment.status)
            return unverified();
    }
    for (const id of merchantIds)
        await loadMerchant(id);
    for (const merchant of merchants.values()) {
        for (const [id, status] of merchant.payments) {
            const payment = await loadPayment(id);
            if (payment.merchantOrderId !== merchant.id || payment.status !== status)
                return unverified();
        }
    }
    return {
        preferenceId,
        collectorId: seller,
        payments: [...payments.values()],
        // Empty searches are not terminal evidence. Pending, unknown and refunded payments retain stock.
        terminalUnpaid: expiresAt <= now && merchants.size > 0 && [...merchants.values()].every(order => order.status === 'expired') && [...payments.values()].every(payment => terminalUnpaidStatuses.has(payment.status)),
    };
}

export const mercadoPagoGateway: PaymentGateway = { readPayment, inspectOrder };
