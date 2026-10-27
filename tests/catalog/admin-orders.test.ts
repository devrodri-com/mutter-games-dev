// @vitest-environment node
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { deleteApp } from 'firebase-admin/app';
import { randomUUID } from 'node:crypto';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { initializeDemoAdmin } from './demo-admin';
import { mintCredentialSession } from '../../api/_lib/credential-session';
import type { CredentialAccount } from '../../api/_lib/credential-access-state';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { adminOrders } from '../../api/_lib/admin-orders';

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Firestore emulator required');
const app = initializeDemoAdmin('catalog-checkout');
const db = getFirestore(app), auth = getAuth(app);
db.settings({ projectId: 'demo-mutter-admin-orders' });
const identities = new Map<string, DecodedIdToken>();
function claims(role: string): DecodedIdToken { const value = identities.get(role); if (!value) throw Error('Missing synthetic admission'); return value; }
const paid = {
  commerceVersion: 2, status: 'En proceso', estado: 'En proceso', paymentStatus: 'approved', total: 4990, currency: 'UYU',
  inventory: { state: 'committed', expiresAt: 2000, committedAt: 3000, reservationId: 'private-reservation', lines: [] },
  createdAt: Timestamp.fromMillis(1000), lastVerifiedAt: Timestamp.fromMillis(3000), approvedPaymentId: '12345',
  paymentDeadline: 2000, reconciliation: { state: 'complete', nextCheckAt: null, lastProgressAt: 3000, coverageUntil: 8000 },
  shipping: { pickup: false, name: 'Synthetic customer', email: 'synthetic@example.invalid', phone: '123', address: 'Synthetic address', department: 'Montevideo' },
  items: [{ title: { es: 'Consola' }, variantId: 'Color-Negro', quantity: 1, unitPrice: 4821 }], shippingCost: 169,
  uid: 'private-owner', expectedCollectorId: 'private-collector', preferenceId: 'private-preference', ipKey: 'private-ip-key',
};
const fixture: Record<string, Record<string, unknown>> = {
  a_paid: paid,
  b_reserved: { ...paid, paymentStatus: 'pending', approvedPaymentId: null, inventory: { state: 'reserved', expiresAt: 4000 } },
  c_released: { ...paid, paymentStatus: 'expired', approvedPaymentId: null, inventory: { state: 'released', expiresAt: 2000, releasedAt: 5000 } },
  d_late: { ...paid, attention: 'approved_without_stock', inventory: { state: 'released', expiresAt: 2000, releasedAt: 5000 } },
  e_duplicate: { ...paid, attention: 'duplicate_approved_payment' },
  f_review: { ...paid, paymentStatus: 'in_review', inventory: { state: 'reserved', expiresAt: 2000 }, attention: 'provider_verification_unavailable', reconciliation: { state: 'review', nextCheckAt: 8000, lastProgressAt: 3000, lastError: 'provider_verification_unavailable', coverageUntil: 9000 } },
  z_historical: { status: 'Confirmado', paymentStatus: 'approved', total: 25, client: { nombre: 'Historical' }, items: [] },
};
beforeAll(async () => {
  // Declared synthetic recovery authority; real issuance and Firebase verification
  // stay coupled. credential-closure-boundary verifies the recovery prerequisite.
  const epoch = 'synthetic-admin-orders-epoch';
  await db.doc('operations/credentialAccessCutover').set({ schema: 1, phase: 'ENFORCED', epoch, legacyCutoffMs: 1 });
  for (const role of ['admin', 'superadmin', 'buyer']) {
    const uid = `synthetic-orders-${randomUUID()}`, email = `${uid}@example.invalid`;
    await auth.createUser({ uid, email });
    const account: CredentialAccount = { schema: 1, uid, epoch, status: 'RECOVERED', recoveryEmail: email,
      channelStatus: 'INDEPENDENTLY_VERIFIED', channelEvidenceSha256: '4'.repeat(64),
      roles: { admin: role === 'admin', superadmin: role === 'superadmin' } };
    await db.doc(`credentialAccess/${uid}`).set(account);
    const issued = await mintCredentialSession(auth, db, account, 'RECOVERY_CHANNEL');
    if (!issued.customToken) throw Error('Missing synthetic issued capability');
    const response = await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=synthetic', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: issued.customToken, returnSecureToken: true }),
    });
    expect(response.status).toBe(200); const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('idToken' in value) || typeof value.idToken !== 'string') throw Error('Missing demo token');
    identities.set(role, await auth.verifyIdToken(value.idToken, true));
  }
  const old = await db.collection('orders').get(); await Promise.all(old.docs.map(doc => doc.ref.delete()));
  await Promise.all(Object.entries(fixture).map(([id, data], index) => db.collection('orders').doc(id).set({ ...data, ...(data.createdAt ? { createdAt: Timestamp.fromMillis(7000 - index * 1000) } : {}) })));
});
afterAll(async () => {
  for (const identity of identities.values()) {
    await auth.deleteUser(identity.uid); await db.doc(`credentialAccess/${identity.uid}`).delete();
    const sessions = await db.collection('credentialSessions').where('uid', '==', identity.uid).get();
    for (const session of sessions.docs) await session.ref.delete();
  }
  await db.doc('operations/credentialAccessCutover').delete(); await db.terminate(); await deleteApp(app);
});

