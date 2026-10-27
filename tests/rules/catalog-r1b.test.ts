// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { credentialClaims, seedCredentialAuthority } from './credential-fixtures';
const rules = readFileSync('firebase.catalog-r1b.rules', 'utf8');
const previous = readFileSync('tests/rules/fixtures/effective-r1.rules', 'utf8');
let env: RulesTestEnvironment;
const order = { uid: 'buyer', createdAt: 1, items: [{ id: 'withdrawn', quantity: 999, priceUSD: 1 }], shipping: {}, total: 1, paymentStatus: 'paid' };
beforeAll(async () => {
  expect(createHash('sha256').update(previous).digest('hex')).toBe('3dde75a5e9390b811488bac99fc725222602aae9615b4e22008a83af9031705e');
  env = await initializeTestEnvironment({ projectId: 'demo-mutter-r1b-rules', firestore: { host: '127.0.0.1', port: 8188, rules } });
  await env.clearFirestore();
  await seedCredentialAuthority(env, [
    { uid: 'buyer' }, { uid: 'anonymous' }, { uid: 'other' }, { uid: 'admin', admin: true },
    { uid: 'claim-only' }, { uid: 'anonymous-cart' }, { uid: 'registered-cart' },
  ]);
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await db.doc('orders/existing').set({ ...order, paymentStatus: 'pending' });
    await db.doc('checkoutIntents/existing').set({ uid: 'buyer', state: 'ready' });
    await db.doc('products/withdrawn').set({ active: false, stockTotal: 0, priceUSD: 100 });
    await db.doc('products/published').set({ active: true, stockTotal: 2, priceUSD: 100 });
    await db.doc('categories/c').set({ title: 'Synthetic' });
    await db.doc('categories/c/subcategories/s').set({ title: 'Synthetic' });
    await db.doc('adminUsers/admin@example.invalid').set({ active: true });
  });
});
afterAll(async () => { await env.cleanup(); });
test('exact previous effective policy accepts a forged paid order for withdrawn stock', async () => {
  const old = await initializeTestEnvironment({ projectId: 'demo-mutter-r1b-old-rules', firestore: { host: '127.0.0.1', port: 8188, rules: previous } });
  try {
    await old.clearFirestore();
    await old.withSecurityRulesDisabled(ctx => ctx.firestore().doc('products/withdrawn').set({ active: false, stockTotal: 0, priceUSD: 100 }));
    await assertSucceeds(old.authenticatedContext('buyer').firestore().doc('orders/forged').set(order));
  } finally { await old.cleanup(); }
});
for (const identity of ['unauthenticated', 'anonymous', 'buyer', 'other', 'admin'] as const) {
  test(`${identity} cannot create, replace, update or delete commercial records, including nested paths`, async () => {
    const context = identity === 'unauthenticated' ? env.unauthenticatedContext() : env.authenticatedContext(identity, credentialClaims(identity,
      identity === 'admin' ? { email: 'admin@example.invalid', admin: true } : { email: `${identity}@example.invalid` }));
    const db = context.firestore();
    for (const collection of ['orders', 'checkoutIntents']) {
      await assertFails(db.doc(`${collection}/forged-${identity}`).set({ ...order, uid: identity }));
      await assertFails(db.doc(`${collection}/existing`).set(order));
      for (const changes of [{ total: 1 }, { items: order.items }, { uid: identity }, { paymentStatus: 'paid' }, { state: 'ready' }, { preferenceId: 'forged' }]) {
        await assertFails(db.doc(`${collection}/existing`).update(changes));
      }
      await assertFails(db.doc(`${collection}/existing`).delete());
    }
    for (const path of ['orders/existing/lines/forged', 'checkoutIntents/existing/events/forged', 'usuarios/buyer/orders/forged', 'clients/buyer/orders/forged', 'carts/buyer/orders/forged', 'products/published/orders/forged']) {
      await assertFails(db.doc(path).set(order));
      await assertFails(db.doc(path).get());
    }
  });
}
test('own order get/query and verified effective administrator reads; foreign access and claim-only escalation denied', async () => {
  const buyer = env.authenticatedContext('buyer', credentialClaims('buyer')).firestore();
  await assertSucceeds(buyer.doc('orders/existing').get());
  await assertSucceeds(buyer.collection('orders').where('uid', '==', 'buyer').get());
  await assertFails(buyer.collection('orders').get());
  await assertFails(env.authenticatedContext('other', credentialClaims('other', { email: 'other@example.invalid' })).firestore().doc('orders/existing').get());
  await assertFails(env.unauthenticatedContext().firestore().doc('orders/existing').get());
  const admin = env.authenticatedContext('admin', credentialClaims('admin', { email: 'admin@example.invalid', admin: true })).firestore();
  await assertSucceeds(admin.doc('orders/existing').get());
  await assertSucceeds(admin.collection('orders').get());
  await assertFails(env.authenticatedContext('claim-only', credentialClaims('claim-only', { admin: true, email: 'claim@example.invalid' })).firestore().doc('orders/existing').get());
  for (const db of [buyer, admin]) await assertFails(db.doc('checkoutIntents/existing').get());
});
test('public catalog, server-owned admin edits, private anonymous/registered carts and client profile remain functional', async () => {
  const publicDb = env.unauthenticatedContext().firestore();
  for (const path of ['products/published', 'products/withdrawn', 'categories/c', 'categories/c/subcategories/s']) await assertSucceeds(publicDb.doc(path).get());
  const admin = env.authenticatedContext('admin', credentialClaims('admin', { email: 'admin@example.invalid', admin: true })).firestore();
  await assertFails(admin.doc('products/published').update({ title: 'Edited' }));
  await assertFails(env.authenticatedContext('buyer', credentialClaims('buyer')).firestore().doc('products/published').update({ active: true }));
  for (const uid of ['anonymous-cart', 'registered-cart']) {
    const db = env.authenticatedContext(uid, credentialClaims(uid, uid === 'registered-cart' ? { email: 'client@example.invalid' } : {})).firestore();
    await assertSucceeds(db.doc(`carts/${uid}`).set({ items: [{ id: 'published', quantity: 1 }] }));
    await assertSucceeds(db.doc(`carts/${uid}`).set({ items: [] }));
    await assertSucceeds(db.doc(`carts/${uid}`).get());
    await assertFails(db.doc('carts/other').set({ items: [] }));
    await assertFails(db.doc('carts/other').get());
    await assertSucceeds(db.doc(`clients/${uid}`).set({ name: 'Synthetic' }));
    await assertSucceeds(db.doc(`clients/${uid}`).update({ name: 'Updated' }));
    await assertSucceeds(db.doc(`clients/${uid}`).get());
  }
});
