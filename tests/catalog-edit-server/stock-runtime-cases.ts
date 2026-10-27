import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { receiptPath } from '../../api/_lib/catalog-edit-policy.js';
import { identityForOption } from '../../src/domain/webInventory.js';

type Reply = { status: number; value: Record<string, unknown> };
type Patch = { version: string; intent: string; operationId: string; changes: Record<string, unknown> };
type StockRuntimeContext = {
  call(index: number, id: string, method?: string, body?: unknown, operation?: string): Promise<Reply>;
  patch(version: string, changes: Record<string, unknown>): Patch;
  version(value: Record<string, unknown>): string;
  db: Firestore;
  identities: ReadonlyArray<{ uid: string }>;
  fixture(): Record<string, unknown>;
};

/** These cases use the harness's selected HTTP runtime, including its actual
 * authorization, transaction and receipt paths. They do not call saveEdit directly. */
export function registerStockRuntimeCases({ call, patch, version, db, identities, fixture }: StockRuntimeContext): void {
  async function confirmed(index: number, id: string, original: Record<string, unknown>, changes: Record<string, unknown>,
    expected: Record<string, unknown>) {
    await db.doc(`products/${id}`).set(original);
    const first = await call(index, id); assert.equal(first.status, 200);
    const input = patch(version(first.value), changes);
    const saved = await call(index, id, 'PATCH', input);
    assert.equal(saved.status, 200, JSON.stringify(saved.value));
    assert.equal(saved.value.status, 'CONFIRMED'); assert.equal(saved.value.baseVersion, first.value.version);
    assert.equal(saved.value.operationId, input.operationId); assert.deepEqual(saved.value.changes, changes);
    const reread = await call(index, id); assert.equal(reread.status, 200);
    assert.equal(reread.value.version, saved.value.version); assert.deepEqual(reread.value.product, expected);
    const receipt = await call(index, id, 'GET', undefined, input.operationId);
    assert.equal(receipt.status, 200); assert.deepEqual(receipt.value, saved.value);
    const productTime = (await db.doc(`products/${id}`).get()).updateTime;
    const receiptTime = (await db.doc(receiptPath(identities[index].uid, input.operationId)).get()).createTime;
    assert(productTime && receiptTime); assert.equal(productTime.isEqual(receiptTime), true);
  }

  for (const index of [0, 1]) test(`stock runtime: named admin ${index} edits base quantity with preserved state and receipt`, async () => {
    const original = { ...fixture(), stockTotal: 0, variants: [], webReservations: {} };
    await confirmed(index, `stock-runtime-base-${index}`, original, { stockTotal: 5 }, { ...original, stockTotal: 5 });
  });

  test('stock runtime: option quantity adjusts only its aggregate delta and preserves legacy contents', async () => {
    const first = { value: 'A', variantId: 'synthetic-option-a', stock: 2, priceUSD: 3, extra: { keep: true } };
    const second = { value: 'B', variantId: 'synthetic-option-b', stock: 1, priceUSD: 4 };
    const variant = { label: { es: 'Modelo', en: 'Model' }, custom: { keep: true }, options: [first, second] };
    const original = { ...fixture(), stockTotal: 9, variants: [variant], webReservations: {} };
    await confirmed(1, 'stock-runtime-variant', original, { variants: [{ options: [{ stock: 5 }, {}] }] },
      { ...original, stockTotal: 12, variants: [{ ...variant, options: [{ ...first, stock: 5 }, second] }] });
  });

  test('stock runtime: base and option edits below pending reservations write neither product nor receipt', async () => {
    for (const kind of ['base', 'variant'] as const) {
      const index = kind === 'base' ? 0 : 1, id = `stock-runtime-held-${kind}`;
      const label = { es: 'Modelo', en: 'Model' }, option = { value: 'A', variantId: 'synthetic-held-a', stock: 5, priceUSD: 3 };
      const original = { ...fixture(), stockTotal: 5,
        variants: kind === 'base' ? [] : [{ label, options: [option] }],
        webReservations: { synthetic_pending_stock_hold: { expiresAt: Date.now() + 60_000,
          lines: [{ slot: kind === 'base' ? 'base' : '0:0', identity: kind === 'base' ? 'base' : identityForOption(label, option), quantity: 3 }] } } };
      await db.doc(`products/${id}`).set(original);
      const first = await call(index, id); assert.equal(first.status, 200);
      const changes = kind === 'base' ? { stockTotal: 2 } : { variants: [{ options: [{ stock: 2 }] }] };
      const input = patch(version(first.value), changes), before = await db.doc(`products/${id}`).get();
      const rejected = await call(index, id, 'PATCH', input);
      assert.equal(rejected.status, 400); assert.equal(rejected.value.code, 'INVALID_CATALOG_EDIT');
      assert.equal(rejected.value.applied, false);
      const after = await db.doc(`products/${id}`).get(); assert(before.updateTime && after.updateTime);
      assert.equal(after.updateTime.isEqual(before.updateTime), true); assert.deepEqual(after.data(), original);
      assert.equal((await db.doc(receiptPath(identities[index].uid, input.operationId)).get()).exists, false);
      const receipt = await call(index, id, 'GET', undefined, input.operationId);
      assert.equal(receipt.status, 200); assert.equal(receipt.value.status, 'NOT_CONFIRMED');
      const reread = await call(index, id); assert.equal(reread.status, 200);
      assert.equal(reread.value.version, first.value.version); assert.deepEqual(reread.value.product, original);
    }
  });
}
