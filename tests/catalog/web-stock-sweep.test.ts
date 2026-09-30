// @vitest-environment node
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import defaultHandler, { createSweepHandler, config } from '../../api/internal/web-stock-reconcile';
import { runWebStockSweep } from '../../api/_lib/web-stock-sweep';
import { mercadoPagoGateway } from '../../api/_lib/mercado-pago-payments';
import type { CheckoutOptions } from '../../api/_lib/order-reconciliation';
import { initialReconciliation } from '../../api/_lib/reconciliation-policy';
import { createHarness } from './helpers/web-stock-harness';
import { hash } from '../../api/_lib/checkout-domain';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) throw new Error('Isolated loopback emulator required');
const app = initializeApp({ projectId: 'demo-mutter-stock-sweep' }, 'stock-sweep-regressions');
const db = getFirestore(app);
const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const options = { now: () => NOW, collectorId: '200', gateway: mercadoPagoGateway };
const originalFetch = globalThis.fetch;
const secret = 'synthetic-cron-secret-not-a-real-credential';
const idFor = (index: number) => `row-${String(index).padStart(3, '0')}`;
const dueRow = (nextCheckAt = NOW) => ({ commerceVersion: 2, reconciliation: { nextCheckAt } });
async function queue(count: number) {
    const batch = db.batch();
    for (let index = 0; index < count; index++) batch.set(db.doc(`orders/${idFor(index)}`), dueRow());
    await batch.commit();
}
async function realOrder(label: string, changes: Record<string, unknown> = {}) {
    const id = hash(['synthetic-sweep-order', label]);
    const createdAt = NOW - 60 * 60_000;
    const expiresAt = createdAt + 30 * 60_000;
    const batch = db.batch();
    // This is a previously released order, still tracked for late provider approval.
    // No merchant order or invented provider expiry is part of the fixture.
    batch.set(db.doc(`orders/${id}`), {
        commerceVersion: 2, uid: `buyer-${id}`, currency: 'UYU', total: 50,
        paymentCreatedAt: createdAt, paymentDeadline: expiresAt, expectedCollectorId: '200',
        paymentStatus: 'expired', knownPaymentIds: [], checkoutIntentId: id,
        inventory: { state: 'released', reservationId: `reservation-synthetic-${id}`, expiresAt,
            lines: [{ productId: 'unpublished-game', slot: 'base', identity: 'base', quantity: 1 }] },
        reconciliation: { ...initialReconciliation(createdAt), nextCheckAt: NOW }, ...changes,
    });
    batch.set(db.doc(`checkoutIntents/${id}`), { uid: `buyer-${id}`, commerceVersion: 2, state: 'closed' });
    batch.set(db.doc('products/unpublished-game'), { active: false, stockTotal: 5, priceUSD: 50, title: 'Synthetic', webReservations: {} });
    await batch.commit();
    return id;
}
function syntheticPayments() {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.hostname === '127.0.0.1') return originalFetch(input, init);
        if (url.origin !== 'https://api.mercadopago.com' || url.pathname !== '/v1/payments/search' || init?.method !== 'GET')
            throw new Error('Unexpected external request');
        requests.push(url.searchParams.get('external_reference') ?? '');
        expect(url.searchParams.get('collector.id')).toBe('200');
        return Response.json({ paging: { total: 0, limit: 50, offset: 0 }, results: [] });
    }));
    return requests;
}
function responseRecorder() {
    const state: { code: number; body: unknown; headers: Record<string, string> } = { code: 0, body: undefined, headers: {} };
    const response = {
        setHeader(name: string, value: string) { state.headers[name.toLowerCase()] = value; },
        status(code: number) { state.code = code; return response; },
        json(body: unknown) { state.body = body; return body; },
    };
    return { state, response };
}
beforeEach(async () => {
    const response = await originalFetch(`http://${host}/emulator/v1/projects/demo-mutter-stock-sweep/databases/(default)/documents`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Cannot reset isolated test database');
    vi.stubEnv('MP_ACCESS_TOKEN', 'synthetic-no-real-credential');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { await db.terminate(); await deleteApp(app); });

test.each([undefined, '', 'Bearer ', 'Bearer wrong'])('GET with invalid secret %j never initializes Firebase or reads business data', async authorization => {
    const getDatabase = vi.fn(() => { throw new Error('Firebase must not be called'); });
    const configure = vi.fn(() => options);
    const handler = createSweepHandler({ getDatabase, secret: () => secret, options: configure });
    const { state, response } = responseRecorder();
    await handler({ method: 'GET', headers: { authorization } }, response);
    expect(state).toMatchObject({ code: 401, body: { error: 'Unauthorized' }, headers: { 'cache-control': 'no-store' } });
    expect(getDatabase).not.toHaveBeenCalled();
    expect(configure).not.toHaveBeenCalled();
});
test('unconfigured secret cannot authenticate even a bearer value named undefined', async () => {
    const getDatabase = vi.fn(() => { throw new Error('Firebase must not be called'); });
    const handler = createSweepHandler({ getDatabase, secret: () => undefined, options: () => options });
    const { state, response } = responseRecorder();
    await handler({ method: 'GET', headers: { authorization: 'Bearer undefined' } }, response);
    expect(state.code).toBe(401);
    expect(getDatabase).not.toHaveBeenCalled();
});
test.each(['   ', ' padded', 'trailing ', 'line\nbreak', 'zero\u0000byte'])('invalid configured secret %j fails closed before Firebase', async badSecret => {
    const getDatabase = vi.fn(() => { throw new Error('Firebase must not be called'); });
    const handler = createSweepHandler({ getDatabase, secret: () => badSecret, options: () => options });
    const { state, response } = responseRecorder();
    await handler({ method: 'GET', headers: { authorization: `Bearer ${badSecret}` } }, response);
    expect(state.code).toBe(401);
    expect(getDatabase).not.toHaveBeenCalled();
});
test('POST is rejected without Firebase initialization and exposes GET plus no-store', async () => {
    const getDatabase = vi.fn(() => { throw new Error('Firebase must not be called'); });
    const handler = createSweepHandler({ getDatabase, secret: () => secret, options: () => options });
    const { state, response } = responseRecorder();
    await handler({ method: 'POST', headers: { authorization: `Bearer ${secret}` } }, response);
    expect(state).toMatchObject({ code: 405, headers: { 'cache-control': 'no-store', allow: 'GET' } });
    expect(getDatabase).not.toHaveBeenCalled();
    expect(config.maxDuration).toBe(60);
});
test('authenticated empty run writes only bounded maintenance metadata and returns counters', async () => {
    const handler = createSweepHandler({ getDatabase: () => db, secret: () => secret, options: () => options });
    const { state, response } = responseRecorder();
    await handler({ method: 'GET', headers: { authorization: `Bearer ${secret}` } }, response);
    expect(state).toMatchObject({ code: 200, headers: { 'cache-control': 'no-store' }, body: { selected: 0, attempted: 0, processed: 0, failed: 0 } });
    const docs = await db.collection('webStockMaintenance').get();
    expect(docs.size).toBe(1);
    expect(docs.docs[0].data()).toMatchObject({ state: 'completed', selected: 0, attempted: 0 });
    expect((await db.collection('orders').get()).empty).toBe(true);
});

test('real bounded query advances forty due rows in two batches of twenty with stable document ordering', async () => {
    await queue(40);
    await db.doc('orders/future').set(dueRow(NOW + 1));
    await db.doc('orders/historical').set({ ...dueRow(), commerceVersion: 1 });
    await db.doc('orders/finished').set({ ...dueRow(), reconciliation: { nextCheckAt: null } });
    const seen: string[] = [];
    // Inject only the orchestration unit. Stock/payment behavior is exercised separately below.
    const reconcile = vi.fn(async (_db: typeof db, id: string, _options: CheckoutOptions, _trigger?: 'buyer' | 'sweep') => {
        seen.push(id);
        await db.doc(`orders/${id}`).update({ 'reconciliation.nextCheckAt': NOW + 60_000 });
        return 'verified' as const;
    });
    const first = await runWebStockSweep(db, options, { reconcile });
    expect(first).toMatchObject({ selected: 20, attempted: 20, processed: 20, verified: 20, failed: 0, unattemptedInBatch: 0, moreDue: true });
    expect([...seen].sort()).toEqual(Array.from({ length: 20 }, (_, index) => idFor(index)));
    const second = await runWebStockSweep(db, options, { reconcile });
    expect(second).toMatchObject({ selected: 20, attempted: 20, processed: 20, failed: 0, moreDue: false });
    expect(new Set(seen).size).toBe(40);
    const maintenance = (await db.doc('webStockMaintenance/reconciliation').get()).data();
    expect(maintenance).toMatchObject({ selected: 20, processed: 20, state: 'completed' });
    expect(Object.keys(maintenance ?? {}).sort()).toEqual(['attempted', 'deadlineReached', 'deferred', 'durationMs', 'failed', 'failureTypes',
        'lastFinishedAt', 'lastStartedAt', 'measuredAt', 'moreDue', 'oldestDueLagMs', 'processed', 'runId', 'selected', 'state',
        'unattemptedInBatch', 'unverified', 'verified'].sort());
    expect(reconcile.mock.calls.every(call => call[3] === 'sweep')).toBe(true);
});
test('orchestration never runs more than two rows concurrently', async () => {
    await queue(20);
    let active = 0;
    let maximum = 0;
    let unblock: (() => void) | undefined;
    let notifyTwo: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const twoStarted = new Promise<void>(resolve => { notifyTwo = resolve; });
    const pending = runWebStockSweep(db, options, { reconcile: async () => {
        active++;
        maximum = Math.max(maximum, active);
        if (active === 2) notifyTwo?.();
        await gate;
        active--;
        return 'verified';
    } });
    await twoStarted;
    expect(active).toBe(2);
    unblock?.();
    expect((await pending).processed).toBe(20);
    expect(maximum).toBe(2);
});
test('monotonic wall deadline stops admission while unfinished rows stay due', async () => {
    await queue(20);
    let wall = 0;
    const reconcile = vi.fn(async () => { wall = 38_000; return 'verified' as const; });
    const result = await runWebStockSweep(db, options, { wallNow: () => wall, reconcile });
    expect(result).toMatchObject({ selected: 20, attempted: 1, processed: 1, unattemptedInBatch: 19, deadlineReached: true });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect((await db.doc('orders/row-019').get()).data()?.reconciliation.nextCheckAt).toBe(NOW);
});
test('failure of one row does not starve remaining rows in the finite batch', async () => {
    await queue(20);
    const reconcile = vi.fn(async (_db: typeof db, id: string, _options: CheckoutOptions, _trigger?: 'buyer' | 'sweep') => {
        if (id === idFor(0)) throw new Error('Synthetic poison row');
        return 'verified' as const;
    });
    expect(await runWebStockSweep(db, options, { reconcile })).toMatchObject({ attempted: 20, processed: 19, failed: 1, unattemptedInBatch: 0 });
    expect(reconcile).toHaveBeenCalledTimes(20);
    expect((await db.doc('webStockMaintenance/reconciliation').get()).data()?.state).toBe('partial');
});

test('actual reconciliation follows an orphan released order for an unpublished product without a browser', async () => {
    const id = await realOrder('released-orphan');
    const requests = syntheticPayments();
    const before = (await db.doc('products/unpublished-game').get()).data();
    expect(await runWebStockSweep(db, options)).toMatchObject({ selected: 1, processed: 1, failed: 0 });
    expect(requests).toEqual([id]);
    const order = (await db.doc(`orders/${id}`).get()).data();
    expect(order?.reconciliation.nextCheckAt).toBeGreaterThan(NOW);
    expect(order?.inventory.state).toBe('released');
    expect((await db.doc('products/unpublished-game').get()).data()).toEqual(before);
    expect((await db.collection('inventoryMovements').get()).empty).toBe(true);
});
test('real row leases and due-time checks suppress provider requests', async () => {
    const reconciliation = initialReconciliation(NOW - 60 * 60_000);
    const leasedId = await realOrder('leased', { reconciliation: { ...reconciliation, nextCheckAt: NOW, leaseOwner: 'other-worker', leaseUntil: NOW + 60_000 } });
    await realOrder('future', { reconciliation: { ...reconciliation, nextCheckAt: NOW + 60_000 } });
    const requests = syntheticPayments();
    expect(await runWebStockSweep(db, options)).toMatchObject({ selected: 1, attempted: 1, deferred: 1, processed: 0 });
    expect(requests).toEqual([]);
    expect((await db.doc(`orders/${leasedId}`).get()).data()?.reconciliation.leaseOwner).toBe('other-worker');
});
test('real malformed row receives backoff while a healthy row continues through the provider adapter', async () => {
    await db.doc('orders/000-poison').set(dueRow());
    const id = await realOrder('healthy');
    const requests = syntheticPayments();
    expect(await runWebStockSweep(db, options)).toMatchObject({ selected: 2, attempted: 2, failed: 1, processed: 1 });
    expect(requests).toEqual([id]);
    const poison = (await db.doc('orders/000-poison').get()).data();
    expect(poison?.attention).toBe('reservation_reconciliation_failed');
    expect(poison?.reconciliation.nextCheckAt).toBeGreaterThan(NOW);
    expect((await runWebStockSweep(db, options)).selected).toBe(0);
});
test('overlapping real sweeps use the per-order lease for at most one provider observation', async () => {
    const id = await realOrder('overlap');
    const requests = syntheticPayments();
    const results = await Promise.all([runWebStockSweep(db, options), runWebStockSweep(db, options)]);
    expect(requests).toEqual([id]);
    expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(1);
    expect((await db.doc(`orders/${id}`).get()).data()?.reconciliation.nextCheckAt).toBeGreaterThan(NOW);
    expect((await db.collection('inventoryMovements').get()).empty).toBe(true);
});

// These exercise the actual default endpoint, Firebase factory, domain transactions and
// Mercado Pago HTTP adapter. Only the remote provider boundary is synthetic.
test.each(['approved-before-expiry', 'abandoned', 'late-approved'])(
    'authorized server endpoint handles %s without buyer return or product visits', async scenario => {
        const harness = await createHarness();
        const handlerApp = initializeApp({ projectId: 'demo-mutter-stock-recovery' }, 'catalog-checkout');
        vi.stubEnv('CRON_SECRET', secret);
        const invoke = async () => {
            const { state, response } = responseRecorder();
            await defaultHandler({ method: 'GET', headers: { authorization: `Bearer ${secret}` } }, response);
            expect(state.code).toBe(200);
            expect(state.headers['cache-control']).toBe('no-store');
        };
        try {
            await harness.seed('game', 1);
            const started = await harness.start();
            const id = started.id;
            const untouched = (await harness.product()).untouched;
            if (scenario === 'approved-before-expiry') {
                harness.state.now += 61_000;
                await harness.observe(id, 'approved');
                await invoke();
                expect((await harness.order(id)).paymentDeadline).toBeGreaterThan(harness.state.now);
            } else {
                harness.state.now += 45 * 60_000 + 1;
                await invoke();
                expect((await harness.order(id)).inventory).toMatchObject({ state: 'released' });
                expect((await harness.product()).stockTotal).toBe(1);
                expect(await harness.holds()).toEqual([]);
                if (scenario === 'late-approved') {
                    harness.state.now += 60 * 60_000 + 1;
                    await harness.observe(id, 'approved');
                    await invoke();
                }
            }
            const final = await harness.order(id);
            expect(final.inventory).toMatchObject({ state: scenario === 'abandoned' ? 'released' : 'committed' });
            expect((await harness.product()).stockTotal).toBe(scenario === 'abandoned' ? 1 : 0);
            expect((await harness.product()).untouched).toEqual(untouched);
            expect((await harness.db.collection('inventoryMovements').get()).size).toBe(scenario === 'abandoned' ? 0 : 1);
            expect(harness.state.posts).toBe(1);
        } finally {
            await getFirestore(handlerApp).terminate();
            await deleteApp(handlerApp);
            await harness.dispose();
        }
    },
);
