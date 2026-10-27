// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment, type TokenOptions } from '@firebase/rules-unit-testing';
import { BUYER_SCOPE, HASHED_CAPABILITY_FORMAT, JOHN_ADMIN_SCOPE, parseAccount, parseCutover, parseSession } from '../../api/_lib/credential-access-state.js';
import { credentialSessionLocator } from '../../api/_lib/credential-capability.js';

function fixture() {
  const now = Date.now(), secret = randomBytes(32).toString('hex');
  const uid = 'synthetic-buyer', epoch = 'synthetic-buyer-coexistence-epoch';
  const control = { schema: 2, phase: 'ENFORCED', epoch, legacyCutoffMs: now - 10_000,
    scope: JOHN_ADMIN_SCOPE, capabilityFormat: HASHED_CAPABILITY_FORMAT, subjectUid: 'synthetic-admin' };
  const account = { schema: 2, scope: BUYER_SCOPE, status: 'NATIVE_POST_CUTOVER', uid, epoch,
    nativeCreatedAtMs: now - 5_000, recoveryEmail: null, channelStatus: 'UNVERIFIED', channelEvidenceSha256: null,
    roles: { admin: false, superadmin: false } };
  const session = { schema: 2, scope: BUYER_SCOPE, capabilityFormat: HASHED_CAPABILITY_FORMAT, status: 'ACTIVE', uid, epoch,
    nativeCreatedAtMs: account.nativeCreatedAtMs, expiresAtMs: now + 60_000, proofKind: 'NEW_POST_CUTOVER',
    roles: { admin: false, superadmin: false } };
  return { uid, secret, locator: credentialSessionLocator(secret), control, account, session };
}
type Fixture = ReturnType<typeof fixture>;
const buyerClaims = (f: Fixture, extra: Record<string, unknown> = {}): TokenOptions => ({
  firebase: { sign_in_provider: 'custom', identities: {} }, mutterCredentialSession: f.secret,
  mutterCredentialEpoch: f.control.epoch, mutterCredentialScope: BUYER_SCOPE, admin: false, superadmin: false, ...extra,
});
// Rules contexts test authorization, not live Auth issuance or token revocation.
// Those server checks remain covered by the separate credential consumer gates.
async function seed(env: RulesTestEnvironment, f: Fixture) {
  // Fixtures must be accepted by the actual server parsers before testing Rules.
  expect(parseCutover(f.control).schema).toBe(2);
  expect(parseAccount(f.account)?.scope).toBe(BUYER_SCOPE);
  expect(parseSession(f.session)?.scope).toBe(BUYER_SCOPE);
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc('operations/credentialAccessCutover').set(f.control);
    await db.doc('operations/webStockCutover').set({ schema: 1, state: 'open', revision: 'synthetic-buyer-cutover', updatedAt: new Date() });
    await db.doc(`credentialAccess/${f.uid}`).set(f.account);
    await db.doc(`credentialSessions/${f.locator}`).set(f.session);
    for (const [path, value] of Object.entries({
      [`carts/${f.uid}`]: { cartItems: [] }, 'carts/foreign': { cartItems: [] },
      [`clients/${f.uid}`]: { uid: f.uid, name: 'Synthetic buyer' }, 'clients/foreign': { uid: 'foreign' },
      'clients/foreign@example.invalid': { uid: 'foreign' }, [`usuarios/${f.uid}`]: { uid: f.uid },
      'orders/own': { uid: f.uid, commerceVersion: 2 }, 'orders/foreign': { uid: 'foreign', commerceVersion: 2 },
      'products/p': { stockTotal: 5 }, 'categories/c': { name: 'Synthetic' },
      'adminUsers/admin@example.invalid': { uid: f.control.subjectUid, role: 'admin' },
    })) await db.doc(path).set(value);
  });
}
async function withRules(run: (env: RulesTestEnvironment, f: Fixture) => Promise<void>) {
  const endpoint = process.env.FIRESTORE_EMULATOR_HOST;
  if (!endpoint || !/^127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(endpoint)) throw new Error('A loopback Firestore emulator is required.');
  const port = Number(endpoint.split(':')[1]);
  if (!Number.isSafeInteger(port) || port > 65535) throw new Error('Invalid Firestore emulator port.');
  const env = await initializeTestEnvironment({ projectId: `demo-mutter-buyer-rules-${randomBytes(4).toString('hex')}`,
    firestore: { host: '127.0.0.1', port, rules: readFileSync('firebase.catalog-cutover.rules', 'utf8') } });
  const f = fixture();
  try { await env.clearFirestore(); await seed(env, f); await run(env, f); }
  finally { await env.cleanup(); }
}

