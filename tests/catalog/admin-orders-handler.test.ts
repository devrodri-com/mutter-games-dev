// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import handler from '../../api/create-mp-preference';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8188' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9198') throw new Error('Exact loopback Firestore/Auth emulators required');
const app = initializeApp({ projectId: 'demo-mutter-r1' }, 'catalog-checkout');
const db = getFirestore(app), auth = getAuth(app);
const prefix = `zzzz-admin-orders-${randomUUID()}`;
const orderId = `${prefix}-01`, historicalId = `${prefix}-02`, productId = `${prefix}-product`;
const users = ['admin', 'superadmin', 'buyer', 'revoked', 'disabled', 'adminString', 'roleOnly', 'plain'].map(role => ({ role, uid: `${prefix}-${role}`, email: `${prefix}-${role}@example.invalid` }));
const claimsByRole: Record<string, Record<string, unknown>> = {
  admin: { admin: true }, superadmin: { superadmin: true }, revoked: { admin: true }, disabled: { admin: true },
  adminString: { admin: 'true' }, roleOnly: { role: 'admin' },
};
const tokens = new Map<string, string>();
const externalRequests: string[] = [];
const actualFetch = globalThis.fetch;
const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { externalRequests.push(url.origin); throw new Error('Nonlocal transport blocked'); }
  return actualFetch(input, init);
});
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  return Object.fromEntries(Object.entries(value));
}
function tokenFor(role: string): string {
  const token = tokens.get(role);
  if (!token) throw new Error('Missing synthetic token');
  return token;
}
async function invoke(body: unknown, token?: string) {
  let status = 0, output: unknown;
  const headers = new Map<string, string>();
  const response = { setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    status(code: number) { status = code; return response; }, json(value: unknown) { output = value; } };
  await handler({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }, response);
  expect(headers.get('cache-control')).toBe('no-store');
  return { status, body: record(output) };
}
beforeAll(async () => {
  for (const user of users) {
    await auth.createUser({ uid: user.uid, email: user.email });
    if (claimsByRole[user.role]) await auth.setCustomUserClaims(user.uid, claimsByRole[user.role]);
    const custom = await auth.createCustomToken(user.uid);
    const signed = await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=synthetic', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
    });
    expect(signed.ok).toBe(true);
    const body = record(await signed.json());
    if (typeof body.idToken !== 'string') throw new Error('Expected emulator ID token');
    tokens.set(user.role, body.idToken);
    expect((await auth.verifyIdToken(body.idToken, true)).uid).toBe(user.uid);
  }
  await db.doc(`orders/${orderId}`).set({ commerceVersion: 2, paymentStatus: 'approved', status: 'En proceso', currency: 'UYU',
    total: 100, createdAt: Timestamp.fromMillis(1000), lastVerifiedAt: 3000, approvedPaymentId: 'synthetic-payment',
    inventory: { state: 'committed', expiresAt: 2000, committedAt: 3000, reservationId: 'private-reservation', lines: [] },
    shipping: { pickup: true, name: 'Synthetic customer', email: 'customer@example.invalid', phone: '123' },
    items: [{ title: 'Producto', quantity: 1, unitPrice: 100 }], uid: 'private-owner', ipKey: 'private-ip',
    expectedCollectorId: 'private-collector', preferenceId: 'private-preference' });
  await db.doc(`orders/${historicalId}`).set({ status: 'Confirmado', paymentStatus: 'approved', total: 20, items: [] });
  await db.doc(`products/${productId}`).set({ stockTotal: 5, stockReserved: 1, title: 'Synthetic unchanged product' });
});
afterAll(async () => {
  transport.mockRestore();
  await Promise.all([db.doc(`orders/${orderId}`).delete(), db.doc(`orders/${historicalId}`).delete(), db.doc(`products/${productId}`).delete()]);
  await auth.deleteUsers(users.map(user => user.uid));
  await db.terminate(); await deleteApp(app);
});

