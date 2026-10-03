import test from 'node:test';
import assert from 'node:assert/strict';
import { capture, validateDocuments } from './backup.mjs';
import { compare, proposeRepair } from './recovery.mjs';
import { localFirestore, restoreLocal, fieldSemantics } from './local-firestore.mjs';
import { ROOT } from './common.mjs';
import { product, incident } from './fixtures.mjs';
import { readOperations } from './operations.mjs';
import { DATABASE, digest } from './common.mjs';
import { readFile } from 'node:fs/promises';
import { COLLECTIONS } from './common.mjs';

test('late write and accredited deletion produce selective proposals only', () => {
  const before = product(); const current = product({ updateTime: '2026-10-02T00:00:00Z', fields: { stockTotal: { integerValue: '0' } } });
  const plan = proposeRepair([before], [current], incident(before, current));
  assert.equal(plan.productionAuthorized, false); assert.equal(plan.update.fields.stockTotal.integerValue, '5');
  assert.deepEqual(plan.currentDocument, { updateTime: current.updateTime });
  assert.deepEqual(proposeRepair([before], [], incident(before, null)).currentDocument, { exists: false });
  assert.equal(compare([before], [current])[0].kind, 'CHANGED_REQUIRES_EXPLANATION');
});
test('absence/version is not loss causality or repair authorization', () => {
  const before = product(); const i = incident(before, null); delete i.absenceCause;
  assert.throws(() => proposeRepair([before], [], i), /absence/);
  assert.throws(() => proposeRepair([before], [], { ...i, reviewedLoss: false }), /causality/);
});
for (const kind of ['recreated', 'sale', 'hold', 'order', 'newProduct', 'concurrentVersion', 'postBarrier']) {
  test(`selective repair blocks ${kind}`, () => {
    const before = product(); const current = product({ updateTime: '2026-10-02T00:00:00Z', fields: { stockTotal: { integerValue: '0' } } });
    const records = [current]; const i = incident(before, current);
    if (kind === 'recreated') current.createTime = '2026-10-02T00:00:00Z';
    if (kind === 'sale') records.push(product({ name: `${ROOT}/inventoryMovements/new`, fields: { kind: { stringValue: 'web_sale' } } }));
    if (kind === 'hold') current.fields.webReservations = { mapValue: { fields: { newHold: { mapValue: { fields: {} } } } } };
    if (kind === 'order') records.push(product({ name: `${ROOT}/orders/new`, fields: { inventory: { mapValue: { fields: { state: { stringValue: 'reserved' } } } } } }));
    if (kind === 'newProduct') records.push(product({ name: `${ROOT}/products/new` }));
    if (kind === 'concurrentVersion') current.updateTime = '2026-10-03T00:00:00Z';
    if (kind === 'postBarrier') i.admittedAtMs = 3;
    if (kind === 'hold' || kind === 'recreated') i.currentDocumentSha256 = digest(current);
    assert.throws(() => proposeRepair([before], records, i), /BLOCKED/);
  });
}
test('no bulk, foreign database or remote restore adapter', () => {
  assert.throws(() => proposeRepair([product()], [], { ...incident(product(), null), path: 'products/*/all' }), /single product/);
  assert.throws(() => localFirestore('https://firestore.googleapis.com'), /loopback/);
  assert.throws(() => localFirestore('http://127.0.0.1.attacker.invalid:8188'), /loopback/);
  assert.throws(() => validateDocuments([product({ name: 'projects/other/databases/(default)/documents/products/a' })]), /foreign/);
});
test('a forged loopback label cannot smuggle a remote restoration adapter', async () => {
  let called = false;
  await assert.rejects(restoreLocal({ origin: 'http://127.0.0.1:8188', project: 'demo-mutter-first-cutover', request: () => { called = true; } }, []), /sealed loopback/);
  assert.equal(called, false);
});
test('protobuf empty defaults normalize without confusing real field names', () => {
  const value = { mapValue: { stringValue: 'a field named mapValue' }, data: { mapValue: {} }, list: { arrayValue: {} }, nil: { nullValue: 'NULL_VALUE' } };
  assert.deepEqual(fieldSemantics(value), { mapValue: value.mapValue, data: { mapValue: { fields: {} } }, list: { arrayValue: { values: [] } }, nil: { nullValue: null } });
});
test('backup roots remain coupled to actual stock and reservation consumers', async () => {
  for (const path of ['checkout-service', 'payment-service', 'payment-transitions', 'web-admission', 'web-stock-sweep', 'order-reconciliation']) {
    const source = await readFile(new URL(`../../api/_lib/${path}.ts`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/\.collection\('([^']+)'\)/g)) assert.ok(COLLECTIONS.includes(match[1]), match[1]);
  }
});
test('operations collector projects in origin, exhausts pages, preserves failures and rejects partial coverage', async () => {
  let calls = 0;
  const result = await readOperations(async path => {
    assert.match(path, /fields=/); assert.doesNotMatch(path, /returnPartialSuccess/); calls++;
    return calls === 1 ? { operations: [{ name: `${DATABASE}/operations/a`, done: false }], nextPageToken: 'second' }
      : { operations: [{ name: `${DATABASE}/operations/b`, done: true, error: { code: 13 } }] };
  });
  assert.equal(result.pages, 2); assert.equal(result.active, 1); assert.equal(result.terminalErrorsRequiringTreatment, 1);
  assert.equal(result.commitWriteCoverage, false);
  await assert.rejects(readOperations(async () => ({ unreachable: ['x'] })), /unreachable/);
  await assert.rejects(readOperations(async () => ({ operations: [{ name: `${DATABASE}/operations/a`, response: { secret: 'synthetic' } }] })), /projection/);
});
test('backup rejects duplicate, invalid types and credential fields', () => {
  assert.throws(() => validateDocuments([product(), product()]), /duplicate/);
  assert.throws(() => validateDocuments([product({ fields: { x: { unknownValue: 1 } } })]), /unknown/);
  assert.throws(() => validateDocuments([product({ fields: { private_key: { stringValue: 'synthetic' } } })]), /credential/);
});
test('scanner exhausts pages and preserves raw types and missing parents', async () => {
  const d = product(); let pageReads = 0;
  const result = await capture(async (method, path) => {
    if (path.includes(':listCollectionIds')) return { collectionIds: [] };
    if (path.includes('/operations/')) return null;
    if (path.startsWith(`${ROOT}/products?`)) {
      pageReads++; return pageReads === 1 ? { documents: [d], nextPageToken: 'page2' } : { documents: [] };
    }
    return { documents: [] };
  });
  assert.equal(pageReads, 2); assert.deepEqual(result.documents, [d]);
});
test('backup read error, pagination cycle and unknown subcollection cannot become complete', async () => {
  await assert.rejects(capture(async () => { throw new Error('read failed'); }), /read failed/);
  await assert.rejects(capture(async () => ({ documents: [], nextPageToken: 'same' })), /pagination loop/);
  await assert.rejects(capture(async (method, path) => path.includes(':listCollectionIds') ? { collectionIds: ['unclassified'] } : { documents: [product()] }), /unclassified/);
});
