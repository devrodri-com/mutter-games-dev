import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import handler from '../../api/catalog-edit.js';
import mediaHandler from '../../api/catalog-media.js';
import emittedHandler, { startRuntime, stopRuntime } from './runtime-provider.js';
import { prepareMedia, confirmMedia } from '../../api/_lib/catalog-media-service.js';
import { mediaPath, validateImage } from '../../api/_lib/catalog-media-policy.js';
import { credentialSessionLocator } from '../../api/_lib/credential-capability.js';
import { JOHN_ADMIN_SCOPE } from '../../api/_lib/credential-access-state.js';
import { authenticateEditor, assertCatalogWriteControl } from '../../api/_lib/catalog-edit-authorization.js';
import { saveEdit } from '../../api/_lib/catalog-edit-service.js';
import { parseEditRequest, object, requestHash, receiptPath } from '../../api/_lib/catalog-edit-policy.js';
import { parseCreateRequest, createRequestHash } from '../../api/_lib/catalog-edit-create-policy.js';
import { normalizeCatalogCreate } from '../../api/_lib/catalog-edit-create.js';
import { createPublication } from '../../api/_lib/catalog-edit-create-service.js';
import type { AccessResponse } from '../../api/_lib/credential-access-handler.js';
import { registerStockRuntimeCases } from './stock-runtime-cases.js';

assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:8487$/);
assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '', /^127\.0\.0\.1:9397$/);
assert.equal(process.env.GCLOUD_PROJECT, 'demo-mutter-edit');
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_OAUTH_ACCESS_TOKEN', 'VERCEL_TOKEN'])
  assert.equal(process.env[key], undefined);
const app = initializeApp({ projectId: 'demo-mutter-edit' }, 'catalog-checkout');
const useEmittedRuntime = process.env.MUTTER_TEST_EMITTED_RUNTIME === '1';
const auth = getAuth(app), db = getFirestore(app);
const epoch = 'synthetic_edit_epoch_v1';
const users = [
  { uid: 'synthetic-john', email: 'john@example.invalid' },
  { uid: 'synthetic-rodrigo', email: 'rodrigo@example.invalid' },
  { uid: 'synthetic-foreign', email: 'foreign@example.invalid' },
];
const identities: Array<{ uid: string; email: string; token: string; secret: string; locator: string }> = [];
const control = { schema: 2, phase: 'ENFORCED', epoch, legacyCutoffMs: Date.now() - 1000000,
  scope: JOHN_ADMIN_SCOPE, capabilityFormat: 'SHA256_LOCATOR_V1', subjectUid: users[0].uid,
  additionalSubject: users[1] };
let base = '', drops = 0, patchRequests = 0, postRequests = 0;
const failures: unknown[] = [];
const providerFiles = new Map<string, Record<string, unknown>>();
let providerReads = 0;
let providerHook: (() => Promise<void>) | undefined;
const provider = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'GET'); providerReads++;
    assert.equal(request.headers.authorization, `Basic ${Buffer.from('synthetic-private-image-key:').toString('base64')}`);
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const detail = /^\/v1\/files\/([a-zA-Z0-9_-]+)\/details$/.exec(url.pathname);
    let value: unknown;
    if (detail) value = providerFiles.get(detail[1]) ?? null;
    else {
      assert.equal(url.pathname, '/v1/files'); assert.equal(url.searchParams.get('limit'), '2');
      const name = /^name="([^"]+)"$/.exec(url.searchParams.get('searchQuery') ?? ''); assert(name);
      value = [...providerFiles.values()].filter(file => file.filePath === `${url.searchParams.get('path')}/${name[1]}`);
    }
    const hook = providerHook; providerHook = undefined; if (hook) await hook();
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value));
  } catch (error: unknown) { failures.push(error); response.statusCode = 500; response.end('{}'); }
});
const server = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    if (request.method === 'PATCH') patchRequests++;
    if (request.method === 'POST') postRequests++;
    let status = 200;
    const output: AccessResponse = {
      setHeader(name, value) { response.setHeader(name, value); return output; },
      status(code) { status = code; return output; },
      json(value) {
        if (drops && (request.method === 'PATCH' && status === 200 || request.method === 'POST' && [200, 201].includes(status))) { drops--; request.socket.destroy(); return output; }
        response.statusCode = status; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)); return output;
      },
    };
    const selectedHandler = useEmittedRuntime ? emittedHandler
      : request.url?.split('?')[0] === '/api/catalog-media' ? mediaHandler : handler;
    await selectedHandler({ url: request.url, method: request.method, headers: request.headers,
      body: Buffer.concat(chunks).toString('utf8') || undefined }, output);
  } catch (error) { failures.push(error); response.statusCode = 500; response.end('{}'); }
});
async function localRequest(path: string, method: string, headers: Record<string, string>, body?: unknown) {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<{ status: number; value: Record<string, unknown>; cache: string | undefined }>((resolve, reject) => {
    const request = httpRequest(base + path, { method, headers: { ...headers, ...(encoded === undefined ? {} : { 'content-length': String(Buffer.byteLength(encoded)) }) } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('error', reject);
      response.on('end', () => {
        try {
          const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); assert(object(value));
          resolve({ status: response.statusCode ?? 0, value, cache: response.headers['cache-control'] });
        } catch (error) { reject(error); }
      });
    });
    request.on('error', reject); request.end(encoded);
  });
}
async function call(index: number, id: string, method = 'GET', body?: unknown, operation?: string) {
  const response = await localRequest(`/api/catalog-edit?id=${encodeURIComponent(id)}${operation ? `&operationId=${operation}` : ''}`, method,
    { host: 'muttergames.com', origin: 'https://muttergames.com', authorization: `Bearer ${identities[index].token}`,
      'content-type': 'application/json' }, body);
  assert.equal(response.cache, 'no-store'); return response;
}
const fixture = () => ({ id: 'legacy-embedded-id', version: 'legacy-business-value', title: { es: 'Original', en: '', legacy: 'keep' },
  active: false, description: '<p style="color:red">Legacy untouched</p>', images: ['https://example.invalid/original', 'legacy:image'],
  category: 'legacy-category', subcategory: null, priceUSD: 'legacy-price', stockTotal: -4,
  variants: [{ custom: { keep: true }, options: [{ value: 'Legacy', stock: 'unknown', priceUSD: 3 }] }],
  webReservations: { inconsistentLegacy: { keep: true } }, unknown: { nested: ['keep', null, 17] },
  updatedAt: 'legacy-updatedAt', webCatalogVersion: '10:2', sortKey: 'legacy-order', slug: 'original-slug' });
