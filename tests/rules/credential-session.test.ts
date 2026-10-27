// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { test, expect } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment, type TokenOptions } from '@firebase/rules-unit-testing';

const epoch = 'synthetic-credential-epoch';
const uid = 'same-uid-buyer';
const cap = randomBytes(32).toString('hex');
const otherCap = randomBytes(32).toString('hex');
const control = { schema: 1, phase: 'ENFORCED', epoch, legacyCutoffMs: 1 };
const session = () => ({ schema: 1, status: 'ACTIVE', uid, epoch,
  expiresAtMs: Date.now() + 60_000, proofKind: 'RECOVERY_CHANNEL', roles: { admin: false, superadmin: false } });
const account = () => ({ schema: 1, status: 'RECOVERED', uid, epoch,
  recoveryEmail: 'buyer@example.invalid', channelStatus: 'INDEPENDENTLY_VERIFIED', channelEvidenceSha256: '1'.repeat(64),
  roles: { admin: false, superadmin: false } });
const claims = (extra: Record<string, unknown> = {}): TokenOptions => ({
  firebase: { sign_in_provider: 'custom', identities: {} }, mutterCredentialSession: cap, mutterCredentialEpoch: epoch, ...extra,
});
async function seed(env: RulesTestEnvironment) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc('operations/credentialAccessCutover').set(control);
    await db.doc('operations/webStockCutover').set({ schema: 1, state: 'open', revision: 'synthetic-cutover-credential', updatedAt: new Date() });
    await db.doc(`credentialSessions/${cap}`).set(session());
    await db.doc(`credentialAccess/${uid}`).set(account());
    for (const [path, value] of Object.entries({
      [`carts/${uid}`]: { cartItems: [{ id: 'p', quantity: 1 }] },
      [`clients/${uid}`]: { uid, name: 'Synthetic' }, [`usuarios/${uid}`]: { uid },
      'clients/foreign@example.invalid': { uid: 'foreign', name: 'Never inherited by email' },
      'orders/own': { uid, commerceVersion: 2 }, 'orders/foreign': { uid: 'foreign', commerceVersion: 2 },
      'products/p': { stockTotal: 5, webReservations: { hold: { quantity: 1 } } },
      'categories/c': { name: 'Synthetic' }, 'categories/c/subcategories/s': { name: 'Synthetic' },
      'adminUsers/admin@example.invalid': { uid: 'admin', role: 'admin' },
    })) await db.doc(path).set(value);
  });
}