test('buyer secret admits only owned cart/client/order data; private authority and catalogue writes stay server-owned', async () => {
  await withRules(async (env, f) => {
    const buyer = env.authenticatedContext(f.uid, buyerClaims(f)).firestore();
    for (const path of [`carts/${f.uid}`, `clients/${f.uid}`, 'orders/own']) await assertSucceeds(buyer.doc(path).get());
    await assertSucceeds(buyer.collection('orders').where('uid', '==', f.uid).get());
    await assertFails(buyer.collection('orders').get());
    await assertSucceeds(buyer.doc(`carts/${f.uid}`).set({ cartItems: [{ id: 'p', quantity: 1 }] }));
    await assertSucceeds(buyer.doc(`clients/${f.uid}`).update({ name: 'Updated' }));
    await assertFails(buyer.doc(`clients/${f.uid}`).update({ uid: 'foreign' }));
    await assertFails(buyer.doc(`clients/${f.uid}`).delete());
    await env.withSecurityRulesDisabled(context => context.firestore().doc(`clients/${f.uid}`).delete());
    await assertFails(buyer.doc(`clients/${f.uid}`).set({ uid: 'foreign', name: 'Forged' }));
    await assertSucceeds(buyer.doc(`clients/${f.uid}`).set({ uid: f.uid, name: 'Created' }));
    for (const path of ['carts/foreign', 'clients/foreign', 'clients/foreign@example.invalid', 'orders/foreign',
      `usuarios/${f.uid}`, 'adminUsers/admin@example.invalid']) {
      await assertFails(buyer.doc(path).get());
      await assertFails(buyer.doc(path).set({ uid: f.uid }));
    }
    for (const path of ['products/p', 'categories/c', 'categories/c/subcategories/s']) {
      await assertSucceeds(env.unauthenticatedContext().firestore().doc(path).get());
      await assertFails(buyer.doc(path).set({ stockTotal: 999 }));
    }
    for (const path of ['orders/own', 'orders/new', 'checkoutIntents/intent', 'webReservationOwners/hold',
      `credentialSessions/${f.locator}`, `credentialAccess/${f.uid}`, 'credentialRecoveryChallenges/challenge', 'operations/webStockCutover']) {
      if (!path.startsWith('orders/')) await assertFails(buyer.doc(path).get());
      await assertFails(buyer.doc(path).set({ uid: f.uid, status: 'ACTIVE' }));
      await assertFails(buyer.doc(path).delete());
    }
    await assertSucceeds(buyer.doc(`carts/${f.uid}`).delete());
  });
}, 60_000);

test('a locator, another UID, old providers, forged roles and foreign scopes do not prove buyer authority', async () => {
  await withRules(async (env, f) => {
    for (const extra of [
      { mutterCredentialSession: f.locator }, { mutterCredentialSession: randomBytes(32).toString('hex') },
      { mutterCredentialSession: 'A'.repeat(64) }, { mutterCredentialSession: `${f.secret}/forged` },
      { mutterCredentialEpoch: 'another-synthetic-credential-epoch' }, { mutterCredentialScope: JOHN_ADMIN_SCOPE },
      { mutterCredentialScope: 'UNKNOWN_SCOPE' }, { admin: true }, { superadmin: true }, { admin: null },
      { firebase: { sign_in_provider: 'password', identities: {} } }, { firebase: { sign_in_provider: 'anonymous', identities: {} } },
    ]) {
      const db = env.authenticatedContext(f.uid, buyerClaims(f, extra)).firestore();
      await assertFails(db.doc(`carts/${f.uid}`).get({ source: 'server' }));
      await assertFails(db.doc('adminUsers/admin@example.invalid').get({ source: 'server' }));
    }
    await assertFails(env.authenticatedContext('foreign', buyerClaims(f)).firestore().doc('carts/foreign').get());
  });
}, 60_000);

