// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { adminOrders, projectAdminOrder } from '../../api/_lib/admin-orders';
import { adminAttentionLabel, adminOrderLabel, parseAdminOrderPage } from '../../src/domain/adminOrders';

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Firestore emulator required');
const app = initializeApp({ projectId: 'demo-mutter-admin-ordering' }, 'admin-orders-ordering');
const db = getFirestore(app);
beforeEach(async () => {
  const docs = await db.collection('orders').get();
  await Promise.all(docs.docs.map(doc => doc.ref.delete()));
});
afterAll(async () => { await db.terminate(); await deleteApp(app); });
const order = (createdAt: unknown) => ({ createdAt, commerceVersion: 2, paymentStatus: 'approved',
  inventory: { state: 'committed' }, total: 100, currency: 'UYU' });
async function page(body: Record<string, unknown> = {}) {
  return parseAdminOrderPage(await adminOrders(db, { admin: true }, { action: 'admin_orders', ...body }));
}

test('R1-D list-order: the newest twenty of45 come first; all pages are20/20/5 without omissions', async () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({
    id: createHash('sha256').update(`chronology-${i}`).digest('hex'), at: 1_790_000_000_000 + i * 60_000,
  }));
  await Promise.all(rows.map(row => db.doc(`orders/${row.id}`).set(order(Timestamp.fromMillis(row.at)))));
  const one = await page(), two = await page({ cursor: one.nextCursor }), three = await page({ cursor: two.nextCursor });
  expect([one.orders.length, two.orders.length, three.orders.length]).toEqual([20, 20, 5]);
  expect([...one.orders, ...two.orders, ...three.orders].map(row => row.id)).toEqual(rows.reverse().map(row => row.id));
  expect(three.nextCursor).toBeNull();
});

test('R1-D exact timestamp cursor preserves submillisecond ties and deterministic ID descent', async () => {
  const rows = [
    { id: 'a-new', at: new Timestamp(1_790_000_000, 9000) },
    { id: 'z-middle', at: new Timestamp(1_790_000_000, 8000) },
    { id: 'b-middle', at: new Timestamp(1_790_000_000, 8000) },
    { id: 'z-old', at: new Timestamp(1_790_000_000, 1000) },
  ];
  await Promise.all(rows.map(row => db.doc(`orders/${row.id}`).set(order(row.at))));
  const one = await page({ limit: 2 });
  expect(one.orders.map(row => row.id)).toEqual(['a-new', 'z-middle']);
  expect(one.nextCursor).toEqual({ section: 'recent', id: 'z-middle', createdAt: { seconds: 1_790_000_000, nanoseconds: 8000 } });
  const two = await page({ limit: 2, cursor: one.nextCursor });
  expect(two.orders.map(row => row.id)).toEqual(['b-middle', 'z-old']);
  expect(two.nextCursor).toBeNull();
});

test('R1-D recent query excludes missing/null/invalid types; undated scan continues across empty pages', async () => {
  await Promise.all([
    db.doc('orders/a-valid').set(order(Timestamp.fromMillis(4000))),
    db.doc('orders/b-valid').set(order(Timestamp.fromMillis(3000))),
    db.doc('orders/c-missing').set({ commerceVersion: 1 }),
    db.doc('orders/d-null').set(order(null)),
    db.doc('orders/e-invalid').set(order('2099-01-01T00:00:00Z')),
    db.doc('orders/f-number').set(order(5000)),
    db.doc('orders/g-map').set(order({ seconds: 9000, nanoseconds: 0 })),
  ]);
  const recent = await page();
  expect(recent.orders.map(row => row.id)).toEqual(['a-valid', 'b-valid']);
  const first = await page({ section: 'undated', limit: 2 });
  expect(first).toMatchObject({ section: 'undated', scannedCount: 2, orders: [], nextCursor: { section: 'undated', id: 'b-valid' } });
  const second = await page({ section: 'undated', limit: 2, cursor: first.nextCursor });
  expect(second.orders).toMatchObject([{ id: 'c-missing', createdAt: null, createdAtState: 'missing' }, { id: 'd-null', createdAt: null, createdAtState: 'null' }]);
  const third = await page({ section: 'undated', limit: 2, cursor: second.nextCursor });
  expect(third.orders).toMatchObject([{ id: 'e-invalid', createdAtState: 'invalid' }, { id: 'f-number', createdAtState: 'invalid' }]);
  const last = await page({ section: 'undated', limit: 2, cursor: third.nextCursor });
  expect(last.orders).toMatchObject([{ id: 'g-map', createdAtState: 'invalid' }]);
  expect(last.nextCursor).toBeNull();
});