test('R1-5 real Admin/superadmin claims reach bounded read-only list/detail without adminUsers', async () => {
  const before = await Promise.all([db.doc(`orders/${orderId}`).get(), db.doc(`orders/${historicalId}`).get(), db.doc(`products/${productId}`).get()]);
  for (const role of ['admin', 'superadmin']) {
    const user = users.find(user => user.role === role);
    if (!user) throw new Error('Missing synthetic user');
    expect((await db.doc(`adminUsers/${user.email}`).get()).exists).toBe(false);
    const verify = vi.spyOn(auth, 'verifyIdToken'); // Call-through observation: real Auth, no replacement.
    const page = await invoke({ action: 'admin_orders', limit: 1, cursor: { section: 'recent', id: `${prefix}-z`, createdAt: { seconds: 1, nanoseconds: 0 } } }, tokenFor(role));
    expect(verify).toHaveBeenCalledWith(tokenFor(role), true); verify.mockRestore();
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ orders: [{ id: orderId, paymentStatus: 'approved', inventoryState: 'committed', currency: 'UYU', total: 100 }] });
    const next = await invoke({ action: 'admin_orders', section: 'undated', limit: 1, cursor: { section: 'undated', id: orderId } }, tokenFor(role));
    expect(next.body).toMatchObject({ orders: [{ id: historicalId, historical: true, paymentStatus: 'historical_unverified' }] });
    const detail = await invoke({ action: 'admin_order', orderId }, tokenFor(role));
    expect(detail.status).toBe(200); expect(detail.body).toMatchObject({ order: { id: orderId, inventoryState: 'committed', committedAt: 3000 } });
    const json = JSON.stringify([page.body, detail.body]);
    for (const value of ['private-owner', 'private-ip', 'private-collector', 'private-preference', 'private-reservation']) expect(json).not.toContain(value);
  }
  const after = await Promise.all(before.map(snapshot => snapshot.ref.get()));
  expect(after.map(snapshot => ({ data: snapshot.data(), updateTime: snapshot.updateTime }))).toEqual(before.map(snapshot => ({ data: snapshot.data(), updateTime: snapshot.updateTime })));
  expect(externalRequests).toEqual([]);
});

test('R1-5 buyer, role-like and absent claims cannot grant Admin in either section and read no business collection', async () => {
  const reads = vi.spyOn(db, 'collection');
  for (const section of ['recent', 'undated']) for (const role of ['buyer', 'adminString', 'roleOnly', 'plain']) {
    const result = await invoke({ action: 'admin_orders', section, admin: true }, tokenFor(role));
    expect(result.status).toBe(403); expect(result.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(result.body).not.toHaveProperty('orders');
  }
  expect(reads).not.toHaveBeenCalled(); reads.mockRestore();
  expect(externalRequests).toEqual([]);
});

test('R1-5 revoked, disabled, invalid and missing tokens fail before business reads in either section', async () => {
  const revoked = users.find(user => user.role === 'revoked');
  const disabled = users.find(user => user.role === 'disabled');
  if (!revoked || !disabled) throw new Error('Missing synthetic user');
  // Auth token auth_time and tokensValidAfterTime have second precision.
  await new Promise(resolve => setTimeout(resolve, 1100));
  await auth.revokeRefreshTokens(revoked.uid);
  await auth.updateUser(disabled.uid, { disabled: true });
  const reads = vi.spyOn(db, 'collection');
  for (const section of ['recent', 'undated']) for (const token of [tokenFor('revoked'), tokenFor('disabled'), 'invalid-token', undefined]) {
    const result = await invoke({ action: 'admin_orders', section }, token);
    expect(result.status).toBe(401); expect(result.body).not.toHaveProperty('orders');
  }
  expect(reads).not.toHaveBeenCalled(); reads.mockRestore(); expect(externalRequests).toEqual([]);
});

test('R1-5 valid Admin gets explicit input/not-found errors, not empty success', async () => {
  const missing = await invoke({ action: 'admin_order', orderId: `${prefix}-absent` }, tokenFor('admin'));
  expect(missing.status).toBe(404); expect(missing.body).toMatchObject({ code: 'ORDER_NOT_FOUND' }); expect(missing.body).not.toHaveProperty('orders');
  const invalid = await invoke({ action: 'admin_orders', limit: 51 }, tokenFor('admin'));
  expect(invalid.status).toBe(400); expect(invalid.body).toMatchObject({ code: 'INVALID_INPUT' }); expect(invalid.body).not.toHaveProperty('orders');
  expect(externalRequests).toEqual([]);
});