test('buyer session expiry, revocation, binding, proof and renewal locator are enforced', async () => {
  await withRules(async (env, f) => {
    const buyer = env.authenticatedContext(f.uid, buyerClaims(f)).firestore();
    for (const changes of [
      { status: 'REVOKED' }, { status: 'ISSUANCE_UNCERTAIN' }, { schema: 1 }, { uid: 'foreign' },
      { epoch: 'another-synthetic-credential-epoch' }, { scope: JOHN_ADMIN_SCOPE }, { capabilityFormat: 'RAW_SECRET' },
      { expiresAtMs: 1 }, { expiresAtMs: Date.now() + 8 * 86_400_000 }, { expiresAtMs: Date.now() + 60_000.5 },
      { proofKind: 'RECOVERY_CHANNEL' }, { passwordProof: null }, { roles: { admin: true, superadmin: false } },
      { roles: { admin: false, superadmin: 'false' } }, { nativeCreatedAtMs: f.account.nativeCreatedAtMs + 1 },
      { renewedToLocator: 'not-a-locator' },
    ]) {
      await env.withSecurityRulesDisabled(context => context.firestore().doc(`credentialSessions/${f.locator}`).set({ ...f.session, ...changes }));
      await assertFails(buyer.doc(`carts/${f.uid}`).get({ source: 'server' }));
    }
    await env.withSecurityRulesDisabled(context => context.firestore().doc(`credentialSessions/${f.locator}`).set({ ...f.session, renewedToLocator: 'f'.repeat(64) }));
    await assertSucceeds(buyer.doc(`carts/${f.uid}`).get({ source: 'server' }));
  });
}, 60_000);

test('buyer accounts require native post-cutover provenance and no restriction or recovery/Admin proof', async () => {
  await withRules(async (env, f) => {
    const buyer = env.authenticatedContext(f.uid, buyerClaims(f)).firestore();
    const changesets: Record<string, unknown>[] = [
      { schema: 1 }, { uid: 'foreign' }, { epoch: 'another-synthetic-credential-epoch' }, { scope: JOHN_ADMIN_SCOPE },
      { status: 'RECOVERED' }, { status: 'PENDING' }, { roles: { admin: true, superadmin: true } },
      { channelStatus: 'INDEPENDENTLY_VERIFIED' }, { recoveryEmail: 'buyer@example.invalid' }, { channelEvidenceSha256: '1'.repeat(64) },
      { restrictionAction: 'DISABLED' }, { restrictedAtMs: Date.now() }, { passwordProof: null }, { renewedToLocator: null },
      { nativeCreatedAtMs: f.control.legacyCutoffMs }, { nativeCreatedAtMs: Date.now() + 60_000 }, { nativeCreatedAtMs: 'yesterday' },
    ];
    for (const changes of changesets) {
      await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await db.doc(`credentialAccess/${f.uid}`).set({ ...f.account, ...changes });
        await db.doc(`credentialSessions/${f.locator}`).set({ ...f.session,
          nativeCreatedAtMs: 'nativeCreatedAtMs' in changes ? changes.nativeCreatedAtMs : f.session.nativeCreatedAtMs });
      });
      await assertFails(buyer.doc(`carts/${f.uid}`).get({ source: 'server' }));
    }
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`credentialAccess/${f.uid}`).set({ ...f.account, restrictionAction: null, restrictedAtMs: null });
      await context.firestore().doc(`credentialSessions/${f.locator}`).set(f.session);
    });
    await assertSucceeds(buyer.doc(`carts/${f.uid}`).get({ source: 'server' }));
  });
}, 60_000);

test('unknown control and either Admin subject cannot acquire buyer Rules authority', async () => {
  await withRules(async (env, f) => {
    const buyer = env.authenticatedContext(f.uid, buyerClaims(f)).firestore();
    for (const changes of [
      { schema: 3 }, { phase: 'PREPARED' }, { scope: BUYER_SCOPE }, { capabilityFormat: 'RAW_SECRET' },
      { epoch: 'another-synthetic-credential-epoch' }, { legacyCutoffMs: 0 }, { legacyCutoffMs: 'yesterday' },
      { subjectUid: 'invalid/uid' }, { subjectUid: f.uid },
      { additionalSubject: { uid: f.uid, email: 'buyer@example.invalid' } },
      { additionalSubject: { uid: 'another-admin', email: 'other@example.invalid', unexpected: true } },
    ]) {
      await env.withSecurityRulesDisabled(context => context.firestore().doc('operations/credentialAccessCutover').set({ ...f.control, ...changes }));
      await assertFails(buyer.doc(`carts/${f.uid}`).get({ source: 'server' }));
    }
    await env.withSecurityRulesDisabled(context => context.firestore().doc('operations/credentialAccessCutover').set({ ...f.control,
      additionalSubject: { uid: 'another-admin', email: 'other@example.invalid' } }));
    await assertSucceeds(buyer.doc(`carts/${f.uid}`).get({ source: 'server' }));
  });
}, 60_000);