async function seedProduct(id: string) { await db.doc(`products/${id}`).set(fixture()); const response = await call(0, id); assert.equal(response.status, 200, JSON.stringify(response.value)); return response.value; }
function version(value: Record<string, unknown>): string { assert.equal(typeof value.version, 'string'); return String(value.version); }
const patch = (baseVersion: string, changes: Record<string, unknown>, id = randomUUID()) =>
  ({ version: baseVersion, intent: 'edit', operationId: id, changes });

async function issueToken(uid: string, secret: string): Promise<string> {
  const custom = await auth.createCustomToken(uid, { mutterCredentialSession: secret,
    mutterCredentialEpoch: epoch, mutterCredentialScope: JOHN_ADMIN_SCOPE, admin: true, superadmin: false });
  const response = await fetch('http://127.0.0.1:9397/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=synthetic', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  assert.equal(response.status, 200); const value: unknown = await response.json(); assert(object(value)); assert.equal(typeof value.idToken, 'string');
  return String(value.idToken);
}
before(async () => {
  process.env.FIREBASE_PROJECT_ID = 'demo-mutter-edit';
  process.env.IMAGEKIT_PUBLIC_KEY = 'synthetic-public-image-key';
  process.env.IMAGEKIT_PRIVATE_KEY = 'synthetic-private-image-key';
  process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/synthetic';
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerAddress = provider.address(); assert(providerAddress && typeof providerAddress === 'object');
  process.env.MUTTER_DEMO_IMAGEKIT_API = `http://127.0.0.1:${providerAddress.port}`;
  await db.doc('operations/credentialAccessCutover').set(control);
  await db.doc('operations/webStockCutover').set({ schema: 1, state: 'closed', revision: 'synthetic_closed_web_control', updatedAt: Timestamp.now() });
  await db.doc('orders/preserved').set({ state: 'legacy', data: { keep: true } });
  for (const user of users) {
    await auth.createUser({ ...user, emailVerified: true });
    const secret = randomBytes(32).toString('hex'), locator = credentialSessionLocator(secret);
    await db.doc(`credentialAccess/${user.uid}`).set({ schema: 2, scope: JOHN_ADMIN_SCOPE, uid: user.uid, epoch,
      status: 'RECOVERED', recoveryEmail: user.email, channelStatus: 'INDEPENDENTLY_VERIFIED', channelEvidenceSha256: 'a'.repeat(64),
      roles: { admin: true, superadmin: false } });
    await db.doc(`credentialSessions/${locator}`).set({ schema: 2, status: 'ACTIVE', scope: JOHN_ADMIN_SCOPE,
      capabilityFormat: 'SHA256_LOCATOR_V1', uid: user.uid, epoch, expiresAtMs: Date.now() + 3600000,
      proofKind: 'RECOVERY_CHANNEL', roles: { admin: true, superadmin: false } });
    const token = await issueToken(user.uid, secret);
    identities.push({ ...user, token, secret, locator });
  }
  if (useEmittedRuntime) await startRuntime();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address === 'object'); base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  assert.deepEqual((await db.doc('orders/preserved').get()).data(), { state: 'legacy', data: { keep: true } });
  assert.equal((await db.doc('operations/webStockCutover').get()).get('state'), 'closed');
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  if (useEmittedRuntime) await stopRuntime();
  provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
  await db.terminate(); await deleteApp(app); assert.deepEqual(failures, []);
});

registerStockRuntimeCases({ call, patch, version, db, identities, fixture });