test('R1-D malformed and cross-section cursors fail before reading business data', async () => {
  const reads = vi.spyOn(db, 'collection');
  const invalid = [
    { cursor: 'old-id' }, { cursor: {} }, { section: 'anything' }, { limit: 51 },
    { cursor: { section: 'recent', id: 'a/b', createdAt: { seconds: 1000, nanoseconds: 0 } } },
    { cursor: { section: 'recent', id: 'a', createdAt: { seconds: 1000.1, nanoseconds: 0 } } },
    { cursor: { section: 'recent', id: 'a', createdAt: { seconds: 1000, nanoseconds: 1e9 } } },
    { cursor: { section: 'recent', id: 'a', createdAt: { seconds: 253402300800, nanoseconds: 0 } } },
    { cursor: { section: 'recent', id: 'a', createdAt: { seconds: 1000, nanoseconds: 0 }, extra: true } },
    { section: 'undated', cursor: { section: 'recent', id: 'a', createdAt: { seconds: 1000, nanoseconds: 0 } } },
    { cursor: { section: 'undated', id: 'a' } },
  ];
  for (const body of invalid) await expect(adminOrders(db, { admin: true }, { action: 'admin_orders', ...body })).rejects.toMatchObject({ status: 400 });
  expect(reads).not.toHaveBeenCalled(); reads.mockRestore();
});

test('R1-D both sections reject role-like client claims before reads', async () => {
  const reads = vi.spyOn(db, 'collection');
  for (const section of ['recent', 'undated']) for (const claims of [{ uid: 'buyer' }, { admin: 'true' }, { role: 'admin' }, { superadmin: 1 }]) {
    await expect(adminOrders(db, claims, { action: 'admin_orders', section })).rejects.toMatchObject({ status: 403 });
  }
  expect(reads).not.toHaveBeenCalled(); reads.mockRestore();
});

test('R1-D cursor continuation excludes later insertions before the cursor; refresh shows the new sale', async () => {
  await db.doc('orders/a-old').set(order(Timestamp.fromMillis(1000)));
  await db.doc('orders/b-middle').set(order(Timestamp.fromMillis(2000)));
  const first = await page({ limit: 1 });
  await db.doc('orders/c-new').set(order(Timestamp.fromMillis(3000)));
  expect((await page({ limit: 1, cursor: first.nextCursor })).orders.map(row => row.id)).toEqual(['a-old']);
  expect((await page({ limit: 1 })).orders.map(row => row.id)).toEqual(['c-new']);
});

test('R1-B Admin neutralizes only the spurious technical mark on a server-confirmed sale', () => {
  const confirmed = projectAdminOrder('paid', { ...order(Timestamp.fromMillis(1000)), attention: 'reservation_reconciliation_failed' });
  expect(confirmed.attention).toBeNull();
  expect(adminOrderLabel(confirmed)).toBe('Pagada y stock descontado');
  const pending = projectAdminOrder('pending', { ...order(Timestamp.fromMillis(1000)), paymentStatus: 'pending', inventory: { state: 'reserved' }, attention: 'reservation_reconciliation_failed' });
  expect(pending.attention).toBe('reservation_reconciliation_failed');
  for (const attention of ['duplicate_approved_payment', 'approved_without_stock', 'payment_identity_mismatch', 'payment_requires_attention']) {
    const real = projectAdminOrder('attention', { ...order(Timestamp.fromMillis(1000)), attention });
    expect(real.attention).toBe(attention);
    expect(adminOrderLabel(real)).not.toBe('Pagada y stock descontado');
  }
});

test('R1-D three attention reasons have distinct understandable texts without raw codes', () => {
  const reasons = ['reservation_reconciliation_failed', 'payment_tracking_capacity_exceeded', 'provider_history_window_exceeded'];
  const labels = reasons.map(reason => adminAttentionLabel(reason));
  expect(new Set(labels).size).toBe(3);
  for (const [index, reason] of reasons.entries()) expect(labels[index]).not.toContain(reason);
});