test('closed purchases preserve buyer reads and deny every private buyer write', async () => {
  await withRules(async (env, f) => {
    await env.withSecurityRulesDisabled(context => context.firestore().doc('operations/webStockCutover').update({ state: 'closed' }));
    const buyer = env.authenticatedContext(f.uid, buyerClaims(f)).firestore();
    for (const path of [`carts/${f.uid}`, `clients/${f.uid}`, 'orders/own']) await assertSucceeds(buyer.doc(path).get());
    await assertFails(buyer.doc(`carts/${f.uid}`).set({ cartItems: [] }));
    await assertFails(buyer.doc(`carts/${f.uid}`).update({ cartItems: [] }));
    await assertFails(buyer.doc(`carts/${f.uid}`).delete());
    await assertFails(buyer.doc(`clients/${f.uid}`).update({ uid: f.uid, name: 'Closed' }));
    await assertFails(buyer.doc(`clients/${f.uid}`).delete());
    await env.withSecurityRulesDisabled(context => context.firestore().doc(`clients/${f.uid}`).delete());
    await assertFails(buyer.doc(`clients/${f.uid}`).set({ uid: f.uid, name: 'Closed' }));
  });
}, 60_000);

test('legacy schema1 is unchanged under control1, but cannot revive under control2; Admin schema2 gains no client permissions', async () => {
  await withRules(async (env, f) => {
    const oldUid = 'legacy-buyer', oldSecret = randomBytes(32).toString('hex'), adminSecret = randomBytes(32).toString('hex');
    const oldSession = { schema: 1, status: 'ACTIVE', uid: oldUid, epoch: f.control.epoch, expiresAtMs: Date.now() + 60_000,
      proofKind: 'RECOVERY_CHANNEL', roles: { admin: false, superadmin: false } };
    const oldAccount = { schema: 1, status: 'RECOVERED', uid: oldUid, epoch: f.control.epoch, recoveryEmail: 'legacy@example.invalid',
      channelStatus: 'INDEPENDENTLY_VERIFIED', channelEvidenceSha256: '1'.repeat(64), roles: { admin: false, superadmin: false } };
    const adminAccount = { ...oldAccount, schema: 2, scope: JOHN_ADMIN_SCOPE, uid: f.control.subjectUid,
      roles: { admin: true, superadmin: false } };
    const adminSession = { ...oldSession, schema: 2, scope: JOHN_ADMIN_SCOPE, uid: f.control.subjectUid,
      capabilityFormat: HASHED_CAPABILITY_FORMAT, roles: { admin: true, superadmin: false } };
    expect(parseAccount(adminAccount)?.scope).toBe(JOHN_ADMIN_SCOPE);
    expect(parseSession(adminSession)?.scope).toBe(JOHN_ADMIN_SCOPE);
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.doc('operations/credentialAccessCutover').set({ schema: 1, phase: 'ENFORCED', epoch: f.control.epoch, legacyCutoffMs: f.control.legacyCutoffMs });
      await db.doc(`credentialAccess/${oldUid}`).set(oldAccount);
      await db.doc(`credentialSessions/${oldSecret}`).set(oldSession);
      await db.doc(`carts/${oldUid}`).set({ cartItems: [] });
      await db.doc(`credentialAccess/${f.control.subjectUid}`).set(adminAccount);
      await db.doc(`credentialSessions/${credentialSessionLocator(adminSecret)}`).set(adminSession);
      await db.doc(`carts/${f.control.subjectUid}`).set({ cartItems: [] });
    });
    const legacy = env.authenticatedContext(oldUid, { firebase: { sign_in_provider: 'custom', identities: {} },
      mutterCredentialSession: oldSecret, mutterCredentialEpoch: f.control.epoch }).firestore();
    await assertSucceeds(legacy.doc(`carts/${oldUid}`).get());
    await assertSucceeds(legacy.doc(`carts/${oldUid}`).set({ cartItems: [] }));
    await env.withSecurityRulesDisabled(context => context.firestore().doc('operations/credentialAccessCutover').set(f.control));
    await assertFails(legacy.doc(`carts/${oldUid}`).get({ source: 'server' }));
    await assertFails(legacy.doc(`carts/${oldUid}`).set({ cartItems: [] }));
    const admin = env.authenticatedContext(f.control.subjectUid, { ...buyerClaims(f), mutterCredentialSession: adminSecret,
      mutterCredentialScope: JOHN_ADMIN_SCOPE, admin: true, superadmin: false }).firestore();
    await assertFails(admin.doc(`carts/${f.control.subjectUid}`).get());
    await assertFails(admin.doc('adminUsers/admin@example.invalid').get());
    await assertFails(admin.doc('orders/foreign').get());
  });
}, 60_000);