test('R1-5 rejects non-admin and client role claims before any order read', async () => {
  const reads = vi.spyOn(db, 'collection');
  for (const untrustedRoles of [{}, { admin: 'true' }, { role: 'admin' }, { superadmin: 1 }]) {
    await expect(adminOrders(db, { ...claims('buyer'), ...untrustedRoles }, { action: 'admin_orders', admin: true })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  }
  expect(reads).not.toHaveBeenCalled(); reads.mockRestore();
});

test('R1-5 verified Admin capability reads bounded pages without an adminUsers document', async () => {
  const one = await adminOrders(db, claims('admin'), { action: 'admin_orders', limit: 2 });
  if (!('orders' in one)) throw new Error('Expected list');
  expect(one.orders.map(order => order.id)).toEqual(['a_paid', 'b_reserved']); expect(one.nextCursor).toEqual({ section: 'recent', id: 'b_reserved', createdAt: { seconds: 6, nanoseconds: 0 } });
  const two = await adminOrders(db, claims('superadmin'), { action: 'admin_orders', limit: 2, cursor: one.nextCursor });
  if (!('orders' in two)) throw new Error('Expected list');
  expect(two.orders.map(order => order.id)).toEqual(['c_released', 'd_late']);
  expect((await db.collection('adminUsers').get()).size).toBe(0);
  const data = JSON.stringify(one);
  for (const privateValue of ['private-owner', 'private-collector', 'private-preference', 'private-ip-key', 'private-reservation']) expect(data).not.toContain(privateValue);
  expect(one.orders[0]).toMatchObject({ total: 4990, currency: 'UYU', paymentStatus: 'approved', inventoryState: 'committed', committedAt: 3000 });
  expect(one.orders[1]).toMatchObject({ paymentStatus: 'pending', inventoryState: 'reserved', reservedUntil: 4000 });
});

test('R1-5 details expose canonical attention, release and delivery without changing orders or stock', async () => {
  const before = await db.collection('orders').get();
  const detail = await adminOrders(db, claims('admin'), { action: 'admin_order', orderId: 'f_review' });
  expect(detail).toMatchObject({ order: { paymentStatus: 'in_review', inventoryState: 'reserved', attention: 'provider_verification_unavailable',
    nextCheckAt: 8000, paymentDeadline: 2000, delivery: 'shipping', shipping: { department: 'Montevideo' },
    items: [{ title: 'Consola', variant: 'Color-Negro', quantity: 1, unitPrice: 4821 }],
    reconciliation: { state: 'review', lastError: 'provider_verification_unavailable' } } });
  expect(await adminOrders(db, claims('admin'), { action: 'admin_order', orderId: 'c_released' })).toMatchObject({ order: { inventoryState: 'released', releasedAt: 5000 } });
  expect(await adminOrders(db, claims('admin'), { action: 'admin_order', orderId: 'd_late' })).toMatchObject({ order: { attention: 'approved_without_stock' } });
  expect(await adminOrders(db, claims('admin'), { action: 'admin_order', orderId: 'e_duplicate' })).toMatchObject({ order: { attention: 'duplicate_approved_payment' } });
  const after = await db.collection('orders').get();
  expect(after.docs.map(doc => ({ id: doc.id, data: doc.data(), updateTime: doc.updateTime }))).toEqual(before.docs.map(doc => ({ id: doc.id, data: doc.data(), updateTime: doc.updateTime })));
  expect((await db.collection('inventoryMovements').get()).empty).toBe(true);
});

test('R1-5 historical records without a date remain visible and never become verified from legacy status', async () => {
  const page = await adminOrders(db, claims('admin'), { action: 'admin_orders', section: 'undated', limit: 50 });
  expect(page).toMatchObject({ orders: [{ id: 'z_historical', historical: true, paymentStatus: 'historical_unverified', inventoryState: 'historical', createdAt: null, currency: null }], nextCursor: null });
});

test('R1-5 rejects unbounded/invalid pages and treats storage errors as errors', async () => {
  for (const body of [{ action: 'admin_orders', limit: 51 }, { action: 'admin_orders', limit: 0 }, { action: 'admin_orders', cursor: 'orders/secret' }, { action: 'admin_order', orderId: '..' }, { action: 'admin_orders', uid: 'another-buyer' }]) {
    await expect(adminOrders(db, claims('admin'), body)).rejects.toMatchObject({ status: 400 });
  }
  await expect(adminOrders(db, claims('admin'), { action: 'admin_order', orderId: 'absent' })).rejects.toMatchObject({ status: 404 });
  const reads = vi.spyOn(db, 'collection').mockImplementationOnce(() => { throw new Error('synthetic storage unavailable'); });
  await expect(adminOrders(db, claims('admin'), { action: 'admin_orders' })).rejects.toThrow('synthetic storage unavailable'); reads.mockRestore();
});
