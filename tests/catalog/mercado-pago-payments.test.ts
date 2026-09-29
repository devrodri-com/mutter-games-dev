// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mercadoPagoGateway, PAYMENT_TRACKING_HORIZON_MS, type ProviderInspection } from '../../api/_lib/mercado-pago-payments';
import { createMercadoPagoPreference } from '../../api/_lib/mercado-pago';
import type { Quote } from '../../api/_lib/checkout-domain';

const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ORDER = 'synthetic-web-order';
const PREFERENCE = '200-synthetic-preference';
const COLLECTOR = '200';
const iso = (delta: number) => new Date(NOW + delta).toISOString();
const input = (changes: Partial<ProviderInspection> = {}): ProviderInspection => ({
    orderId: ORDER, preferenceId: PREFERENCE, collectorId: COLLECTOR,
    createdAt: NOW - 60 * 60 * 1000, expiresAt: NOW - 30 * 60 * 1000,
    knownPaymentIds: [], now: NOW, ...changes,
});
function payment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 101, status: 'approved', status_detail: 'accredited',
        external_reference: ORDER, collector_id: 200, currency_id: 'UYU',
        transaction_amount: '50.00', live_mode: true, date_last_updated: iso(-1000),
        ...overrides,
    };
}
function installHttp(handler: (url: URL, options: RequestInit) => unknown) {
    const fetcher = vi.fn(async (value: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
        const url = new URL(value instanceof Request ? value.url : String(value));
        if (url.origin !== 'https://api.mercadopago.com' || !options)
            throw new Error('Unexpected provider request');
        expect(options.method).toBe('GET');
        expect(options.headers).toMatchObject({ Authorization: 'Bearer synthetic-no-real-credential' });
        expect(options.redirect).toBe('error');
        expect(options.cache).toBe('no-store');
        const result = handler(url, options);
        return result instanceof Response ? result : Response.json(result);
    });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
}
function fixture(options: {
    payments?: Record<string, unknown>[];
    indexedIds?: number[];
    override?: (url: URL) => unknown;
} = {}) {
    const payments = options.payments ?? [payment()];
    const indexedIds = options.indexedIds ?? payments.map(item => Number(item.id));
    return installHttp(url => {
        const overridden = options.override?.(url);
        if (overridden !== undefined)
            return overridden;
        if (url.pathname === '/v1/payments/search') {
            expect(url.searchParams.get('external_reference')).toBe(ORDER);
            expect(url.searchParams.get('collector.id')).toBe(COLLECTOR);
            expect(url.searchParams.get('sort')).toBe('id');
            expect(url.searchParams.get('criteria')).toBe('asc');
            expect(url.searchParams.get('range')).toBe('date_created');
            expect(url.searchParams.get('end_date')).toBe(iso(0));
            expect(url.searchParams.has('status')).toBe(false);
            const offset = Number(url.searchParams.get('offset'));
            return { paging: { total: indexedIds.length, limit: 1, offset }, results: indexedIds.slice(offset, offset + 1).map(id => ({ id })) };
        }
        if (url.pathname.startsWith('/v1/payments/')) {
            const found = payments.find(item => String(item.id) === url.pathname.split('/').at(-1));
            if (found) return found;
        }
        throw new Error(`Unexpected synthetic route: ${url.pathname}`);
    });
}
beforeEach(() => {
    vi.stubEnv('MP_ACCESS_TOKEN', 'synthetic-no-real-credential');
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

test('individual read validates the actual HTTP response without requiring a merchant order', async () => {
    const fetcher = installHttp(url => {
        expect(url.pathname).toBe('/v1/payments/101');
        return payment();
    });
    await expect(mercadoPagoGateway.readPayment('101')).resolves.toEqual({
        id: '101', status: 'approved', statusDetail: 'accredited', externalReference: ORDER,
        collectorId: COLLECTOR, currency: 'UYU', amount: 50, liveMode: true, updatedAt: NOW - 1000,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
});
test('a direct payment with an empty optional order object needs no merchant resource', async () => {
    installHttp(() => payment({ order: {} }));
    await expect(mercadoPagoGateway.readPayment('101')).resolves.toMatchObject({ id: '101', status: 'approved' });
});
test.each(['0', '-1', '1.5', '101/other', 'https://foreign.invalid', ' 101'])('unsafe payment ID %s never makes an HTTP request', async id => {
    const fetcher = installHttp(() => { throw new Error('Must not be called'); });
    await expect(mercadoPagoGateway.readPayment(id)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
});
test.each([
    { id: 102 }, { collector_id: -1 }, { live_mode: 'true' }, { currency_id: 'us' },
    { transaction_amount: 'NaN' }, { transaction_amount: 1.001 }, { date_last_updated: 'yesterday' },
    { status: '' }, { status_detail: 7 }, { order: { id: '../301' } },
])('malformed exact response is never canonical evidence: %j', async changed => {
    installHttp(() => payment(changed));
    await expect(mercadoPagoGateway.readPayment('101')).rejects.toThrow();
});
test('pagination exhausts every result and directly rereads each ID with one shared deadline', async () => {
    const fetcher = fixture({ payments: [payment(), payment({ id: 102, status: 'rejected' })] });
    const result = await mercadoPagoGateway.inspectOrder(input({ timeoutMs: 4000 }));
    expect(result).toMatchObject({ searchComplete: true, terminalUnpaid: false, historyWindowExceeded: false, observedAt: NOW });
    expect(result.payments.map(item => item.id)).toEqual(['101', '102']);
    const urls = fetcher.mock.calls.map(([value]) => new URL(String(value)));
    expect(urls.filter(url => url.pathname === '/v1/payments/search').map(url => url.searchParams.get('offset'))).toEqual(['0', '1']);
    expect(urls.filter(url => /^\/v1\/payments\/\d+$/.test(url.pathname)).map(url => url.pathname)).toEqual(['/v1/payments/101', '/v1/payments/102']);
    const signals = fetcher.mock.calls.map(([, options]) => options?.signal);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals.every(signal => signal === signals[0])).toBe(true);
});
test.each([undefined, PREFERENCE])('empty exhaustive search after deadline supplies bounded absence evidence with preference %s', async preferenceId => {
    const fetcher = fixture({ payments: [] });
    await expect(mercadoPagoGateway.inspectOrder(input({ preferenceId }))).resolves.toMatchObject({ terminalUnpaid: true, searchComplete: true, payments: [] });
    // No fixture fabricates merchant-order creation, expiry, or indexing guarantees.
    expect(fetcher.mock.calls.map(([value]) => new URL(String(value)).pathname)).toEqual(['/v1/payments/search']);
});
test('unexpired deadline cannot produce terminal unpaid even with exhaustive absence', async () => {
    fixture({ payments: [] });
    expect((await mercadoPagoGateway.inspectOrder(input({ expiresAt: NOW + 1000 }))).terminalUnpaid).toBe(false);
});
test.each(['rejected', 'cancelled'])('canonical %s plus exhaustive search permits the domain to apply its margin', async status => {
    fixture({ payments: [payment({ status })] });
    await expect(mercadoPagoGateway.inspectOrder(input())).resolves.toMatchObject({ terminalUnpaid: true, searchComplete: true });
});
test.each(['pending', 'in_process', 'authorized', 'in_mediation', 'approved', 'refunded', 'charged_back', 'future_status'])('status %s cannot become terminal unpaid', async status => {
    fixture({ payments: [payment({ status, status_detail: null })] });
    await expect(mercadoPagoGateway.inspectOrder(input())).resolves.toMatchObject({ terminalUnpaid: false, searchComplete: true, payments: [{ status, statusDetail: '' }] });
});
test('known pending payment omitted by the search remains canonical and prevents absence', async () => {
    const fetcher = fixture({ payments: [payment({ status: 'pending' })], indexedIds: [] });
    const result = await mercadoPagoGateway.inspectOrder(input({ knownPaymentIds: ['101'] }));
    expect(result).toMatchObject({ terminalUnpaid: false, searchComplete: true, payments: [{ id: '101', status: 'pending' }] });
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toBe('/v1/payments/101');
});
test('return hint is read before search and canonical approval survives a failed index', async () => {
    const fetcher = fixture({ override: url => url.pathname === '/v1/payments/search' ? new Response('Synthetic outage', { status: 503 }) : undefined });
    const result = await mercadoPagoGateway.inspectOrder(input({ paymentHint: '101' }));
    expect(result).toMatchObject({ searchComplete: false, terminalUnpaid: false, verificationError: 'provider_verification_unavailable', payments: [{ id: '101', status: 'approved' }] });
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toBe('/v1/payments/101');
});
test('hint omitted by a successful search remains canonical evidence', async () => {
    fixture({ indexedIds: [] });
    await expect(mercadoPagoGateway.inspectOrder(input({ paymentHint: '101' }))).resolves.toMatchObject({ searchComplete: true, terminalUnpaid: false, payments: [{ id: '101', status: 'approved' }] });
});
test('search-observed ID survives a failed exact GET for the next reconciliation', async () => {
    fixture({ override: url => url.pathname === '/v1/payments/101' ? new Response('Synthetic unavailable', { status: 503 }) : undefined });
    await expect(mercadoPagoGateway.inspectOrder(input())).resolves.toMatchObject({ searchComplete: false, terminalUnpaid: false, observedPaymentIds: ['101'], payments: [] });
});
test('an ID from a failed exact read is reread when the next successful index omits it', async () => {
    fixture({ override: url => url.pathname === '/v1/payments/101' ? new Response('Synthetic unavailable', { status: 503 }) : undefined });
    const first = await mercadoPagoGateway.inspectOrder(input());
    expect(first.observedPaymentIds).toEqual(['101']);
    const fetcher = fixture({ payments: [payment({ status: 'pending' })], indexedIds: [] });
    const second = await mercadoPagoGateway.inspectOrder(input({ knownPaymentIds: first.observedPaymentIds }));
    expect(second).toMatchObject({ searchComplete: true, terminalUnpaid: false, payments: [{ id: '101', status: 'pending' }] });
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toBe('/v1/payments/101');
});
test('known payment direct-read failure cannot be replaced by an empty search', async () => {
    const fetcher = installHttp(() => new Response('Synthetic missing known ID', { status: 404 }));
    await expect(mercadoPagoGateway.inspectOrder(input({ knownPaymentIds: ['101'] }))).resolves.toMatchObject({ searchComplete: false, terminalUnpaid: false, verificationError: 'provider_verification_unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
});
test('canonical foreign payment stays data for domain mismatch attention, never changes collector identity', async () => {
    fixture({ payments: [payment({ collector_id: 201, external_reference: 'other-order', order: { id: 301 } })] });
    await expect(mercadoPagoGateway.inspectOrder(input())).resolves.toMatchObject({ collectorId: COLLECTOR, searchComplete: true, payments: [{ collectorId: '201', externalReference: 'other-order', merchantOrderId: '301' }] });
});
test.each([90, 150, 360])('day %s searches the documented Payments history without Merchant Search', async days => {
    const fetcher = fixture({ payments: [] });
    await expect(mercadoPagoGateway.inspectOrder(input({ createdAt: NOW - days * DAY, expiresAt: NOW - days * DAY + 30 * 60 * 1000 }))).resolves.toMatchObject({ terminalUnpaid: true, searchComplete: true, historyWindowExceeded: false });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(Date.parse(url.searchParams.get('end_date') ?? '') - Date.parse(url.searchParams.get('begin_date') ?? '')).toBeLessThan(365 * DAY);
});
test('beyond finite tracking history only known canonical IDs can be read, never infer absence', async () => {
    const fetcher = fixture();
    const result = await mercadoPagoGateway.inspectOrder(input({ createdAt: NOW - PAYMENT_TRACKING_HORIZON_MS - DAY, expiresAt: NOW - PAYMENT_TRACKING_HORIZON_MS, knownPaymentIds: ['101'] }));
    expect(result).toMatchObject({ searchComplete: false, terminalUnpaid: false, historyWindowExceeded: true, payments: [{ id: '101', status: 'approved' }] });
    expect(fetcher).toHaveBeenCalledTimes(1);
});
test.each([
    { paging: { total: 1, limit: 50, offset: 0 }, results: [] },
    { paging: { total: 101, limit: 50, offset: 0 }, results: [] },
    { paging: { total: 1, limit: 50, offset: 1 }, results: [{ id: 101 }] },
    { paging: { total: 1, limit: 50, offset: 0 }, results: [{ id: 101 }, { id: 101 }] },
    { paging: { total: 0, limit: 0, offset: 0 }, results: [] },
])('truncated or inconsistent pagination yields explicit incomplete evidence: %j', async page => {
    fixture({ override: url => url.pathname === '/v1/payments/search' ? page : undefined });
    await expect(mercadoPagoGateway.inspectOrder(input())).resolves.toMatchObject({ terminalUnpaid: false, searchComplete: false, verificationError: 'provider_verification_unavailable' });
});
test('provider total above tracking capacity remains a distinct observation before a later empty search', async () => {
    fixture({ override: url => url.pathname === '/v1/payments/search'
        ? { paging: { total: 101, limit: 50, offset: 0 }, results: [] } : undefined });
    const overflow = await mercadoPagoGateway.inspectOrder(input());
    expect(overflow).toMatchObject({ capacityExceeded: true, searchComplete: false, terminalUnpaid: false,
        verificationError: 'provider_verification_unavailable' });
    fixture({ payments: [] });
    const later = await mercadoPagoGateway.inspectOrder(input());
    expect(later.searchComplete).toBe(true);
    expect(later.capacityExceeded).toBeUndefined();
    // The domain must persist the first capacity marker; transport is deliberately stateless.
    expect(overflow.capacityExceeded).toBe(true);
});
test('transport timeout is incomplete evidence without claiming a capacity overflow', async () => {
    installHttp(() => { throw new Error('Synthetic timeout'); });
    const result = await mercadoPagoGateway.inspectOrder(input());
    expect(result).toMatchObject({ searchComplete: false, terminalUnpaid: false,
        verificationError: 'provider_verification_unavailable' });
    expect(result.capacityExceeded).toBeUndefined();
});
test('changed totals across pages cannot be presented as exhaustive', async () => {
    fixture({ override: url => url.pathname === '/v1/payments/search' ? { paging: { total: url.searchParams.get('offset') === '0' ? 2 : 3, limit: 1, offset: Number(url.searchParams.get('offset')) }, results: [{ id: 101 }] } : undefined });
    expect((await mercadoPagoGateway.inspectOrder(input())).searchComplete).toBe(false);
});
test.each([401, 403, 404, 429, 500])('HTTP %s or transport failure is explicit incomplete evidence, never unpaid', async status => {
    installHttp(() => new Response('Provider unavailable', { status }));
    await expect(mercadoPagoGateway.inspectOrder(input())).resolves.toMatchObject({ terminalUnpaid: false, searchComplete: false, verificationError: 'provider_verification_unavailable' });
    installHttp(() => { throw new Error('Synthetic timeout'); });
    await expect(mercadoPagoGateway.inspectOrder(input())).resolves.toMatchObject({ terminalUnpaid: false, searchComplete: false, verificationError: 'provider_verification_unavailable' });
});
test('one observation cannot exceed twenty provider requests', async () => {
    const payments = Array.from({ length: 21 }, (_, index) => payment({ id: 101 + index, status: 'pending' }));
    const fetcher = fixture({ payments });
    const result = await mercadoPagoGateway.inspectOrder(input({ knownPaymentIds: payments.map(item => String(item.id)) }));
    expect(fetcher).toHaveBeenCalledTimes(20);
    expect(result.payments).toHaveLength(20);
    expect(result).toMatchObject({ terminalUnpaid: false, searchComplete: false, verificationError: 'provider_verification_unavailable' });
});
test('deadline abort on a later exact read keeps earlier evidence but cannot authorize release', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    fixture({ payments: [payment(), payment({ id: 102 })], override: url => {
        if (url.pathname === '/v1/payments/102') {
            controller.abort(new Error('Whole observation deadline exceeded'));
            return payment({ id: 102 });
        }
        return undefined;
    } });
    await expect(mercadoPagoGateway.inspectOrder(input({ knownPaymentIds: ['101', '102'] }))).resolves.toMatchObject({ searchComplete: false, verificationError: 'provider_verification_unavailable', payments: [{ id: '101' }] });
});
test('configuration and invalid budgets fail before any provider request', async () => {
    const fetcher = fixture();
    await expect(mercadoPagoGateway.inspectOrder(input({ timeoutMs: 10_001 }))).rejects.toThrow('budget');
    vi.stubEnv('MP_ACCESS_TOKEN', '');
    await expect(mercadoPagoGateway.readPayment('101')).rejects.toThrow('configuration');
    expect(fetcher).not.toHaveBeenCalled();
});

const quote: Quote = {
    items: [{ id: 'synthetic-product', variantId: '', quantity: 1, customName: '', customNumber: '', title: 'Synthetic item', unitPrice: 50, stock: 1, inventorySlot: 'base', inventoryIdentity: 'synthetic' }],
    shippingCost: 0, total: 50, currency: 'UYU', hash: 'synthetic-hash',
};
function preferenceFixture(changes: Record<string, unknown> = {}) {
    const fetcher = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
        expect(String(url)).toBe('https://api.mercadopago.com/checkout/preferences');
        expect(options?.method).toBe('POST');
        expect(options?.redirect).toBe('error');
        return Response.json({ id: PREFERENCE, external_reference: ORDER, collector_id: 200,
            init_point: 'https://www.mercadopago.com.uy/checkout/v1/redirect?pref_id=synthetic',
            expires: true, expiration_date_to: iso(30 * 60 * 1000), ...changes });
    });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
}
test('preference sends exact thirty-minute deadline, cash exclusions and approved automatic return', async () => {
    const fetcher = preferenceFixture();
    await expect(createMercadoPagoPreference(ORDER, quote, NOW + 30 * 60 * 1000, COLLECTOR)).resolves.toMatchObject({ id: PREFERENCE, collectorId: COLLECTOR });
    const body: unknown = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ external_reference: ORDER, expires: true, expiration_date_from: iso(0), expiration_date_to: iso(30 * 60 * 1000), auto_return: 'approved',
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }], excluded_payment_methods: [{ id: 'abitab' }, { id: 'redpagos' }] },
        back_urls: { success: `https://www.muttergames.com/success?orderId=${ORDER}`, pending: `https://www.muttergames.com/success?orderId=${ORDER}`, failure: `https://www.muttergames.com/success?orderId=${ORDER}` } });
    expect(fetcher).toHaveBeenCalledTimes(1);
});
test.each([{ collector_id: 201 }, { expires: false }, { expiration_date_to: iso(31 * 60 * 1000) }, { external_reference: 'other-order' }])('preference response cannot change trusted seller/deadline/reference: %j', async changed => {
    const fetcher = preferenceFixture(changed);
    await expect(createMercadoPagoPreference(ORDER, quote, NOW + 30 * 60 * 1000, COLLECTOR)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
});
test('invalid seller or excessive preference lifetime fails before POST', async () => {
    const fetcher = preferenceFixture();
    await expect(createMercadoPagoPreference(ORDER, quote, NOW + 30 * 60 * 1000, 'bad')).rejects.toThrow();
    await expect(createMercadoPagoPreference(ORDER, quote, NOW + 31 * 60 * 1000, COLLECTOR)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
});
