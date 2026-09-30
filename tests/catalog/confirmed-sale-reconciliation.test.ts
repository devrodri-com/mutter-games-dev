// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { checkout } from '../../api/_lib/checkout-service';
import { createMercadoPagoPreference } from '../../api/_lib/mercado-pago';
import { reconcileOrder } from '../../api/_lib/order-reconciliation';
import { runWebStockSweep } from '../../api/_lib/web-stock-sweep';
import { createHarness, object } from './helpers/web-stock-harness';
const wallClock = Date.now.bind(Date);
let h: Awaited<ReturnType<typeof createHarness>>;
beforeEach(async () => { h = await createHarness(); });
afterEach(async () => { await h.dispose(); });
async function paid() {
    await h.seed(); const started = await h.start(); const id = String(started.id);
    const paymentId = await h.observe(id, 'approved');
    await h.check(id, paymentId);
    return { id, paymentId };
}
async function confirmed(id: string) {
    expect(await h.call('buyer', { action: 'status', orderId: id })).toMatchObject({ inventoryState: 'committed', paymentStatus: 'approved', canRetry: false });
    expect((await h.order(id)).attention).toBeUndefined();
    expect((await h.product()).stockTotal).toBe(4);
    expect((await h.db.collection('inventoryMovements').get()).size).toBe(1);
}
test('CLOCK-RACE-mechanism: request sampled 5ms earlier defers without undoing confirmation', async () => {
    const { id } = await paid(); h.state.now -= 5;
    await confirmed(id);
    h.state.now += 86_400_000 + 61_000; await h.check(id); await confirmed(id);
});
test('CLOCK-RACE-natural: two tabs/reload, buyer plus duplicate cron preserve one sale in 20 rounds', async () => {
    vi.spyOn(Date, 'now').mockRestore();
    await h.seed('game', 20);
    for (let round = 0; round < 20; round++) {
        h.state.now = wallClock();
        const uid = `buyer-${round}`; const started = await h.start(uid); const id = String(started.id);
        const paymentId = await h.observe(id, 'approved');
        await h.db.doc(`orders/${id}`).update({ 'reconciliation.nextCheckAt': wallClock() - 1 });
        const options = { ...h.options(), now: wallClock };
        const concurrent = await Promise.allSettled([
            checkout(h.db, uid, { action: 'verify', orderId: id, paymentId }, createMercadoPagoPreference, options),
            checkout(h.db, uid, { action: 'status', orderId: id }, createMercadoPagoPreference, options),
            runWebStockSweep(h.db, options), runWebStockSweep(h.db, options),
        ]);
        expect(concurrent.filter(result => result.status === 'rejected')).toEqual([]);
        expect(object(await checkout(h.db, uid, { action: 'status', orderId: id }, createMercadoPagoPreference, options)).inventoryState).toBe('committed');
        expect((await h.order(id)).attention).toBeUndefined();
        expect((await h.db.collection('inventoryMovements').get()).size).toBe(round + 1);
    }
    expect((await h.product()).stockTotal).toBe(0);
}, 120_000);
test('COMMITTED-FOLLOWUP-transient-failure: technical failure has receipt, never a false commercial attention', async () => {
    const { id } = await paid(); h.state.now += 86_400_000 + 61_000;
    vi.spyOn(h.db, 'runTransaction').mockRejectedValueOnce(new Error('Synthetic transient contention'));
    await expect(h.check(id)).rejects.toMatchObject({ code: 'RESERVATION_RECONCILIATION_FAILED' });
    expect(object((await h.order(id)).reconciliation).lastError).toBe('reservation_reconciliation_failed');
    await confirmed(id);
    h.state.now += 61_000; await h.check(id); await confirmed(id);
    expect(object((await h.order(id)).reconciliation).lastError).toBeUndefined();
});
test('COMMITTED-FOLLOWUP-provider-outage: confirmation survives, technical status is explicit', async () => {
    const { id } = await paid(); h.state.now += 86_400_000 + 61_000; h.state.searchFails = true;
    expect(await h.check(id)).toBe('unverified');
    expect(await h.call('buyer', { action: 'status', orderId: id })).toMatchObject({ inventoryState: 'committed', verificationPending: true });
    await confirmed(id);
});
test('COMMITTED-FOLLOWUP-old-mark: clean canonical observation removes only the technical attention', async () => {
    const { id } = await paid();
    await h.db.doc(`orders/${id}`).update({ attention: 'reservation_reconciliation_failed' });
    expect(await h.call('buyer', { action: 'status', orderId: id })).toMatchObject({ inventoryState: 'committed' });
    h.state.now += 86_400_000 + 61_000; await h.check(id); await confirmed(id);
});
test.each(['duplicate_approved_payment', 'approved_without_stock', 'payment_identity_mismatch', 'payment_requires_attention', 'inventory_ledger_mismatch'])('COMMITTED-FOLLOWUP preserves real %s attention', async attention => {
    const { id } = await paid(); await h.db.doc(`orders/${id}`).update({ attention });
    h.state.now += 86_400_000 + 61_000; await h.check(id);
    expect((await h.order(id)).attention).toBe(attention);
    expect(await h.call('buyer', { action: 'status', orderId: id })).toMatchObject({ inventoryState: 'attention', paymentStatus: 'approved', canRetry: false });
});
test.each(['refunded', 'charged_back'])('COMMITTED-FOLLOWUP retains new %s commercial attention', async status => {
    const { id, paymentId } = await paid(); h.state.now += 86_400_000 + 61_000;
    await h.observe(id, status, paymentId); await h.check(id);
    expect((await h.order(id)).attention).toBe('payment_requires_attention');
    expect((await h.product()).stockTotal).toBe(4);
});
test.each(['transaction_amount', 'currency_id', 'collector_id', 'live_mode'])('COMMITTED-FOLLOWUP does not hide canonical mismatch %s', async field => {
    const { id, paymentId } = await paid(); h.state.now += 86_400_000 + 61_000;
    const payment = h.payments.get(paymentId); if (!payment) throw new Error('Fixture missing');
    payment[field] = field === 'currency_id' ? 'USD' : field === 'live_mode' ? false : 999;
    await h.check(id); expect((await h.order(id)).attention).toBe('payment_identity_mismatch');
});
test('corrupt future timestamp diagnoses technical failure while persisted sale stays confirmed', async () => {
    const { id } = await paid(); await h.db.doc(`orders/${id}`).update({ 'reconciliation.lastAttemptAt': h.state.now + 86_400_000 });
    const view = await h.call('buyer', { action: 'status', orderId: id });
    expect(view).toMatchObject({ inventoryState: 'committed', verificationPending: true });
    expect(object((await h.order(id)).reconciliation).failures).toBe(1);
    await confirmed(id);
});
test('stale failing worker cannot mark a concurrently committed sale', async () => {
    await h.seed(); const started = await h.start(); const id = String(started.id);
    let fail: (reason: Error) => void = () => { throw new Error('Barrier not installed'); };
    let entered: () => void = () => { throw new Error('Signal not installed'); };
    const signal = new Promise<void>(resolve => { entered = resolve; });
    const old = reconcileOrder(h.db, id, { ...h.options(), gateway: { inspectOrder: async () => {
        entered(); return new Promise((_resolve, reject) => { fail = reject; });
    } } }).catch(error => error);
    await signal; h.state.now += 61_000;
    await h.observe(id, 'approved'); await h.check(id);
    fail(new Error('Synthetic stale provider failure')); await old;
    await confirmed(id);
});

