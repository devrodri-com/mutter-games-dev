// @vitest-environment node
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { applyProviderObservation } from '../../api/_lib/payment-transitions';
import { mercadoPagoGateway } from '../../api/_lib/mercado-pago-payments';
import { runWebStockSweep } from '../../api/_lib/web-stock-sweep';
import { createHarness, object } from './helpers/web-stock-harness';
let h: Awaited<ReturnType<typeof createHarness>>;
beforeEach(async () => { h = await createHarness(); });
afterEach(async () => { await h.dispose(); });
const expire = () => { h.state.now += 45 * 60_000 + 1; };

test.each(['normal', 'lost_response', 'creating'] as const)('R01/R02b %s: complete empty payment search after grace closes every resource without merchant proof', async state => {
    await h.seed();
    h.state.lostPost = state === 'lost_response';
    if (state === 'lost_response') await expect(h.start()).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    else await h.start();
    const snapshot = (await h.db.collection('orders').get()).docs[0];
    if (state === 'creating') {
        await h.db.doc(`checkoutIntents/${snapshot.id}`).update({ state: 'creating' });
        // Durable admission before any preference response is sufficient to recover by exact order reference.
    }
    const before = await h.product();
    h.state.now += 30 * 60_000 + 1;
    await h.check(snapshot.id);
    expect(await h.holds()).toHaveLength(1);
    h.state.now += 15 * 60_000;
    await h.check(snapshot.id);
    expect(await h.holds()).toHaveLength(0);
    expect((await h.product()).stockTotal).toBe(before.stockTotal);
    expect((await h.product()).untouched).toEqual(before.untouched);
    expect((await h.order(snapshot.id)).inventory).toMatchObject({ state: 'released' });
    expect((await h.db.doc(`checkoutIntents/${snapshot.id}`).get()).get('state')).toBe('closed');
    expect((await h.db.collection('webCheckoutLocks').get()).empty).toBe(true);
    expect((await h.db.collection('webReservationOwners').get()).empty).toBe(true);
    expect((await h.db.doc(`webAdmissionClaims/${snapshot.id}`).get()).get('released')).toBe(true);
    expect((await h.db.collection('webAdmissionBuckets').get()).docs.every(d => d.get('active').length === 0)).toBe(true);
    h.state.lostPost = false;
    await h.start();
    expect(h.state.posts).toBe(2);
});

test.each(['searchFails', 'searchIncomplete'] as const)('%s is not evidence of no payment and does not block four free units', async failure => {
    await h.seed(); const started = await h.start(); expire(); h.state[failure] = true;
    await h.check(started.id);
    expect(await h.holds()).toHaveLength(1);
    expect((await h.order(started.id)).attention).toBe('reservation_reconciliation_failed');
    const quoted = object((await h.call('other', { action: 'quote', purchase: h.purchase() })).quote);
    expect(quoted.items).toEqual([expect.objectContaining({ stock: 4 })]);
    await h.start('other');
    expect(await h.holds()).toHaveLength(2);
    expect((await h.product()).stockTotal).toBe(5);
});

test.each(['pending', 'in_process', 'authorized', 'in_mediation'])('Known %s payment remains reserved after disappearing from Search', async status => {
    await h.seed(); const started = await h.start(); const id = await h.observe(started.id, status);
    await h.check(started.id); h.state.hidden.add(id); expire(); await h.check(started.id);
    expect(await h.holds()).toHaveLength(1);
    expect((await h.order(started.id)).knownPaymentIds).toEqual([id]);
    expect((await h.order(started.id)).paymentStatus).toBe('in_review');
});

test('unresolved search ID persists when canonical GET fails; later empty Search cannot discard it', async () => {
    await h.seed(); const started = await h.start(); const id = await h.observe(started.id, 'pending');
    h.state.failedIds.add(id); expire(); await h.check(started.id);
    expect((await h.order(started.id)).knownPaymentIds).toEqual([id]);
    h.state.hidden.add(id); h.state.now += 61_000; await h.check(started.id);
    expect(await h.holds()).toHaveLength(1);
    h.state.failedIds.clear(); h.state.now += 121_000; await h.check(started.id);
    expect((await h.order(started.id)).paymentStatus).toBe('in_review');
});

test('NB1 early return hint verifies canonical approved payment even before indexing and when Search fails', async () => {
    await h.seed(); const started = await h.start(); const id = await h.observe(started.id, 'approved');
    h.state.hidden.add(id); h.state.searchFails = true;
    await h.check(started.id, id);
    expect((await h.product()).stockTotal).toBe(4);
    expect((await h.order(started.id)).inventory).toMatchObject({ state: 'committed' });
    expect((await h.db.collection('inventoryMovements').get()).size).toBe(1);
});

