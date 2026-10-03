import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOT, digest } from './common.mjs';
import { capture } from './backup.mjs';
import { localFirestore, restoreLocal, LOCAL_PROJECT } from './local-firestore.mjs';
import { proposeRepair, rehearseRepair } from './recovery.mjs';
import { product, incident } from './fixtures.mjs';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188', 'declared emulator mandatory; no skip');
const adapter = localFirestore('http://127.0.0.1:8188');
async function reset() {
  const r = await fetch(`http://127.0.0.1:8188/emulator/v1/projects/${LOCAL_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(r.ok, true);
}
async function seed() {
  await reset();
  const fields = { ...product().fields, types: { mapValue: { fields: {
    timestamp: { timestampValue: '2026-10-01T01:02:03.123456Z' }, integer: { integerValue: '9007199254740993' },
    reference: { referenceValue: `${ROOT}/categories/example` }, bytes: { bytesValue: 'AQID' },
    array: { arrayValue: { values: [{ nullValue: null }, { doubleValue: 1.25 }] } },
    geo: { geoPointValue: { latitude: -34.9, longitude: -56.2 } },
  } } } };
  const result = await restoreLocal(adapter, [product({ fields })]);
  assert.equal(result.documents, 1);
  return (await capture(adapter.request)).documents;
}
async function damage() {
  await adapter.request('POST', `${ROOT}:commit`, { writes: [{ update: { name: product().name, fields: { stockTotal: { integerValue: '0' } } }, updateMask: { fieldPaths: ['stockTotal'] } }] });
}
test('real emulator preserves Firestore types and repairs one accredited legacy write', async () => {
  const before = await seed(); await damage(); const current = (await capture(adapter.request)).documents;
  const plan = proposeRepair(before, current, incident(before[0], current[0]));
  const result = await rehearseRepair(adapter, before, current, plan);
  assert.equal(result.documentsWritten, 1);
  const after = (await capture(adapter.request)).documents;
  assert.deepEqual(after[0].fields, before[0].fields);
});
test('real emulator restores an accredited deletion, never an unexplained absence', async () => {
  const before = await seed();
  await adapter.request('POST', `${ROOT}:commit`, { writes: [{ delete: before[0].name }] });
  assert.equal(await adapter.request('GET', before[0].name, undefined, { allowMissing: true }), null);
  const i = incident(before[0], null);
  assert.throws(() => proposeRepair(before, [], { ...i, absenceCause: null }), /absence/);
  const plan = proposeRepair(before, [], i);
  await rehearseRepair(adapter, before, [], plan);
  assert.deepEqual((await capture(adapter.request)).documents[0].fields, before[0].fields);
});
test('real concurrent write after compare causes no repair', async () => {
  const before = await seed(); await damage(); const current = (await capture(adapter.request)).documents;
  const plan = proposeRepair(before, current, incident(before[0], current[0]));
  await adapter.request('POST', `${ROOT}:commit`, { writes: [{ update: { name: product().name, fields: { stockTotal: { integerValue: '4' } } }, updateMask: { fieldPaths: ['stockTotal'] } }] });
  const changed = (await capture(adapter.request)).documents;
  await assert.rejects(rehearseRepair(adapter, before, current, plan), /concurrent change/);
  assert.deepEqual((await capture(adapter.request)).documents, changed);
});
test('new order and recreated document remain intact', async () => {
  const before = await seed(); await damage(); let current = (await capture(adapter.request)).documents;
  const plan = proposeRepair(before, current, incident(before[0], current[0]));
  await adapter.request('POST', `${ROOT}:commit`, { writes: [{ update: { name: `${ROOT}/orders/new-sale`, fields: { paymentStatus: { stringValue: 'approved' } } }, currentDocument: { exists: false } }] });
  const afterSale = (await capture(adapter.request)).documents;
  await assert.rejects(rehearseRepair(adapter, before, current, plan), /concurrent/);
  assert.deepEqual((await capture(adapter.request)).documents, afterSale);
  await reset(); await restoreLocal(adapter, before);
  current = (await capture(adapter.request)).documents;
  const i = incident(before[0], current[0]);
  assert.throws(() => proposeRepair(before, current, i), /recreated/);
});
for (const kind of ['reservation', 'movement']) test(`real new ${kind} after compare blocks repair and survives`, async () => {
  const before = await seed(); await damage(); const current = (await capture(adapter.request)).documents;
  const plan = proposeRepair(before, current, incident(before[0], current[0]));
  const write = kind === 'reservation'
    ? { update: { name: product().name, fields: { webReservations: { mapValue: { fields: {
      newHold: { mapValue: { fields: { expiresAt: { integerValue: '9999999999999' } } } },
    } } } } }, updateMask: { fieldPaths: ['webReservations'] } }
    : { update: { name: `${ROOT}/inventoryMovements/new-sale`, fields: { type: { stringValue: 'web_sale' } } }, currentDocument: { exists: false } };
  await adapter.request('POST', `${ROOT}:commit`, { writes: [write] });
  const changed = (await capture(adapter.request)).documents;
  await assert.rejects(rehearseRepair(adapter, before, current, plan), /concurrent/);
  assert.deepEqual((await capture(adapter.request)).documents, changed);
});
test('tampered proposal cannot write and bulk restore never overwrites local data', async () => {
  const before = await seed(); await damage(); const current = (await capture(adapter.request)).documents;
  const plan = proposeRepair(before, current, incident(before[0], current[0]));
  plan.update.fields.stockTotal.integerValue = '1000';
  await assert.rejects(rehearseRepair(adapter, before, current, plan), /changed/);
  assert.equal(digest((await capture(adapter.request)).documents), digest(current));
  await assert.rejects(restoreLocal(adapter, before), /empty isolated/);
});
test.after(async () => { await reset(); });
