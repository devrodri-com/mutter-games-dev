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
export type ProviderInspection = {
    orderId: string;
    preferenceId?: string;
    collectorId: string;
    createdAt: number;
    expiresAt: number;
    knownPaymentIds: string[];
    paymentHint?: string;
    now?: number;
    timeoutMs?: number;
};
export type ProviderObservation = {
    payments: VerifiedProviderPayment[];
    observedPaymentIds: string[];
    terminalUnpaid: boolean;
    preferenceId?: string;
    collectorId: string;
    observedAt: number;
    searchComplete: boolean;
    historyWindowExceeded: boolean;
    verificationError?: 'provider_verification_unavailable';
    capacityExceeded?: boolean;
};
export type PaymentGateway = {
    readPayment(paymentId: string): Promise<VerifiedProviderPayment>;
    inspectOrder(input: ProviderInspection): Promise<ProviderObservation>;
};

const PAGE_SIZE = 50;
const MAX_RESULTS = 100;
const MAX_PROVIDER_TIMEOUT_MS = 10_000;
const MAX_PROVIDER_REQUESTS = 20;
// Payment Search documents twelve months and a query interval strictly below 365 days.
// This conservative policy horizon is not an indexing-delay or retention guarantee.
export const PAYMENT_TRACKING_HORIZON_MS = 360 * 24 * 60 * 60 * 1000;
const terminalUnpaidStatuses = new Set(['rejected', 'cancelled']);

class ProviderCapacityError extends Error {}

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
    const merchantOrderId = order?.id == null ? undefined : mercadoPagoNumericId(order.id);
    return {
        id,
        status: providerText(payment.status, 80),
        // Missing descriptive detail cannot turn a pending or unknown status into unpaid.
        statusDetail: payment.status_detail == null ? '' : providerText(payment.status_detail, 120),
        externalReference: providerText(payment.external_reference),
        collectorId: mercadoPagoNumericId(payment.collector_id),
        currency,
        amount: amount(payment.transaction_amount),
        liveMode: payment.live_mode,
        updatedAt: timestamp(payment.date_last_updated),
        ...(merchantOrderId ? { merchantOrderId } : {}),
    };
}
function getContext(timeoutMs = MAX_PROVIDER_TIMEOUT_MS) {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token)
        throw new Error('Payment configuration unavailable');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_PROVIDER_TIMEOUT_MS)
        throw new Error('Invalid payment verification budget');
    // One deadline covers every page and exact read, not a new timeout per request.
    const signal = AbortSignal.timeout(timeoutMs);
    let requestCount = 0;
    return async (path: string, query?: Record<string, string>): Promise<unknown> => {
        signal.throwIfAborted();
        if (requestCount >= MAX_PROVIDER_REQUESTS)
            throw new Error('Payment verification request budget exceeded');
        requestCount += 1;
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

async function paymentSearch(get: ProviderGet, input: ProviderInspection, now: number, observedIds: Set<string>): Promise<string[]> {
    const ids = new Set<string>();
    let offset = 0;
    let total: number | undefined;
    do {
        const result = record(await get('/v1/payments/search', {
            external_reference: input.orderId, 'collector.id': input.collectorId,
            sort: 'id', criteria: 'asc', range: 'date_created',
            begin_date: new Date(input.createdAt - 1000).toISOString(), end_date: new Date(now).toISOString(),
            limit: String(PAGE_SIZE), offset: String(offset),
        }));
        const paging = record(result.paging);
        const pageTotal = nonnegativeInteger(paging.total);
        const limit = nonnegativeInteger(paging.limit);
        if (pageTotal > MAX_RESULTS)
            throw new ProviderCapacityError('Provider result capacity exceeded');
        if ((total !== undefined && pageTotal !== total) || paging.offset !== offset || limit < 1 || limit > PAGE_SIZE || !Array.isArray(result.results) || result.results.length > limit)
            return unverified();
        total = pageTotal;
        for (const item of result.results) {
            const id = mercadoPagoNumericId(record(item).id);
            if (ids.has(id))
                return unverified();
            ids.add(id);
            observedIds.add(id);
            if (observedIds.size > MAX_RESULTS)
                throw new ProviderCapacityError('Observed payment capacity exceeded');
        }
        if ((result.results.length === 0 && offset < total) || ids.size > total)
            return unverified();
        offset += result.results.length;
    } while (offset < total);
    return [...ids];
}
async function readPayment(paymentId: string, get?: ProviderGet): Promise<VerifiedProviderPayment> {
    const id = mercadoPagoNumericId(paymentId);
    return parsePayment(await (get ?? getContext())(`/v1/payments/${id}`), id);
}
async function inspectOrder(input: ProviderInspection): Promise<ProviderObservation> {
    const now = input.now ?? Date.now();
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(input.orderId)
        || (input.preferenceId !== undefined && !/^[a-zA-Z0-9_-]{1,200}$/.test(input.preferenceId))
        || !Number.isSafeInteger(now) || !Number.isSafeInteger(input.createdAt)
        || input.createdAt < 1000 || input.createdAt > now
        || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= input.createdAt
        || !Array.isArray(input.knownPaymentIds) || input.knownPaymentIds.length > MAX_RESULTS)
        return unverified();
    const collectorId = mercadoPagoNumericId(input.collectorId);
    const knownIds = new Set(input.knownPaymentIds.map(mercadoPagoNumericId));
    const requestedIds = new Set<string>();
    if (input.paymentHint !== undefined)
        requestedIds.add(mercadoPagoNumericId(input.paymentHint));
    for (const id of knownIds)
        requestedIds.add(id);
    if (requestedIds.size > MAX_RESULTS)
        return unverified();
    const get = getContext(input.timeoutMs);
    const payments = new Map<string, VerifiedProviderPayment>();
    const observedIds = new Set(knownIds);
    const observation: ProviderObservation = {
        payments: [], observedPaymentIds: [], collectorId, observedAt: now,
        ...(input.preferenceId ? { preferenceId: input.preferenceId } : {}),
        terminalUnpaid: false, searchComplete: false,
        historyWindowExceeded: now - input.createdAt > PAYMENT_TRACKING_HORIZON_MS,
    };
    const loadPayment = async (id: string) => {
        if (payments.has(id))
            return;
        if (payments.size >= MAX_RESULTS)
            throw new ProviderCapacityError('Canonical payment capacity exceeded');
        // The domain matches reference, seller, amount, currency and live mode before authority.
        payments.set(id, await readPayment(id, get));
        observedIds.add(id);
    };
    try {
        // Known pending IDs must not disappear merely because the search index omits them.
        // A returned ID is only a hint: the canonical GET is always required.
        for (const id of requestedIds)
            await loadPayment(id);
        if (!observation.historyWindowExceeded) {
            for (const id of await paymentSearch(get, input, now, observedIds))
                await loadPayment(id);
            observation.searchComplete = true;
        }
    } catch (error) {
        // Preserve positive canonical evidence obtained before a failure, but never turn an
        // error, malformed response or incomplete page into successful absence evidence.
        observation.verificationError = 'provider_verification_unavailable';
        if (error instanceof ProviderCapacityError) observation.capacityExceeded = true;
    }
    observation.payments = [...payments.values()];
    observation.observedPaymentIds = [...observedIds];
    observation.terminalUnpaid = observation.searchComplete && input.expiresAt <= now
        && observation.payments.every(payment => terminalUnpaidStatuses.has(payment.status));
    return observation;
}

export const mercadoPagoGateway: PaymentGateway = { readPayment, inspectOrder };