for (const index of [0, 1]) test(`named subject ${index} saves only explicit fields and full re-read preserves legacy contents`, async () => {
  const id = `edit-${index}`, first = await seedProduct(id), original = fixture();
  assert.deepEqual(first.product, original);
  const input = patch(version(first), { title: { es: `Changed ${index}` }, subtitle: 'New subtitle' });
  const saved = await call(index, id, 'PATCH', input); assert.equal(saved.status, 200); assert.equal(saved.value.status, 'CONFIRMED');
  assert.equal(saved.value.baseVersion, first.version); assert.equal(saved.value.operationId, input.operationId);
  assert.equal(saved.value.requestHash, requestHash(id, parseEditRequest(input))); assert.deepEqual(saved.value.changes, input.changes);
  const reread = await call(index, id); assert.equal(reread.status, 200); assert.equal(reread.value.version, saved.value.version);
  assert.deepEqual(reread.value.product, { ...original, title: { ...original.title, es: `Changed ${index}` }, subtitle: 'New subtitle' });
  const productTime = (await db.doc(`products/${id}`).get()).updateTime;
  const receiptTime = (await db.doc(receiptPath(identities[index].uid, input.operationId)).get()).createTime;
  assert(productTime && receiptTime); assert.equal(productTime.isEqual(receiptTime), true);
});
test('localized description and classification merge preserve all unedited languages and legacy keys', async () => {
  const id = 'localized-description';
  const raw = { ...fixture(), description: { es: '<p>Antes</p>', en: '<p style="color:red">Legacy</p>', pt: 'Preservar', extra: { untouched: true } },
    category: { id: 'old', name: 'Anterior', legacy: { preserved: true } },
    subcategory: { id: 'specific', categoryId: 'old', legacy: { preserved: true } } };
  await db.doc(`products/${id}`).set(raw);
  const first = await call(0, id);
  const changes = { description: { es: '<p>Nuevo</p>' }, category: { id: 'new', name: 'Nueva' }, subcategory: { categoryId: 'new' } };
  const saved = await call(0, id, 'PATCH', patch(version(first.value), changes)); assert.equal(saved.status, 200);
  const current = await call(0, id);
  assert.deepEqual(current.value.product, { ...raw, description: { ...raw.description, es: '<p>Nuevo</p>' },
    category: { ...raw.category, ...changes.category }, subcategory: { ...raw.subcategory, ...changes.subcategory } });
  const flatten = await call(0, id, 'PATCH', patch(version(current.value), { description: 'Would lose languages' }));
  assert.equal(flatten.status, 400);
  const invalid = await call(0, id, 'PATCH', patch(version(current.value), { description: { es: '<p onload=x>bad</p>' } }));
  assert.equal(invalid.status, 400); assert.deepEqual((await call(0, id)).value.product, current.value.product);
});
test('invalid effective classification is rejected without a product write or receipt for either administrator', async () => {
  const original = { ...fixture(), category: { id: 'original', name: 'Original', legacy: { keep: true } },
    subcategory: { id: 'specific', name: 'Específica', categoryId: 'original', legacy: ['keep'] } };
  const invalidChanges = [
    { category: { id: 'different', name: 'Diferente' } },
    { category: { id: '' } },
    { subcategory: { id: 'specific', categoryId: 'different' } },
    { subcategory: { id: '   ' } },
    { category: { id: 'x'.repeat(201) }, subcategory: { categoryId: 'x'.repeat(201) } },
  ];
  for (const index of [0, 1]) {
    const id = `classification-rejected-${index}`;
    await db.doc(`products/${id}`).set(original); const first = await call(index, id);
    const before = await db.doc(`products/${id}`).get(); assert(before.updateTime);
    for (const changes of invalidChanges) {
      const input = patch(version(first.value), changes), rejected = await call(index, id, 'PATCH', input);
      assert.equal(rejected.status, 400); assert.equal(rejected.value.applied, false);
      const after = await db.doc(`products/${id}`).get(); assert(after.updateTime);
      assert.equal(after.updateTime.isEqual(before.updateTime), true); assert.deepEqual(after.data(), original);
      assert.equal((await db.doc(receiptPath(identities[index].uid, input.operationId)).get()).exists, false);
      const receipt = await call(index, id, 'GET', undefined, input.operationId);
      assert.equal(receipt.status, 200); assert.equal(receipt.value.status, 'NOT_CONFIRMED');
      const reread = await call(index, id); assert.equal(reread.value.version, first.value.version);
      assert.deepEqual(reread.value.product, original);
    }
  }
});
for (const index of [0, 1]) test(`named subject ${index} saves a coherent classification pair and preserves unknown fields and publication state`, async () => {
  const id = `classification-valid-${index}`, original = { ...fixture(),
    category: { id: 'original', name: 'Original', legacy: { keep: true } },
    subcategory: { id: 'specific', name: 'Específica', categoryId: 'original', legacy: ['keep'] } };
  await db.doc(`products/${id}`).set(original); const first = await call(index, id);
  const changes = { category: { id: 'new', name: 'Nueva' }, subcategory: { id: 'new-specific', categoryId: 'new' } };
  const input = patch(version(first.value), changes), saved = await call(index, id, 'PATCH', input);
  assert.equal(saved.status, 200); assert.equal(saved.value.status, 'CONFIRMED');
  const expected = { ...original, category: { ...original.category, ...changes.category },
    subcategory: { ...original.subcategory, ...changes.subcategory } };
  const reread = await call(index, id); assert.equal(reread.value.version, saved.value.version);
  assert.deepEqual(reread.value.product, expected);
  const renamed = await call(index, id, 'PATCH', patch(version(reread.value), { category: { name: 'Otro nombre' } }));
  assert.equal(renamed.status, 200); assert.equal(renamed.value.status, 'CONFIRMED');
  assert.deepEqual((await call(index, id)).value.product, { ...expected, category: { ...expected.category, name: 'Otro nombre' } });
});
test('an unrelated edit preserves legacy invalid classification without repairing or normalizing it', async () => {
  const classifications = [
    { category: 'legacy-category', subcategory: null },
    { category: { id: 'original', legacy: { keep: true } }, subcategory: { id: 'specific', categoryId: 'different', legacy: ['keep'] } },
    { category: { id: '', name: null }, subcategory: { id: '', categoryId: '' } },
  ];
  for (const [position, classification] of classifications.entries()) {
    const id = `classification-untouched-${position}`, original = { ...fixture(), ...classification };
    await db.doc(`products/${id}`).set(original); const first = await call(position % 2, id);
    const saved = await call(position % 2, id, 'PATCH', patch(version(first.value), { subtitle: 'Sólo este campo' }));
    assert.equal(saved.status, 200); assert.equal(saved.value.status, 'CONFIRMED');
    assert.deepEqual((await call(position % 2, id)).value.product, { ...original, subtitle: 'Sólo este campo' });
  }
});
test('both writers share CAS: at most one same-base edit applies; rejected concurrent changes never replace fields', async () => {
  const first = await seedProduct('concurrent'), baseVersion = version(first);
  const results = await Promise.all([call(0, 'concurrent', 'PATCH', patch(baseVersion, { subtitle: 'John' })),
    call(1, 'concurrent', 'PATCH', patch(baseVersion, { subtitle: 'Rodrigo' }))]);
  assert(results.every(result => result.status === 200 || (result.status === 409 && result.value.applied === false)));
  assert(results.filter(result => result.status === 200).length <= 1);
  const saved = await call(0, 'concurrent');
  if (results.every(result => result.status === 409)) {
    assert.deepEqual(saved.value.product, fixture()); assert.equal(saved.value.version, baseVersion);
    // Explicit subsequent user action after both definitive conflicts, not a transport retry.
    assert.equal((await call(0, 'concurrent', 'PATCH', patch(version(saved.value), { subtitle: 'After conflict' }))).status, 200);
  } else assert(['John', 'Rodrigo'].includes(String(object(saved.value.product) && saved.value.product.subtitle)));
  const stale = await call(0, 'concurrent', 'PATCH', patch(baseVersion, { description: 'stale' }));
  assert.equal(stale.status, 409); assert.equal(stale.value.applied, false);
  const current = (await db.doc('products/concurrent').get()).data(); assert.equal(current?.description, fixture().description);
  assert.deepEqual(current?.unknown, fixture().unknown); assert.equal(current?.active, false);
});
test('lost HTTP acknowledgement resolves only through actor+product receipt; repeat UUID cannot create another write', async () => {
  const first = await seedProduct('lost-ack'), input = patch(version(first), { description: '<p>Actualizado <strong>seguro</strong></p>' });
  drops = 1; const before = patchRequests;
  await assert.rejects(call(0, 'lost-ack', 'PATCH', input));
  assert.equal(patchRequests, before + 1);
  const receipt = await call(0, 'lost-ack', 'GET', undefined, input.operationId);
  assert.equal(receipt.status, 200); assert.equal(receipt.value.status, 'CONFIRMED'); assert.equal(patchRequests, before + 1);
  const after = await call(0, 'lost-ack'); assert.equal(after.value.version, receipt.value.version);
  const other = await call(1, 'lost-ack', 'GET', undefined, input.operationId); assert.equal(other.value.status, 'NOT_CONFIRMED');
  const wrong = await call(0, 'different-id', 'GET', undefined, input.operationId); assert.equal(wrong.status, 409);
  const same = await call(0, 'lost-ack', 'PATCH', input); assert.equal(same.status, 200); assert.deepEqual(same.value, receipt.value);
  assert.equal((await call(0, 'lost-ack')).value.version, receipt.value.version);
  const changed = await call(0, 'lost-ack', 'PATCH', { ...input, changes: { description: 'Different' } });
  assert.equal(changed.status, 409); assert.equal((await call(0, 'lost-ack')).value.version, receipt.value.version);
});
test('forbidden operations, fields, other subjects and route/origin ambiguity cannot mutate a publication', async () => {
  const first = await seedProduct('forbidden'), baseline = (await db.doc('products/forbidden').get()).data();
  for (const code of [0, 9, 31, 47, 127]) {
    const response = await call(0, `invalid${String.fromCharCode(code)}id`);
    assert.equal(response.status, 400); assert.equal(response.value.applied, false);
  }
  const validId = 'publicación-😀';
  const valid = await seedProduct(validId);
  assert.equal(valid.id, validId); assert.deepEqual(valid.product, fixture());
  for (const changes of [{ active: true }, { images: [] }, { stockTotal: 1 }, { variants: [] }, { priceUSD: -1 },
    { unknown: {} }, { slug: 'new' }, { updatedAt: 'new' }, { credentialAccess: {} }]) {
    const response = await call(0, 'forbidden', 'PATCH', patch(version(first), changes)); assert.equal(response.status, 400); assert.equal(response.value.applied, false);
  }
  assert.equal((await call(0, 'forbidden', 'POST', {})).status, 400);
  assert.equal((await call(0, 'forbidden', 'DELETE', {})).status, 405);
  assert.equal((await call(2, 'forbidden', 'PATCH', patch(version(first), { subtitle: 'foreign' }))).status, 403);
  const publication = await call(0, 'forbidden', 'PATCH', { ...patch(version(first), { title: 'title' }), intent: 'publication' }); assert.equal(publication.status, 400);
  for (const suffix of ['?id=forbidden&id=other', '?id=forbidden&unknown=1', '?id=forbidden#fragment']) {
    let status = 200;
    const res: AccessResponse = { setHeader() {}, status(code) { status = code; return res; }, json() {} };
    await handler({ method: 'GET', url: '/api/catalog-edit' + suffix, headers: { host: 'muttergames.com', authorization: `Bearer ${identities[0].token}` } }, res);
    assert.equal(status, 400);
  }
  const foreign = await localRequest('/api/catalog-edit?id=forbidden', 'GET', { host: 'muttergames.com', origin: 'https://foreign.invalid', authorization: `Bearer ${identities[0].token}` });
  assert.equal(foreign.status, 403); assert.deepEqual((await db.doc('products/forbidden').get()).data(), baseline);
});
test('current email, protected account, expired capability and transaction-time revocation fail closed', async () => {
  const first = await seedProduct('authorization'), input = patch(version(first), { subtitle: 'not applied' });
  await auth.updateUser(users[1].uid, { email: 'changed@example.invalid' });
  assert.equal((await call(1, 'authorization', 'PATCH', input)).status, 401);
  identities[1].token = await issueToken(users[1].uid, identities[1].secret);
  assert.equal((await call(1, 'authorization', 'PATCH', input)).status, 403);
  await auth.updateUser(users[1].uid, { email: users[1].email });
  identities[1].token = await issueToken(users[1].uid, identities[1].secret);
  const account = db.doc(`credentialAccess/${users[1].uid}`), originalAccount = (await account.get()).data(); assert(originalAccount);
  await account.update({ recoveryEmail: 'wrong@example.invalid' }); assert.equal((await call(1, 'authorization', 'PATCH', input)).status, 403); await account.set(originalAccount);
  const session = db.doc(`credentialSessions/${identities[1].locator}`), originalSession = (await session.get()).data(); assert(originalSession);
  await session.update({ expiresAtMs: Date.now() - 1 }); assert.equal((await call(1, 'authorization', 'PATCH', input)).status, 403); await session.set(originalSession);
  const editor = await authenticateEditor(auth, db, `Bearer ${identities[1].token}`);
  await session.update({ status: 'REVOKED' });
  await assert.rejects(saveEdit(auth, db, editor, 'authorization', parseEditRequest(input)), { status: 403 }); await session.set(originalSession);
  const controlRef = db.doc('operations/credentialAccessCutover'); await controlRef.update({ epoch: 'changed_protected_epoch' });
  await assert.rejects(saveEdit(auth, db, editor, 'authorization', parseEditRequest(input)), { status: 403 }); await controlRef.set(control);
  await db.doc('operations/webStockCutover').update({ state: 'unknown' });
  const closed = await call(1, 'authorization', 'PATCH', input); assert.equal(closed.status, 503);
  await db.doc('operations/webStockCutover').update({ state: 'closed' });
  assert.deepEqual((await db.doc('products/authorization').get()).data(), fixture());
});
async function confirmedImage(index: number, id: string, url = `https://images.example.invalid/${randomUUID()}.jpg`) {
  const operationId = randomUUID(), uid = identities[index].uid;
  const ref = db.doc(`adminImageOperations/${createHash('sha256').update(uid).digest('hex')}-${operationId}`);
  await ref.set({ schema: 1, uid, operationId, productId: id, status: 'CONFIRMED', url, associatedProductId: null });
  return { operationId, url, ref };
}
const createInput = (operationId: string, images: string[], imageOperationIds: string[]) => ({ intent: 'create', operationId,
  imageOperationIds, product: { title: { es: 'Nueva consola', en: 'New console' }, description: '<p>Descripción segura</p>',
    category: { id: 'consoles', name: 'Consolas' }, subcategory: { id: 'new', name: 'Nuevas', categoryId: 'consoles' },
    tipo: 'Consola', active: true, images, priceUSD: 200, stockTotal: 0,
    variants: [{ label: { es: 'Modelo', en: 'Model' }, options: [{ value: 'Original', priceUSD: 200, stock: 0 }] }] } });

