// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mercadoPagoGateway } from '../../api/_lib/mercado-pago-payments';

const NOW = Date.parse('2026-09-28T12:00:00.000Z');
const ORDER = 'synthetic-web-order';
const PREFERENCE = '200-synthetic-preference';
const COLLECTOR = '200';
const iso = (delta: number) => new Date(NOW + delta).toISOString();
function payment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 101, status: 'approved', status_detail: 'accredited',
        external_reference: ORDER, collector_id: 200, currency_id: 'UYU',
        transaction_amount: '50.00', live_mode: true, date_last_updated: iso(-1000),
        order: { id: 301 }, ...overrides,
    };
}
function merchant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 301, status: 'closed', external_reference: ORDER, preference_id: PREFERENCE,
        collector: { id: 200 }, payments: [{ id: 101, status: 'approved' }], ...overrides,
    };
}
function installHttp(handler: (url: URL, options: RequestInit) => unknown) {
    const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : String(input));
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
function inspectFixture(options: {
    payments?: Record<string, unknown>[];
    merchants?: Record<string, unknown>[];
    preference?: Record<string, unknown>;
    override?: (url: URL) => unknown;
} = {}) {
    const payments = options.payments ?? [payment()];
    const merchants = options.merchants ?? [merchant()];
    return installHttp(url => {
        const overridden = options.override?.(url);
        if (overridden !== undefined)
            return overridden;
        if (url.pathname === `/checkout/preferences/${PREFERENCE}`)
            return { id: PREFERENCE, external_reference: ORDER, collector_id: 200, expires: true, date_created: iso(-60_000), expiration_date_to: iso(-10_000), ...options.preference };
        const offset = Number(url.searchParams.get('offset') ?? 0);
        if (url.pathname === '/v1/payments/search') {
            expect(url.searchParams.get('external_reference')).toBe(ORDER);
            expect(url.searchParams.get('collector.id')).toBe(COLLECTOR);
            expect(url.searchParams.has('status')).toBe(false);
            return { paging: { total: payments.length, limit: 1, offset }, results: payments.slice(offset, offset + 1).map(item => ({ id: item.id })) };
        }
        if (url.pathname === '/merchant_orders/search') {
            expect(url.searchParams.get('preference_id')).toBe(PREFERENCE);
            expect(url.searchParams.get('external_reference')).toBe(ORDER);
            return { total: merchants.length, next_offset: Math.min(offset + 1, merchants.length), elements: merchants.slice(offset, offset + 1).map(item => ({ id: item.id })) };
        }
        if (url.pathname.startsWith('/v1/payments/')) {
            const item = payments.find(item => String(item.id) === url.pathname.split('/').at(-1));
            if (item) return item;
        }
        if (url.pathname.startsWith('/merchant_orders/')) {
            const item = merchants.find(item => String(item.id) === url.pathname.split('/').at(-1));
            if (item) return item;
        }
        throw new Error(`Unexpected synthetic route: ${url.pathname}`);
    });
}
const inspect = () => mercadoPagoGateway.inspectOrder(ORDER, PREFERENCE, COLLECTOR);
beforeEach(() => {
    vi.stubEnv('MP_ACCESS_TOKEN', 'synthetic-no-real-credential');
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

test('individual read validates the actual HTTP response and canonical payment identity', async () => {
    const fetcher = installHttp(url => {
        expect(url.pathname).toBe('/v1/payments/101');
        return payment();
    });
    await expect(mercadoPagoGateway.readPayment('101')).resolves.toEqual({
        id: '101', status: 'approved', statusDetail: 'accredited', externalReference: ORDER,
        collectorId: COLLECTOR, currency: 'UYU', amount: 50, liveMode: true,
        updatedAt: NOW - 1000, merchantOrderId: '301',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
});
test.each(['0', '-1', '1.5', '101/other', 'https://foreign.invalid', ' 101'])('unsafe payment ID %s never makes an HTTP request', async id => {
    const fetcher = installHttp(() => { throw new Error('Must not be called'); });
    await expect(mercadoPagoGateway.readPayment(id)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
});
test.each([
    { id: 102 }, { collector_id: -1 }, { live_mode: 'true' }, { currency_id: 'us' },
    { transaction_amount: 'NaN' }, { transaction_amount: 1.001 }, { date_last_updated: 'yesterday' },
    { status: '' }, { status_detail: null }, { order: { id: '../301' } },
])('malformed payment response is never a successful observation: %j', async changed => {
    installHttp(() => payment(changed));
    await expect(mercadoPagoGateway.readPayment('101')).rejects.toThrow();
});
test('exhaustive paginated searches read each exact resource with one shared deadline', async () => {
    const payments = [payment(), payment({ id: 102, status: 'rejected', status_detail: 'cc_rejected_other_reason', order: { id: 302 } })];
    const merchants = [merchant(), merchant({ id: 302, status: 'expired', payments: [{ id: 102, status: 'rejected' }] })];
    const fetcher = inspectFixture({ payments, merchants });
    const result = await inspect();
    expect(result.payments.map(item => item.id)).toEqual(['101', '102']);
    expect(result.terminalUnpaid).toBe(false);
    const paymentSearches = fetcher.mock.calls.map(([input]) => new URL(String(input))).filter(url => url.pathname === '/v1/payments/search');
    expect(paymentSearches.map(url => url.searchParams.get('offset'))).toEqual(['0', '1']);
    const signals = fetcher.mock.calls.map(([, options]) => options?.signal);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals.every(signal => signal === signals[0])).toBe(true);
});
test('expired preference plus empty searches remains uncertain', async () => {
    inspectFixture({ payments: [], merchants: [] });
    await expect(inspect()).resolves.toMatchObject({ terminalUnpaid: false, payments: [] });
});
test('expired exact merchant order without payment proves terminal abandonment', async () => {
    inspectFixture({ payments: [], merchants: [merchant({ status: 'expired', payments: [] })] });
    await expect(inspect()).resolves.toMatchObject({ terminalUnpaid: true, payments: [] });
});
test.each(['rejected', 'cancelled'])('expired exact merchant order and %s payment is terminal unpaid', async status => {
    inspectFixture({ payments: [payment({ status, status_detail: 'synthetic_terminal' })], merchants: [merchant({ status: 'expired', payments: [{ id: 101, status }] })] });
    await expect(inspect()).resolves.toMatchObject({ terminalUnpaid: true });
});
test.each(['pending', 'in_process', 'authorized', 'approved', 'refunded', 'charged_back', 'future_status'])('payment status %s conserves the reservation despite preference expiry', async status => {
    inspectFixture({ payments: [payment({ status, status_detail: 'pending_review_manual' })], merchants: [merchant({ status: 'expired', payments: [{ id: 101, status }] })] });
    await expect(inspect()).resolves.toMatchObject({ terminalUnpaid: false });
});
test('unexpired preference or opened merchant order cannot release even rejected payment', async () => {
    inspectFixture({ payments: [payment({ status: 'rejected' })], merchants: [merchant({ status: 'expired', payments: [{ id: 101, status: 'rejected' }] })], preference: { expiration_date_to: iso(60_000) } });
    expect((await inspect()).terminalUnpaid).toBe(false);
    inspectFixture({ payments: [], merchants: [merchant({ status: 'opened', payments: [] })] });
    expect((await inspect()).terminalUnpaid).toBe(false);
});
test.each([
    { external_reference: 'foreign' }, { collector_id: 201 }, { order: undefined },
    { order: { id: 999 } },
])('same-reference search never admits ambiguous payment linkage: %j', async changed => {
    inspectFixture({ payments: [payment(changed)] });
    await expect(inspect()).rejects.toThrow();
});
test.each([
    { preference_id: 'different-preference' }, { external_reference: 'other-order' },
    { collector: { id: 201 } }, { payments: [] }, { payments: [{ id: 101, status: 'rejected' }] },
])('wrong merchant identity, membership or contradictory payment state fails closed: %j', async changed => {
    inspectFixture({ merchants: [merchant(changed)] });
    await expect(inspect()).rejects.toThrow();
});
test.each([
    { collector_id: 201 }, { external_reference: 'other-order' }, { expires: false },
    { date_created: iso(-90 * 24 * 60 * 60 * 1000) }, { expiration_date_to: 'invalid' },
])('invalid or out-of-search-window preference fails closed: %j', async changed => {
    inspectFixture({ preference: changed });
    await expect(inspect()).rejects.toThrow();
});
test.each([
    { paging: { total: 1, limit: 50, offset: 0 }, results: [] },
    { paging: { total: 101, limit: 50, offset: 0 }, results: [] },
    { paging: { total: 1, limit: 50, offset: 1 }, results: [{ id: 101 }] },
    { paging: { total: 1, limit: 50, offset: 0 }, results: [{ id: 101 }, { id: 101 }] },
])('incomplete or inconsistent pagination never proves unpaid: %j', async page => {
    inspectFixture({ override: url => url.pathname === '/v1/payments/search' ? page : undefined });
    await expect(inspect()).rejects.toThrow();
});
test('changed totals across pages fail closed', async () => {
    inspectFixture({ override: url => url.pathname === '/v1/payments/search' ? { paging: { total: url.searchParams.get('offset') === '0' ? 2 : 3, limit: 1, offset: Number(url.searchParams.get('offset')) }, results: [{ id: 101 }] } : undefined });
    await expect(inspect()).rejects.toThrow();
});
test('merchant-search pagination cannot silently omit a page', async () => {
    inspectFixture({ override: url => url.pathname === '/merchant_orders/search' ? { total: 1, next_offset: 0, elements: [] } : undefined });
    await expect(inspect()).rejects.toThrow();
});
test.each([401, 403, 404, 429, 500])('HTTP %s and provider transport errors are never successful observations', async status => {
    installHttp(() => new Response('Provider unavailable', { status }));
    await expect(inspect()).rejects.toThrow('Provider verification unavailable');
    installHttp(() => { throw new Error('Synthetic timeout'); });
    await expect(inspect()).rejects.toThrow('Synthetic timeout');
});
test('a payment omitted from the search but present in the exact merchant order is still inspected', async () => {
    inspectFixture({ payments: [], override: url => url.pathname === '/v1/payments/101' ? payment() : undefined });
    const result = await inspect();
    expect(result.payments).toHaveLength(1);
    expect(result.terminalUnpaid).toBe(false);
});
test('the shared observation deadline also aborts a later exact-resource read', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    inspectFixture({ override: url => {
        if (url.pathname === '/v1/payments/101') {
            controller.abort(new Error('Whole observation deadline exceeded'));
            return payment();
        }
        return undefined;
    } });
    await expect(inspect()).rejects.toThrow('Whole observation deadline exceeded');
});
test('a token is required before any provider request', async () => {
    vi.stubEnv('MP_ACCESS_TOKEN', '');
    const fetcher = installHttp(() => payment());
    await expect(mercadoPagoGateway.readPayment('101')).rejects.toThrow('configuration');
    expect(fetcher).not.toHaveBeenCalled();
});
// Official merchant-order example: one element, total=1, next_offset=1.
// https://www.mercadopago.com.uy/developers/en/reference/online-payments/checkout-pro/merchant_orders/search-merchant-order/get
// The official SDK defines next_offset as an optional provider-supplied continuation offset.
// https://github.com/mercadopago/sdk-nodejs/blob/master/src/clients/merchantOrder/search/types.ts
test.each([1, 50, undefined])('a fully accounted merchant page does not infer a cursor formula: %s', async nextOffset => {
    inspectFixture({
        payments: [], merchants: [merchant({ status: 'expired', payments: [] })],
        override: url => url.pathname === '/merchant_orders/search'
            ? { total: 1, elements: [{ id: 301 }], ...(nextOffset === undefined ? {} : { next_offset: nextOffset }) }
            : undefined,
    });
    await expect(inspect()).resolves.toMatchObject({ terminalUnpaid: true });
});
test('merchant pagination follows the provider cursor and accounts for every unique result', async () => {
    const fetcher = inspectFixture({
        payments: [],
        merchants: [merchant({ status: 'expired', payments: [] }), merchant({ id: 302, status: 'expired', payments: [] })],
        override: url => {
            if (url.pathname !== '/merchant_orders/search') return undefined;
            return url.searchParams.get('offset') === '0'
                ? { total: 2, next_offset: 50, elements: [{ id: 301 }] }
                : { total: 2, next_offset: 100, elements: [{ id: 302 }] };
        },
    });
    await expect(inspect()).resolves.toMatchObject({ terminalUnpaid: true });
    const offsets = fetcher.mock.calls.map(([input]) => new URL(String(input)))
        .filter(url => url.pathname === '/merchant_orders/search').map(url => url.searchParams.get('offset'));
    expect(offsets).toEqual(['0', '50']);
});
test.each([0, undefined])('incomplete merchant page without an advancing provider cursor fails closed: %s', async next_offset => {
    inspectFixture({ override: url => url.pathname === '/merchant_orders/search'
        ? { total: 2, elements: [{ id: 301 }], ...(next_offset === undefined ? {} : { next_offset }) }
        : undefined });
    await expect(inspect()).rejects.toThrow();
});
test('pending payment with undocumented null detail remains unverified, never terminal unpaid', async () => {
    inspectFixture({ payments: [payment({ status: 'pending', status_detail: null })], merchants: [merchant({ status: 'expired', payments: [{ id: 101, status: 'pending' }] })] });
    await expect(inspect()).rejects.toThrow();
});