test('a canonical payment hint for another order cannot poison the new order or keep its units forever', async () => {
    await h.seed();
    const paid = await h.start();
    const foreignHint = await h.observe(paid.id, 'approved');
    await h.check(paid.id);
    expect((await h.product()).stockTotal).toBe(4);
    const current = await h.start();
    await expect(h.check(current.id, foreignHint)).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    expect((await h.order(current.id)).knownPaymentIds).toEqual([]);
    expect(await h.holds()).toHaveLength(1);
    expire();
    await h.check(current.id);
    expect((await h.order(current.id)).knownPaymentIds).toEqual([]);
    expect((await h.order(current.id)).inventory).toMatchObject({ state: 'released' });
    expect(await h.holds()).toHaveLength(0);
    expect((await h.product()).stockTotal).toBe(4);
    expect((await h.db.collection('inventoryMovements').get()).size).toBe(1);
});

test.each([90, 150, 361])('day %i provider history never turns another free unit into catalog503', async days => {
    await h.seed(); const started = await h.start(); h.state.now += days * 86_400_000;
    await h.check(started.id);
    expect(await h.call('other', { action: 'availability', productIds: ['game'] })).toEqual({ checked: true });
    await h.start('other');
    const first = await h.order(started.id);
    expect(object(first.inventory).state).toBe(days === 361 ? 'reserved' : 'released');
    if (days === 361) expect(first.attention).toBe('provider_history_window_exceeded');
});

test('late creation response cannot reopen a closed attempt or return its old link', async () => {
    await h.seed(); let resume: () => void = () => { throw new Error('Missing barrier'); };
    h.state.postBarrier = new Promise<void>(resolve => { resume = resolve; });
    const started = h.start().then(value => ({ value }), error => ({ error: object(error) }));
    while (!h.state.posts) await new Promise(resolve => setTimeout(resolve, 10));
    const row = (await h.db.collection('orders').get()).docs[0]; expire(); await h.check(row.id);
    expect((await h.db.doc(`checkoutIntents/${row.id}`).get()).get('state')).toBe('closed');
    resume(); expect(await started).toMatchObject({ error: { code: 'RECOVERY_REQUIRED' } });
    expect((await h.db.doc(`checkoutIntents/${row.id}`).get()).get('state')).toBe('closed');
    expect((await h.order(row.id)).preferenceId).toBeUndefined(); expect(h.state.posts).toBe(1);
});

test('late indexed approval reacquires only free units and debits exactly once', async () => {
    await h.seed(); const started = await h.start(); expire(); await h.check(started.id);
    const id = await h.observe(started.id, 'approved'); h.state.now += 61_000;
    await Promise.all(Array.from({ length: 8 }, () => h.check(started.id, id)));
    expect((await h.product()).stockTotal).toBe(4);
    expect((await h.db.collection('inventoryMovements').get()).size).toBe(1);
});

test('NB3 failed paid multi-item basket clears only its remaining holds and cannot invite another payment', async () => {
    await h.seed('game', 1); await h.seed('other', 1);
    const started = await h.start('buyer', ['game', 'other']);
    // Simulate catalog drift outside the guarded Admin; recovery cannot manufacture stock.
    await h.db.doc('products/game').update({ stockTotal: 0 });
    const id = await h.observe(started.id, 'approved'); await h.check(started.id, id);
    expect(await h.holds('game')).toHaveLength(0); expect(await h.holds('other')).toHaveLength(0);
    expect((await h.product('other')).stockTotal).toBe(1);
    expect((await h.db.collection('inventoryMovements').get()).empty).toBe(true);
    expect(await h.call('buyer', { action: 'status', orderId: started.id })).toMatchObject({ canRetry: false, inventoryState: 'attention', paymentStatus: 'approved' });
    expect((await h.order(started.id)).attention).toBe('approved_without_stock');
    expect((await h.db.doc(`webAdmissionClaims/${started.id}`).get()).get('released')).toBe(true);
});

test('stale empty observation cannot release after concurrent verified approval', async () => {
    await h.seed(); const started = await h.start(); expire();
    const snapshot = await h.db.doc(`orders/${started.id}`).get(); const order = object(snapshot.data());
    const empty = await mercadoPagoGateway.inspectOrder({ orderId: snapshot.id, preferenceId: String(order.preferenceId), collectorId: '200',
        createdAt: Number(order.paymentCreatedAt), expiresAt: Number(order.paymentDeadline), knownPaymentIds: [], now: h.state.now });
    await h.observe(started.id, 'approved'); await h.check(started.id);
    await applyProviderObservation(h.db, snapshot, empty, h.state.now);
    expect(object((await h.order(started.id)).inventory).state).toBe('committed');
    expect((await h.product()).stockTotal).toBe(4); expect((await h.db.collection('inventoryMovements').get()).size).toBe(1);
});