for (const rulesFile of ['firebase.catalog-r1b.rules', 'firebase.catalog-cutover.rules']) {
  test(`${rulesFile}: protected session admission covers every private direct destination`, async () => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8188');
    const env = await initializeTestEnvironment({ projectId: `demo-mutter-credential-rules-${rulesFile.includes('cutover') ? 'cutover' : 'r1b'}`,
      firestore: { host: '127.0.0.1', port: 8188, rules: readFileSync(rulesFile, 'utf8') } });
    try {
      await env.clearFirestore(); await seed(env);
      const privatePaths = [`carts/${uid}`, `clients/${uid}`, `usuarios/${uid}`, 'orders/own', 'adminUsers/admin@example.invalid'];
      for (const provider of ['password', 'anonymous', 'custom'] as const) {
        const old = env.authenticatedContext(uid, { email: 'foreign@example.invalid', admin: true, superadmin: true,
          firebase: { sign_in_provider: provider, identities: {} } }).firestore();
        for (const path of privatePaths) await assertFails(old.doc(path).get());
        for (const path of privatePaths) await assertFails(old.doc(path).set({ forged: true }));
      }
      // Rules contexts exercise authorization shapes only. The separate Auth
      // matrix proves that older real sessions cannot acquire these fields.
      const buyer = env.authenticatedContext(uid, claims({ email: 'foreign@example.invalid', admin: true, superadmin: true })).firestore();
      for (const path of privatePaths.slice(0, 4)) await assertSucceeds(buyer.doc(path).get());
      for (const path of privatePaths.slice(0, 3)) await assertSucceeds(buyer.doc(path).update({ retained: true }));
      await assertFails(buyer.doc('orders/foreign').get());
      await assertFails(buyer.collection('orders').get());
      await assertSucceeds(buyer.collection('orders').where('uid', '==', uid).get());
      await assertFails(buyer.doc('clients/foreign@example.invalid').get());
      await assertFails(buyer.doc('clients/foreign@example.invalid').update({ stolen: true }));
      await assertFails(buyer.doc('adminUsers/admin@example.invalid').get());
      const publicDb = env.unauthenticatedContext().firestore();
      for (const path of ['products/p', 'categories/c', 'categories/c/subcategories/s']) {
        await assertSucceeds(publicDb.doc(path).get()); await assertFails(buyer.doc(path).update({ stockTotal: 999 }));
      }
      for (const collection of ['credentialSessions', 'credentialAccess', 'credentialRecoveryChallenges', 'operations']) {
        await assertFails(buyer.collection(collection).get());
        await assertFails(buyer.doc(`${collection}/${collection === 'credentialSessions' ? cap : uid}`).get());
        await assertFails(buyer.doc(`${collection}/${uid}`).set({ status: 'ACTIVE' }));
        await assertFails(buyer.doc(`${collection}/${uid}`).delete());
      }
      for (const changes of [
        { status: 'REVOKED' }, { uid: 'foreign' }, { epoch: 'another-credential-epoch' }, { expiresAtMs: 1 },
        { expiresAtMs: 'never' }, { expiresAtMs: 1.5 }, { proofKind: 'PASSWORD_LOGIN' }, { schema: 2 },
        { expiresAtMs: Date.now() + 8 * 24 * 60 * 60 * 1000 },
        { roles: { admin: 'true', superadmin: false } }, { roles: null },
      ]) {
        await env.withSecurityRulesDisabled(context => context.firestore().doc(`credentialSessions/${cap}`).set({ ...session(), ...changes }));
        await assertFails(buyer.doc(`carts/${uid}`).get({ source: 'server' })).catch((cause: unknown) => {
          throw new Error(`Invalid synthetic session ${JSON.stringify(changes)}`, { cause });
        });
      }
      await env.withSecurityRulesDisabled(context => context.firestore().doc(`credentialSessions/${cap}`).set(session()));
      for (const changes of [{ status: 'PENDING' }, { status: 'ACTIVE' }, { uid: 'foreign' }, { epoch: 'another-credential-epoch' },
        { channelStatus: 'UNVERIFIED' }, { channelEvidenceSha256: null }, { channelEvidenceSha256: 'wrong' },
        { recoveryEmail: null }, { recoveryEmail: 'not-an-email' }, { roles: { admin: 'true', superadmin: false } }]) {
        await env.withSecurityRulesDisabled(context => context.firestore().doc(`credentialAccess/${uid}`).set({ ...account(), ...changes }));
        await assertFails(buyer.doc(`carts/${uid}`).get());
      }
      await env.withSecurityRulesDisabled(context => context.firestore().doc(`credentialAccess/${uid}`).set(account()));
      for (const changes of [{ phase: 'PREPARED' }, { epoch: 'another-credential-epoch' }, { schema: 2 }, { legacyCutoffMs: 'yesterday' }, { legacyCutoffMs: 0 }]) {
        await env.withSecurityRulesDisabled(context => context.firestore().doc('operations/credentialAccessCutover').set({ ...control, ...changes }));
        await assertFails(buyer.doc(`carts/${uid}`).get());
      }
      await env.withSecurityRulesDisabled(context => context.firestore().doc('operations/credentialAccessCutover').set(control));
      for (const extra of [
        { mutterCredentialSession: otherCap }, { mutterCredentialSession: cap.toUpperCase() }, { mutterCredentialSession: `${cap}/forged` },
        { mutterCredentialSession: true }, { mutterCredentialEpoch: 'short' }, { mutterCredentialEpoch: null },
        { firebase: { sign_in_provider: 'password', identities: {} } },
      ]) await assertFails(env.authenticatedContext(uid, claims(extra)).firestore().doc(`carts/${uid}`).get());
      await assertFails(env.authenticatedContext('foreign', claims()).firestore().doc('carts/foreign').get());
      // Global role claims cannot upgrade the permission pinned on the session.
      await env.withSecurityRulesDisabled(async context => {
        await context.firestore().doc(`credentialSessions/${cap}`).set({ ...session(), roles: { admin: true, superadmin: true } });
        await context.firestore().doc(`credentialAccess/${uid}`).set({ ...account(), roles: { admin: true, superadmin: true } });
      });
      const noRole = env.authenticatedContext(uid, claims()).firestore();
      await assertFails(noRole.doc('orders/foreign').get());
      await assertSucceeds(buyer.doc('orders/foreign').get());
      await assertSucceeds(buyer.doc('adminUsers/admin@example.invalid').get());
      await env.withSecurityRulesDisabled(async context => {
        expect((await context.firestore().doc('products/p').get()).data()).toEqual({ stockTotal: 5, webReservations: { hold: { quantity: 1 } } });
        expect((await context.firestore().doc('orders/own').get()).data()).toEqual({ uid, commerceVersion: 2 });
      });
    } finally { await env.cleanup(); }
  }, 60_000);
}