test('bounded future active lease defers; a stale failure cannot reopen a closed abandoned order', async () => {
    await h.seed(); const started = await h.start(); const id = String(started.id);
    const now = h.state.now;
    await h.db.doc(`orders/${id}`).update({ 'reconciliation.lastAttemptAt': now + 5, 'reconciliation.leaseUntil': now + 60_005, 'reconciliation.leaseOwner': 'synthetic-owner' });
    expect(await h.check(id)).toBe('deferred');
    expect((await h.order(id)).attention).toBeUndefined();
    h.state.now += 46 * 60_000;
    let entered: () => void = () => { throw new Error('Missing signal'); };
    let rejectOld: (error: Error) => void = () => { throw new Error('Missing barrier'); };
    const signal = new Promise<void>(resolve => { entered = resolve; });
    const pending = reconcileOrder(h.db, id, { ...h.options(), gateway: { inspectOrder: async () => {
        entered(); return new Promise((_resolve, reject) => { rejectOld = reject; });
    } } }).catch(error => error);
    await signal; h.state.now += 61_000; await h.check(id);
    rejectOld(new Error('Synthetic old request failure')); await pending;
    expect((await h.order(id)).inventory).toMatchObject({ state: 'released' });
    expect((await h.order(id)).attention).toBeUndefined();
    expect((await h.db.doc(`checkoutIntents/${id}`).get()).get('state')).toBe('closed');
    expect((await h.product()).stockTotal).toBe(5);
    expect(await h.holds()).toHaveLength(0);
});