test('persistent shared lease and sixty-second minimum prevent concurrent and sequential amplification', async () => {
    await h.seed(); const started = await h.start();
    await Promise.all(Array.from({ length: 12 }, () => h.check(started.id)));
    expect(h.state.reads).toBe(1);
    await h.check(started.id); h.state.now += 59_999; await h.check(started.id); expect(h.state.reads).toBe(1);
    h.state.now += 1; await h.check(started.id); expect(h.state.reads).toBe(2);
    h.state.searchFails = true; h.state.now += 60_000; await h.check(started.id);
    const failed = h.state.reads; await h.check(started.id); expect(h.state.reads).toBe(failed);
    h.state.now += 60_000; await h.check(started.id);
    expect(object((await h.order(started.id)).reconciliation).nextCheckAt).toBe(h.state.now + 120_000);
}, 30000);

test('R09 authorized full-quantity cart is preserved: attempt quotas cannot guarantee free units against it', async () => {
    await h.seed('game', 5);
    const purchase = { ...h.purchase(), items: [{ id: 'game', quantity: 5, variantId: '' }] };
    const quote = object((await h.call('buyer', { action: 'quote', purchase })).quote);
    await h.call('buyer', { action: 'start', purchase, key: 'synthetic-full-quantity-key', quoteHash: quote.hash });
    expect((await h.product()).stockTotal).toBe(5); expect(await h.holds()).toHaveLength(1);
    await expect(h.start('other')).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    const row = (await h.db.collection('orders').get()).docs[0]; expire(); await h.check(row.id);
    await h.start('other'); expect(h.state.posts).toBe(2);
});

test.each([
    { label: 'infinite lease', field: 'reconciliation.leaseUntil', value: () => Infinity },
    { label: 'NaN lease', field: 'reconciliation.leaseUntil', value: () => NaN },
    { label: 'infinite last attempt', field: 'reconciliation.lastAttemptAt', value: () => Infinity },
    { label: 'far future last attempt', field: 'reconciliation.lastAttemptAt', value: () => h.state.now + 86_400_000 },
    { label: 'far future lease', field: 'reconciliation.leaseUntil', value: () => h.state.now + 86_400_000 },
    { label: 'array inventory', field: 'inventory', value: () => [] },
    { label: 'array reconciliation', field: 'reconciliation', value: () => [] },
    { label: 'invalid creation time', field: 'paymentCreatedAt', value: () => Infinity },
])('corrupt $label moves to bounded retry without dropping stock or holds', async ({ field, value }) => {
    await h.seed(); const started = await h.start();
    const before = await h.product();
    await h.db.doc(`orders/${started.id}`).update({ [field]: value() });
    await expect(h.check(started.id)).rejects.toThrow();
    const after = await h.order(started.id);
    const reconciliation = object(after.reconciliation);
    expect(after.attention).toBe('reservation_reconciliation_failed');
    expect(reconciliation).toMatchObject({ state: 'review', failures: 1, lastAttemptAt: h.state.now });
    expect(reconciliation.nextCheckAt).toBe(h.state.now + 60_000);
    expect(reconciliation).not.toHaveProperty('leaseUntil');
    expect(reconciliation).not.toHaveProperty('leaseOwner');
    expect(await h.product()).toEqual(before);
    expect(h.state.reads).toBe(0);
});

test('twenty corrupt due rows cannot permanently hide a healthy order behind the bounded queue', async () => {
    await h.seed(); const healthy = await h.start();
    const source = await h.order(healthy.id);
    h.state.now += 61_000;
    const ids = Array.from({ length: 20 }, (_, index) => createHash('sha256').update(`synthetic-poison-${index}`).digest('hex'));
    const batch = h.db.batch();
    for (const id of ids) batch.set(h.db.doc(`orders/${id}`), {
        commerceVersion: 2, paymentCreatedAt: source.paymentCreatedAt, inventory: [],
        reconciliation: { ...object(source.reconciliation), nextCheckAt: h.state.now - 2_000 },
    });
    await batch.commit();
    const first = await runWebStockSweep(h.db, h.options());
    expect(first).toMatchObject({ selected: 20, attempted: 20, failed: 20, processed: 0 });
    for (const id of ids) {
        const poison = await h.order(id);
        expect(poison.attention).toBe('reservation_reconciliation_failed');
        expect(object(poison.reconciliation).nextCheckAt).toBeGreaterThan(h.state.now);
    }
    expect(await runWebStockSweep(h.db, h.options())).toMatchObject({ selected: 1, processed: 1, failed: 0 });
    expect(h.state.reads).toBe(1);
    expect((await h.product()).stockTotal).toBe(5);
    expect(await h.holds()).toHaveLength(1);
}, 30000);


test('search capacity overflow remains explicit review even if a later index response is empty', async () => {
    await h.seed(); const started = await h.start(); expire(); h.state.searchTotal = 101;
    await h.check(started.id);
    expect((await h.order(started.id)).paymentTrackingOverflow).toBe(true);
    expect(await h.holds()).toHaveLength(1);
    h.state.searchTotal = undefined; h.state.now += 61_000; await h.check(started.id);
    expect(await h.holds()).toHaveLength(1);
    expect((await h.order(started.id)).attention).toBe('payment_tracking_capacity_exceeded');
});
