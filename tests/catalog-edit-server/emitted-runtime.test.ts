import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import handler, { startRuntime, stopRuntime } from './runtime-provider.js';
import { credentialSessionLocator } from '../../api/_lib/credential-capability.js';
import { JOHN_ADMIN_SCOPE } from '../../api/_lib/credential-access-state.js';
import { authenticateEditor } from '../../api/_lib/catalog-edit-authorization.js';
import { saveEdit } from '../../api/_lib/catalog-edit-service.js';
import { parseEditRequest, object, requestHash, receiptPath } from '../../api/_lib/catalog-edit-policy.js';
import type { AccessResponse } from '../../api/_lib/credential-access-handler.js';

assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:8487$/);
assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '', /^127\.0\.0\.1:9397$/);
assert.equal(process.env.GCLOUD_PROJECT, 'demo-mutter-edit');
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_OAUTH_ACCESS_TOKEN', 'VERCEL_TOKEN'])
  assert.equal(process.env[key], undefined);
const app = initializeApp({ projectId: 'demo-mutter-edit' }, 'catalog-checkout');
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
let base = '', drops = 0, patchRequests = 0;
const failures: unknown[] = [];
const server = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    if (request.method === 'PATCH') patchRequests++;
    let status = 200;
    const output: AccessResponse = {
      setHeader(name, value) { response.setHeader(name, value); return output; },
      status(code) { status = code; return output; },
      json(value) {
        if (drops && request.method === 'PATCH' && status === 200) { drops--; request.socket.destroy(); return output; }
        response.statusCode = status; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)); return output;
      },
    };
    await handler({ url: request.url, method: request.method, headers: request.headers,
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
  await startRuntime();
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
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address === 'object'); base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  assert.deepEqual((await db.doc('orders/preserved').get()).data(), { state: 'legacy', data: { keep: true } });
  assert.equal((await db.doc('operations/webStockCutover').get()).get('state'), 'closed');
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await db.terminate(); await deleteApp(app); await stopRuntime(); assert.deepEqual(failures, []);
});

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