for (const index of [0, 1]) test(`named subject ${index} edits prices and fields without normalizing legacy stock or unknown metadata`, async () => {
  const id = `extended-edit-${index}`, original = fixture(); await db.doc(`products/${id}`).set(original);
  const first = await call(index, id), variants = structuredClone(original.variants); variants[0].options[0].priceUSD = 7;
  const changes = { variants, priceUSD: 7, sku: 'NEW-SKU', customName: 'Nombre', customNumber: '1', allowCustomization: true };
  const saved = await call(index, id, 'PATCH', patch(version(first.value), changes)); assert.equal(saved.status, 200, JSON.stringify(saved.value));
  const current = await call(index, id); assert.deepEqual(current.value.product, { ...original, ...changes });
  assert.equal(current.value.version, saved.value.version);
  const edited = object(current.value.product) && current.value.product; assert(edited);
  assert.equal(edited.stockTotal, -4); assert.equal(edited.active, false);
  assert.equal(edited.sortKey, 'legacy-order'); assert.equal(edited.slug, 'original-slug');
  assert.deepEqual(edited.webReservations, original.webReservations);
});
test('partial variant edits merge unknown keys while quantities, IDs, removed positions and reserved identities fail closed', async () => {
  const id = 'variant-boundaries', original = { ...fixture(), variants: [{ label: { es: 'Original', pt: 'Conservar' },
    custom: { keep: true }, options: [{ value: 'Legacy', priceUSD: 3, stock: 'unknown', variantId: 'keep-id', extra: true }] }] };
  await db.doc(`products/${id}`).set(original); const first = await call(0, id);
  const saved = await call(0, id, 'PATCH', patch(version(first.value), { variants: [{ options: [{ priceUSD: 9 }] }] }));
  assert.equal(saved.status, 200, JSON.stringify(saved.value));
  const next = structuredClone(original); next.variants[0].options[0].priceUSD = 9;
  assert.deepEqual((await call(0, id)).value.product, next);
  for (const variants of [[], [{ options: [] }], [{ options: [{ stock: 0 }] }], [{ options: [{ variantId: 'changed' }] }],
    [{ custom: {} }], [{ options: [{ value: 'Changed reserved identity' }] }], [{ label: { es: 'Changed reserved identity' } }]]) {
    const result = await call(0, id, 'PATCH', patch(String(saved.value.version), { variants }));
    assert.equal(result.status, 400, JSON.stringify({ variants, response: result.value }));
    assert.deepEqual((await call(0, id)).value.product, next);
  }
});
test('new options preserve existing quantities and permit only zero initial quantity during editing', async () => {
  const id = 'variant-append', original = { ...fixture(), webReservations: {}, variants: [{ label: { es: 'Modelo' }, options: [{ value: 'A', priceUSD: 3, stock: 8 }] }] };
  await db.doc(`products/${id}`).set(original); const first = await call(0, id);
  const bad = { variants: [{ options: [{}, { value: 'B', priceUSD: 4, stock: 1 }] }] };
  assert.equal((await call(0, id, 'PATCH', patch(version(first.value), bad))).status, 400);
  const changes = { variants: [{ options: [{}, { value: 'B', priceUSD: 4, stock: 0 }] }] };
  const saved = await call(0, id, 'PATCH', patch(version(first.value), changes)); assert.equal(saved.status, 200);
  assert.deepEqual((await call(0, id)).value.product, { ...original, variants: [{ label: { es: 'Modelo' },
    options: [...original.variants[0].options, { value: 'B', priceUSD: 4, stock: 0 }] }] });
});
test('image changes require actor and product bound receipts and atomically associate only new images', async () => {
  const first = await seedProduct('image-edit'), image = await confirmedImage(0, 'image-edit');
  const foreign = await confirmedImage(1, 'image-edit'), wrongTarget = await confirmedImage(0, 'another-product');
  for (const selected of [foreign, wrongTarget]) {
    const result = await call(0, 'image-edit', 'PATCH', { ...patch(version(first), { images: [...fixture().images, selected.url] }), imageOperationIds: [selected.operationId] });
    assert(result.status === 400 || result.status === 409); assert.equal((await selected.ref.get()).get('associatedProductId'), null);
  }
  const images = [...fixture().images, image.url];
  const input = { ...patch(version(first), { images }), imageOperationIds: [image.operationId] };
  const saved = await call(0, 'image-edit', 'PATCH', input); assert.equal(saved.status, 200, JSON.stringify(saved.value));
  assert.equal(saved.value.requestHash, requestHash('image-edit', parseEditRequest(input)));
  assert.equal((await image.ref.get()).get('associatedProductId'), 'image-edit');
  assert.deepEqual((await call(0, 'image-edit')).value.product, { ...fixture(), images: input.changes.images });
  const known = await call(1, 'image-edit', 'PATCH', patch(String(saved.value.version), { images: [...images].reverse() }));
  assert.equal(known.status, 200, JSON.stringify(known.value));
});
for (const index of [0, 1]) test(`named subject ${index} creates exactly one publication with matching receipt and full reread`, async () => {
  const operationId = randomUUID(), id = `admin-${operationId}`, image = await confirmedImage(index, id);
  const input = createInput(operationId, [image.url], [image.operationId]);
  input.product.priceUSD = 999; input.product.stockTotal = 123;
  const expected = normalizeCatalogCreate(input.product, operationId);
  const created = await call(index, id, 'POST', input); assert.equal(created.status, 201, JSON.stringify(created.value));
  assert.equal(created.value.intent, 'create'); assert.equal(created.value.id, id);
  assert.equal(created.value.requestHash, createRequestHash(id, parseCreateRequest(input))); assert.deepEqual(created.value.product, expected);
  assert(object(created.value.product)); assert.equal(created.value.product.slug, `nueva-consola-${operationId}`);
  assert.equal(created.value.product.sortKey, 'nuevaconsola'); assert.equal(created.value.product.priceUSD, 200);
  assert.equal(created.value.product.stockTotal, 0); assert.equal(created.value.product.active, true);
  assert.equal(created.value.product.createdAt, undefined); assert.equal(created.value.product.updatedAt, undefined);
  const after = await call(index, id); assert.equal(after.value.version, created.value.version); assert.deepEqual(after.value.product, expected);
  const receipt = await call(index, id, 'GET', undefined, operationId); assert.deepEqual(receipt.value, created.value);
  assert.equal((await image.ref.get()).get('associatedProductId'), id);
  assert.equal((await call(index, id, 'POST', input)).status, 201); assert.equal((await call(index, id)).value.version, created.value.version);
  assert.equal((await call(index, id, 'POST', { ...input, product: { ...input.product, title: 'Different' } })).status, 409);
  assert.deepEqual((await call(index, id)).value.product, expected);
  const other = await call(index === 0 ? 1 : 0, id, 'GET', undefined, operationId); assert.equal(other.value.status, 'NOT_CONFIRMED');
});
test('lost creation acknowledgement is resolved by GET without another POST', async () => {
  const operationId = randomUUID(), id = `admin-${operationId}`, image = await confirmedImage(0, id);
  const input = createInput(operationId, [image.url], [image.operationId]), sentBefore = postRequests;
  drops = 1; await assert.rejects(call(0, id, 'POST', input)); assert.equal(postRequests, sentBefore + 1);
  const receipt = await call(0, id, 'GET', undefined, operationId); assert.equal(receipt.value.status, 'CONFIRMED');
  assert.equal(postRequests, sentBefore + 1); assert.deepEqual((await call(0, id)).value.product, receipt.value.product);
});
test('creation never overwrites an existing product or admits another actor, target or unconfirmed image', async () => {
  const operationId = randomUUID(), id = `admin-${operationId}`, image = await confirmedImage(0, id), input = createInput(operationId, [image.url], [image.operationId]);
  await db.doc(`products/${id}`).set(fixture());
  assert.equal((await call(0, id, 'POST', input)).status, 409); assert.deepEqual((await call(0, id)).value.product, fixture());
  assert.equal((await image.ref.get()).get('associatedProductId'), null);
  assert.equal((await db.doc(receiptPath(users[0].uid, operationId)).get()).exists, false);
  const otherOperation = randomUUID(), otherId = `admin-${otherOperation}`, missing = createInput(otherOperation, [image.url], []);
  assert.equal((await call(0, otherId, 'POST', missing)).status, 400);
  assert.equal((await call(2, otherId, 'POST', missing)).status, 403);
  assert.equal((await call(0, 'wrong-target', 'POST', missing)).status, 400);
  assert.equal((await db.doc(`products/${otherId}`).get()).exists, false);
});
test('creation rechecks revoked session and maintenance control inside the transaction', async () => {
  const operationId = randomUUID(), id = `admin-${operationId}`, image = await confirmedImage(0, id);
  const input = parseCreateRequest(createInput(operationId, [image.url], [image.operationId]));
  const editor = await authenticateEditor(auth, db, `Bearer ${identities[0].token}`);
  const session = db.doc(`credentialSessions/${identities[0].locator}`), prior = (await session.get()).data(); assert(prior);
  await session.update({ status: 'REVOKED' });
  await assert.rejects(createPublication(auth, db, editor, id, input), { status: 403 }); await session.set(prior);
  await db.doc('operations/webStockCutover').update({ state: 'unknown' });
  await assert.rejects(createPublication(auth, db, editor, id, input), { status: 503 });
  await db.doc('operations/webStockCutover').update({ state: 'closed' });
  assert.equal((await db.doc(`products/${id}`).get()).exists, false);
  assert.equal((await db.doc(receiptPath(users[0].uid, operationId)).get()).exists, false);
  assert.equal((await image.ref.get()).get('associatedProductId'), null);
});
async function media(index: number, method: string, body?: unknown, operationId?: string, productId?: string) {
  const query = method === 'GET' ? `?${new URLSearchParams({ operationId: operationId ?? '', productId: productId ?? '' })}` : '';
  return localRequest(`/api/catalog-media${query}`, method, { host: 'muttergames.com', origin: 'https://muttergames.com',
    authorization: `Bearer ${identities[index].token}`, 'content-type': 'application/json' }, body);
}
function mediaInput(productId: string) {
  return { intent: 'prepare', operationId: randomUUID(), productId, fileName: 'publication.jpg', size: 17, mime: 'image/jpeg' };
}
function providerImage(input: ReturnType<typeof mediaInput>, issued: Record<string, unknown>) {
  assert(object(issued.fields));
  const fileId = `image-${input.operationId}`;
  const filePath = `${String(issued.fields.folder)}/${String(issued.fields.fileName)}`;
  const value = { fileId, fileType: 'image', size: input.size, filePath,
    url: `https://ik.imagekit.io/synthetic${filePath}?updatedAt=1792873175341` };
  providerFiles.set(fileId, value); return value;
}
test('media URL preserves the exact provider updatedAt URL and rejects endpoint, file and query substitutions', () => {
  const folder = `/mutter/admin/${'a'.repeat(64)}`, fileName = 'mutter-11111111-1111-4111-8111-111111111111.png';
  const filePath = `${folder}/${fileName}`, base = `https://ik.imagekit.io/synthetic${filePath}`;
  const value = { fileId: 'synthetic-file', fileType: 'image', size: 37361, filePath, url: `${base}?updatedAt=1792873175341` };
  const expected = { folder, fileName, size: 37361 };
  assert.deepEqual(validateImage(value, expected), { fileId: value.fileId, url: value.url });
  assert.equal(validateImage({ ...value, url: base }, expected).url, base);
  for (const stamp of ['1', '9007199254740991']) {
    const url = `${base}?updatedAt=${stamp}`; assert.equal(validateImage({ ...value, url }, expected).url, url);
  }
  for (const query of ['?', '?updatedAt=', '?updatedAt=0', '?updatedAt=-1', '?updatedAt=01', '?updatedAt=1.5',
    '?updatedAt=1e3', '?updatedAt=9007199254740992', '?updatedAt=1792873175341&updatedAt=1792873175341',
    '?updatedAt=1792873175341&tr=w-1', '?tr=w-1', '?ik-obj-version=synthetic', '?other=1', '?%75pdatedAt=1792873175341'])
    assert.throws(() => validateImage({ ...value, url: base + query }, expected), { status: 409 });
  for (const url of [base.replace('https:', 'http:'), base.replace('ik.imagekit.io', 'synthetic.invalid'),
    base.replace('/synthetic/', '/synthetic-other/'), base.replace(fileName, 'another.png'),
    base.replace('https://', 'https://synthetic:secret@'), `${base}#fragment`, `${base}#`])
    assert.throws(() => validateImage({ ...value, url }, expected), { status: 409 });
  for (const change of [{ filePath: `${folder}/another.png` }, { fileType: 'non-image' }, { size: 37362 }])
    assert.throws(() => validateImage({ ...value, ...change }, expected), { status: 409 });
  const endpoint = process.env.IMAGEKIT_URL_ENDPOINT;
  try {
    for (const invalid of [undefined, 'not-a-url', 'http://ik.imagekit.io/synthetic', 'https://ik.imagekit.io/',
      'https://synthetic:secret@ik.imagekit.io/synthetic', 'https://ik.imagekit.io/synthetic?other=1',
      'https://ik.imagekit.io/synthetic#fragment']) {
      if (invalid === undefined) delete process.env.IMAGEKIT_URL_ENDPOINT;
      else process.env.IMAGEKIT_URL_ENDPOINT = invalid;
      assert.throws(() => validateImage(value, expected), { status: invalid === undefined ? 503 : 409 });
    }
  } finally {
    if (endpoint === undefined) delete process.env.IMAGEKIT_URL_ENDPOINT;
    else process.env.IMAGEKIT_URL_ENDPOINT = endpoint;
  }
});
for (const index of [0, 1]) test(`named subject ${index} prepares one bound image and confirms provider evidence without leaking credentials`, async () => {
  const id = `media-product-${index}`; await seedProduct(id);
  const input = mediaInput(id), prepared = await media(index, 'POST', input);
  assert.equal(prepared.status, 200, JSON.stringify(prepared.value)); assert.equal(prepared.value.status, 'ISSUED');
  assert.equal(prepared.value.productId, id); assert.equal(prepared.value.imageOperationId, input.operationId);
  assert.equal(typeof prepared.value.token, 'string'); assert(object(prepared.value.fields));
  assert.equal(prepared.value.fields.overwriteFile, 'false'); assert.equal(prepared.value.fields.useUniqueFileName, 'false');
  const [header, payload, signature] = String(prepared.value.token).split('.'); assert(header && payload && signature);
  assert.equal(signature, createHmac('sha256', 'synthetic-private-image-key').update(`${header}.${payload}`).digest('base64url'));
  const jwt: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); assert(object(jwt));
  assert.equal(jwt.fileName, `mutter-${input.operationId}.jpg`); assert.equal(jwt.folder, `/mutter/admin/${createHash('sha256').update(users[index].uid).digest('hex')}`);
  assert.equal(jwt.checks, '"file.mime" = "image/jpeg" AND "file.size" = 17'); assert.equal(Number(jwt.exp) - Number(jwt.iat), 600);
  assert(!JSON.stringify(prepared.value).includes('synthetic-private-image-key'));
  const storedBefore = await db.doc(mediaPath(users[index].uid, input.operationId)).get();
  assert.equal(storedBefore.get('status'), 'ISSUED');
  const file = providerImage(input, prepared.value), observed = await media(index, 'GET', undefined, input.operationId, id);
  assert.equal(observed.status, 200); assert.equal(observed.value.status, 'UPLOADED'); assert.equal(observed.value.fileId, file.fileId);
  assert.equal((await db.doc(mediaPath(users[index].uid, input.operationId)).get()).updateTime?.isEqual(storedBefore.updateTime ?? Timestamp.now()), true);
  const closed = await media(index, 'POST', { intent: 'confirm', operationId: input.operationId, productId: id, fileId: file.fileId });
  assert.equal(closed.status, 200, JSON.stringify(closed.value)); assert.equal(closed.value.status, 'CONFIRMED');
  const beforeReads = providerReads;
  const receipt = await media(index, 'GET', undefined, input.operationId, id); assert.deepEqual(receipt.value, closed.value);
  assert.equal(providerReads, beforeReads); assert.deepEqual((await call(index, id)).value.product, fixture());
});
test('lost image preparation and confirmation acknowledgements resume by read only without another send', async () => {
  const id = 'media-lost'; await seedProduct(id);
  const input = mediaInput(id), postBefore = postRequests;
  drops = 1; await assert.rejects(media(0, 'POST', input)); assert.equal(postRequests, postBefore + 1);
  const first = await media(0, 'GET', undefined, input.operationId, id); assert.equal(first.value.status, 'ISSUED');
  assert.equal(first.value.token, undefined); assert.equal(postRequests, postBefore + 1);
  const planned = (await db.doc(mediaPath(users[0].uid, input.operationId)).get()).data(); assert(planned);
  const file = providerImage(input, { fields: { folder: planned.folder, fileName: planned.fileName } });
  const uploaded = await media(0, 'GET', undefined, input.operationId, id); assert.equal(uploaded.value.status, 'UPLOADED');
  drops = 1; await assert.rejects(media(0, 'POST', { intent: 'confirm', operationId: input.operationId, productId: id, fileId: file.fileId }));
  assert.equal(postRequests, postBefore + 2);
  const after = await media(0, 'GET', undefined, input.operationId, id); assert.equal(after.value.status, 'CONFIRMED');
  assert.equal(postRequests, postBefore + 2); assert.deepEqual((await call(0, id)).value.product, fixture());
});
test('media rejects other subjects, wrong targets, invalid sizes and provider path substitution', async () => {
  const id = 'media-boundary'; await seedProduct(id);
  const input = mediaInput(id), issued = await media(0, 'POST', input); assert.equal(issued.status, 200);
  const wrongActor = await media(1, 'GET', undefined, input.operationId, id); assert.equal(wrongActor.value.status, 'NOT_FOUND');
  assert.equal((await media(2, 'POST', mediaInput(id))).status, 403);
  assert.equal((await media(0, 'GET', undefined, input.operationId, 'other-product')).status, 409);
  for (const invalid of [{ size: 5000001 }, { mime: 'image/svg+xml' }, { fileName: 'file.png' }])
    assert.equal((await media(0, 'POST', { ...mediaInput(id), ...invalid })).status, 400);
  const file = providerImage(input, issued.value); providerFiles.set(file.fileId, { ...file, filePath: '/unrelated/file.jpg' });
  assert.equal((await media(0, 'POST', { intent: 'confirm', operationId: input.operationId, productId: id, fileId: file.fileId })).status, 409);
  assert.equal((await db.doc(mediaPath(users[0].uid, input.operationId)).get()).get('status'), 'ISSUED');
});
test('media revalidates session and write control before reservation and after provider observation before commit', async () => {
  const id = 'media-revocation'; await seedProduct(id); const input = mediaInput(id);
  const editor = await authenticateEditor(auth, db, `Bearer ${identities[0].token}`);
  const session = db.doc(`credentialSessions/${identities[0].locator}`), previous = (await session.get()).data(); assert(previous);
  await session.update({ status: 'REVOKED' }); await assert.rejects(prepareMedia(auth, db, editor, input), { status: 403 }); await session.set(previous);
  assert.equal((await db.doc(mediaPath(users[0].uid, input.operationId)).get()).exists, false);
  await db.doc('operations/webStockCutover').update({ state: 'unknown' });
  await assert.rejects(prepareMedia(auth, db, editor, input), { status: 503 });
  await db.doc('operations/webStockCutover').update({ state: 'closed' });
  assert.equal((await db.doc(mediaPath(users[0].uid, input.operationId)).get()).exists, false);
  const issued = await media(0, 'POST', input); assert.equal(issued.status, 200); const file = providerImage(input, issued.value);
  providerHook = async () => { await session.update({ status: 'REVOKED' }); };
  await assert.rejects(confirmMedia(auth, db, editor, { intent: 'confirm', operationId: input.operationId, productId: id, fileId: file.fileId }), { status: 403 });
  assert.equal((await db.doc(mediaPath(users[0].uid, input.operationId)).get()).get('status'), 'ISSUED'); await session.set(previous);
  assert.deepEqual((await call(0, id)).value.product, fixture());
});
test('catalogue write control admits validated closed, open and reconciling states', () => {
  const valid = { schema: 1, state: 'open', revision: 'synthetic_catalog_control', updatedAt: Timestamp.now() };
  assert.doesNotThrow(() => assertCatalogWriteControl(valid));
  assert.doesNotThrow(() => assertCatalogWriteControl({ ...valid, state: 'closed' }));
  assert.doesNotThrow(() => assertCatalogWriteControl({ ...valid, state: 'reconciling' }));
  for (const value of [undefined, {}, { ...valid, state: 'unknown' },
    { ...valid, schema: 2 }, { ...valid, revision: '' }, { ...valid, updatedAt: null },
    { ...valid, updatedAt: { toMillis: () => Number.NaN } }]) {
    assert.throws(() => assertCatalogWriteControl(value), { code: 'CATALOG_EDIT_CONTROL_UNAVAILABLE' });
  }
});
for (const state of ['open', 'reconciling']) for (const index of [0, 1]) test(`administrator ${index} opens, creates, edits, reads receipts and confirms media in ${state}`, async () => {
  const webControl = db.doc('operations/webStockCutover');
  await webControl.update({ state });
  try {
    const operationId = randomUUID(), id = `admin-${operationId}`;
    const image = await confirmedImage(index, id);
    const input = createInput(operationId, [image.url], [image.operationId]);
    input.product.active = false;
    const created = await call(index, id, 'POST', input);
    assert.equal(created.status, 201, JSON.stringify(created.value));
    const creationReceipt = await call(index, id, 'GET', undefined, operationId);
    assert.equal(creationReceipt.status, 200); assert.equal(creationReceipt.value.status, 'CONFIRMED');
    const first = await call(index, id); assert.equal(first.status, 200);
    const before = first.value.product; assert(object(before));
    const editRequest = patch(version(first.value), { subtitle: 'Edición local' });
    const edited = await call(index, id, 'PATCH', editRequest);
    assert.equal(edited.status, 200, JSON.stringify(edited.value));
    const editReceipt = await call(index, id, 'GET', undefined, editRequest.operationId);
    assert.equal(editReceipt.status, 200); assert.equal(editReceipt.value.status, 'CONFIRMED');
    assert.deepEqual((await call(index, id)).value.product, { ...before, subtitle: 'Edición local' });
    const mediaRequest = mediaInput(id), issued = await media(index, 'POST', mediaRequest);
    assert.equal(issued.status, 200, JSON.stringify(issued.value));
    const file = providerImage(mediaRequest, issued.value);
    const confirmed = await media(index, 'POST', { intent: 'confirm', operationId: mediaRequest.operationId,
      productId: id, fileId: file.fileId });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.value));
    assert.equal(confirmed.value.status, 'CONFIRMED');
    assert.deepEqual((await call(index, id)).value.product, { ...before, subtitle: 'Edición local' });
    assert.equal((await webControl.get()).get('state'), state);
  } finally { await webControl.update({ state: 'closed' }); }
});
test('revoked Auth identity is rejected through the real verifier', async () => {
  const first = await seedProduct('auth-revoked');
  await new Promise(resolve => setTimeout(resolve, 1200)); await auth.revokeRefreshTokens(users[1].uid);
  assert.equal((await call(1, 'auth-revoked', 'PATCH', patch(version(first), { subtitle: 'revoked' }))).status, 401);
  assert.deepEqual((await db.doc('products/auth-revoked').get()).data(), fixture());
});
