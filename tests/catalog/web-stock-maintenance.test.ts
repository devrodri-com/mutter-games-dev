// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { checkout } from '../../api/_lib/checkout-service';
import { hash } from '../../api/_lib/checkout-domain';
import { createMercadoPagoPreference } from '../../api/_lib/mercado-pago';
import { runWebStockSweep } from '../../api/_lib/web-stock-sweep';
import { createHarness, object } from './helpers/web-stock-harness';

let h: Awaited<ReturnType<typeof createHarness>>;
const MINUTE = 60_000;
beforeEach(async () => { h = await createHarness(); });
afterEach(async () => { vi.unstubAllGlobals(); await h.dispose(); });
const receipt = async () => object((await h.db.doc('webStockMaintenance/reconciliation').get()).data());
async function orders(count: number) {
    await h.seed('game', count + 5);
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
        const uid = `receipt-buyer-${index}`;
        const options = { ...h.options(), admission: { ipKey: hash(['receipt-ip', Math.floor(index / 10)]) } };
        const purchase = h.purchase();
        const quote = object(object(await checkout(h.db, uid, { action: 'quote', purchase }, createMercadoPagoPreference, options)).quote);
        const started = object(await checkout(h.db, uid, { action: 'start', purchase, quoteHash: quote.hash, key: randomUUID() }, createMercadoPagoPreference, options));
        ids.push(String(started.id));
    }
    return ids;
}
function providerFault(fault: 'http401' | 'http500' | 'hang', reference?: string) {
    const transport = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin !== 'https://api.mercadopago.com' || url.pathname !== '/v1/payments/search' ||
            reference !== undefined && url.searchParams.get('external_reference') !== reference) return transport(input, init);
        if (fault !== 'hang') return new Response('Synthetic unavailable', { status: fault === 'http401' ? 401 : 500 });
        return new Promise<Response>((_resolve, reject) => {
            const aborted = () => reject(new Error('Synthetic provider timeout'));
            if (init?.signal?.aborted) aborted();
            else init?.signal?.addEventListener('abort', aborted, { once: true });
        });
    }));
}

test('R1-A credential outage is unverified/partial, preserving every reservation', async () => {
    await orders(5); h.state.now += 46 * MINUTE; providerFault('http401');
    expect(await runWebStockSweep(h.db, h.options())).toMatchObject({ selected: 5, attempted: 5, processed: 5, verified: 0, unverified: 5, deferred: 0, failed: 0 });
    expect(await receipt()).toMatchObject({ state: 'partial', unverified: 5 });
    expect(await h.holds()).toHaveLength(5);
    expect((await h.db.collection('inventoryMovements').get()).empty).toBe(true);
});
test('R1-A partial provider failure differs from verified abandoned orders', async () => {
    const ids = await orders(3); h.state.now += 46 * MINUTE; providerFault('http500', ids[1]);
    expect(await runWebStockSweep(h.db, h.options())).toMatchObject({ processed: 3, verified: 2, unverified: 1, failed: 0 });
    expect(await receipt()).toMatchObject({ state: 'partial', unverified: 1 });
    expect(object((await h.order(ids[1])).inventory).state).toBe('reserved');
    expect(await h.holds()).toHaveLength(1);
});
test('R1-A hanging provider produces unverified work within the bounded run', async () => {
    await orders(20); h.state.now += 46 * MINUTE; providerFault('hang');
    const started = performance.now();
    expect(await runWebStockSweep(h.db, h.options())).toMatchObject({ selected: 20, attempted: 20, processed: 20, verified: 0, unverified: 20, failed: 0 });
    expect(performance.now() - started).toBeLessThan(60_000);
    expect(await receipt()).toMatchObject({ state: 'partial', unverified: 20 });
    expect(await h.holds()).toHaveLength(20);
}, 90_000);
test('R1-A a legitimately pending payment is verified without confirming or releasing stock', async () => {
    const [id] = await orders(1); await h.observe(id, 'pending'); h.state.now += 61_000;
    expect(await runWebStockSweep(h.db, h.options())).toMatchObject({ processed: 1, verified: 1, unverified: 0, failed: 0 });
    expect(await receipt()).toMatchObject({ state: 'completed', verified: 1 });
    expect(await h.holds()).toHaveLength(1);
    expect((await h.db.collection('inventoryMovements').get()).empty).toBe(true);
});
test('R1-A a 21st sentinel measures backlog without increasing the twenty-order budget', async () => {
    const ids = await orders(25);
    const oldestDue = Math.min(...await Promise.all(ids.map(async id => Number(object((await h.order(id)).reconciliation).nextCheckAt))));
    h.state.now += 46 * MINUTE;
    const measuredAt = h.state.now;
    const first = await runWebStockSweep(h.db, h.options());
    expect(first).toMatchObject({ selected: 20, attempted: 20, verified: 20, unverified: 0, moreDue: true,
        measuredAt, oldestDueLagMs: measuredAt - oldestDue, unattemptedInBatch: 0 });
    expect(first).not.toHaveProperty('remaining');
    expect(h.state.reads).toBe(20); expect(await h.holds()).toHaveLength(5);
    expect(await receipt()).toMatchObject({ moreDue: true, measuredAt });
    expect(await runWebStockSweep(h.db, h.options())).toMatchObject({ selected: 5, verified: 5, moreDue: false, unattemptedInBatch: 0 });
    expect(await h.holds()).toHaveLength(0);
}, 30_000);
test('R1-A a late overlapping failure survives a newer healthy receipt and another empty run', async () => {
    await orders(1); h.state.now += 46 * MINUTE;
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const earlier = runWebStockSweep(h.db, h.options(), { reconcile: async () => {
        entered?.(); await blocked; throw new Error('Synthetic earlier infrastructure failure');
    } });
    await ready;
    const earlierRunId = (await receipt()).runId;
    expect(await runWebStockSweep(h.db, h.options())).toMatchObject({ verified: 1 });
    const healthy = await receipt();
    release?.(); expect(await earlier).toMatchObject({ failed: 1 });
    const afterLate = await receipt();
    expect(afterLate).toMatchObject({ runId: healthy.runId, state: 'completed', verified: 1,
        lastFailureRunId: earlierRunId, lastFailureTypes: ['reconciliation_failed'] });
    expect(afterLate.lastFailureAt).toBeDefined();
    await runWebStockSweep(h.db, h.options());
    expect(await receipt()).toMatchObject({ state: 'completed', selected: 0, failed: 0, lastFailureRunId: earlierRunId });
});
test('R1-A poison then healthy preserves failure evidence without a permanent active error', async () => {
    await orders(1); h.state.now += 46 * MINUTE;
    await h.db.doc(`orders/${hash(['poison-maintenance'])}`).set({ commerceVersion: 2, inventory: [], reconciliation: { nextCheckAt: h.state.now - 1 } });
    expect(await runWebStockSweep(h.db, h.options())).toMatchObject({ selected: 2, verified: 1, failed: 1 });
    const failed = await receipt(); expect(failed).toMatchObject({ state: 'partial', lastFailureRunId: failed.runId });
    expect(await runWebStockSweep(h.db, h.options())).toMatchObject({ selected: 0, failed: 0 });
    expect(await receipt()).toMatchObject({ state: 'completed', lastFailureRunId: failed.runId, lastFailureTypes: ['reconciliation_failed'] });
});
