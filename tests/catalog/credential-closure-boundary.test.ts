// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect, vi } from 'vitest';
import { deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp as clientApp, deleteApp as deleteClientApp } from 'firebase/app';
import { connectAuthEmulator, getAuth as getClientAuth, confirmPasswordReset } from 'firebase/auth';
import { handleCredentialAccess, type AccessAction } from '../../api/_lib/credential-access-handler';
import { requireCredentialSession } from '../../api/_lib/credential-session';
import type { CredentialAccount } from '../../api/_lib/credential-access-state';
import { initializeDemoAdmin } from './demo-admin';

const projectId = 'demo-mutter-r1';
const epoch = 'synthetic-closure-epoch';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected synthetic object');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string { if (typeof value !== 'string') throw Error('Expected synthetic string'); return value; }
function account(uid: string, email: string | null, admin = false): CredentialAccount {
  return { schema: 1, uid, epoch, status: 'PENDING', recoveryEmail: email,
    channelStatus: email ? 'INDEPENDENTLY_VERIFIED' : 'UNVERIFIED', channelEvidenceSha256: email ? '2'.repeat(64) : null,
    roles: { admin, superadmin: admin } };
}
async function harness() {
  expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:9198');
  expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8188');
  const name = `closure-${randomUUID()}`;
  const app = initializeDemoAdmin(name), auth = getAuth(app), db = getFirestore(app);
  const client = clientApp({ projectId, apiKey: 'synthetic' }, name), browserAuth = getClientAuth(client);
  connectAuthEmulator(browserAuth, 'http://127.0.0.1:9198', { disableWarnings: true });
  const actualFetch = globalThis.fetch;
  let externalAttempts = 0, resetRequests = 0;
  const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { externalAttempts++; throw Error('Synthetic loopback transport only'); }
    if (url.pathname.endsWith('/accounts:sendOobCode')) {
      resetRequests++;
      if (url.searchParams.has('key')) {
        expect(new Headers(init?.headers).get('X-Firebase-Locale')).toBe('es');
        const body = object(JSON.parse(text(init?.body)));
        expect(body.requestType).toBe('PASSWORD_RESET'); expect(body.returnOobLink).toBe(false);
        expect(body.canHandleCodeInApp).toBe(false);
        expect(new URL(text(body.continueUrl)).origin).toBe('http://127.0.0.1:5173');
      }
      return actualFetch(input, init);
    }
    return actualFetch(input, init);
  });
  const ownedUsers = new Set<string>();
  async function post(action: string, body: unknown, expected = 200) {
    const response = await fetch(`http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:${action}?key=synthetic`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(response.status, `Auth ${action} status`).toBe(expected);
    return object(await response.json());
  }
  async function refresh(value: unknown) {
    const response = await fetch('http://127.0.0.1:9198/securetoken.googleapis.com/v1/token?key=synthetic', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: text(value) }),
    });
    expect(response.status).toBe(200); return object(await response.json());
  }
  async function access(action: AccessAction, body: unknown, token?: string) {
    let status = 0, output: unknown;
    const res = { setHeader() {}, status(code: number) { status = code; return res; }, json(value: unknown) { output = value; } };
    await handleCredentialAccess(action, auth, db, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
    return { status, body: object(output) };
  }
  async function firestore(token: string | undefined, path: string, method = 'GET') {
    return fetch(`http://127.0.0.1:8188/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(method === 'PATCH' ? { body: JSON.stringify({ fields: { forged: { booleanValue: true } } }) } : {}),
    });
  }
  async function oob(email: string) {
    const result = await fetch(`http://127.0.0.1:9198/emulator/v1/projects/${projectId}/oobCodes`);
    expect(result.status).toBe(200);
    const codes = object(await result.json()).oobCodes;
    if (!Array.isArray(codes)) throw Error('Expected synthetic mailbox');
    const matches = codes.map(object).filter(value => value.email === email);
    const code = matches.at(-1); if (!code) throw Error('Expected official demo reset');
    const url = new URL(text(code.oobLink)), continueUrl = new URL(text(url.searchParams.get('continueUrl')));
    const nonce = new URLSearchParams(continueUrl.hash.slice(1)).get('recovery');
    if (!nonce) throw Error('Expected mailed recovery proof');
    return { code: text(code.oobCode), nonce, url };
  }
  async function newPasswordUser(admin = false) {
    const uid = `synthetic-closure-${randomUUID()}`, email = `${uid}@example.invalid`, password = `synthetic-${randomUUID()}`;
    await auth.createUser({ uid, email, password }); ownedUsers.add(uid);
    await auth.setCustomUserClaims(uid, { admin, superadmin: admin });
    return { uid, email, password, signed: await post('signInWithPassword', { email, password, returnSecureToken: true }) };
  }
  const setControl = () => db.doc('operations/credentialAccessCutover').set({ schema: 1, phase: 'ENFORCED', epoch, legacyCutoffMs: Date.now() });
  return { auth, db, browserAuth, ownedUsers, post, refresh, access, firestore, oob, newPasswordUser, setControl,
    resetRequests: () => resetRequests,
    dispose: async () => {
      expect(externalAttempts).toBe(0); transport.mockRestore();
      for (const uid of ownedUsers) await auth.deleteUser(uid);
      await deleteClientApp(client); await db.terminate(); await deleteApp(app);
    } };
}

test('original derived credential, pending containment, official recovery and per-session claims form one real SDK/REST/Rules sequence', async () => {
  const h = await harness();
  const uid = `synthetic-john-${randomUUID()}`, email = `${uid}@example.invalid`, password = `synthetic-${randomUUID()}`;
  let env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8188,
    rules: readFileSync('tests/rules/fixtures/pre-credential-closure-r1b.rules', 'utf8') } });
  try {
    await env.clearFirestore();
    expect(createHash('sha256').update(readFileSync('tests/rules/fixtures/pre-credential-closure-r1b.rules')).digest('hex'))
      .toBe('35f9b4376380ff95732ac4c6f4fa9b15b410ba03ca9fdce9e20610ba6cefbbda');
    await h.auth.createUser({ uid }); h.ownedUsers.add(uid);
    await h.auth.setCustomUserClaims(uid, { admin: true, superadmin: true });
    const original = await h.post('signInWithCustomToken', { token: await h.auth.createCustomToken(uid), returnSecureToken: true });
    await h.post('update', { idToken: text(original.idToken), email, password, returnSecureToken: true });
    const derived = await h.post('signInWithPassword', { email, password, returnSecureToken: true });
    const oldRefresh = await h.refresh(derived.refreshToken);
    const oldToken = text(derived.idToken);
    const historicalOob = new URL(await h.auth.generatePasswordResetLink(email));
    const historicalCode = text(historicalOob.searchParams.get('oobCode'));
    expect((await h.auth.verifyIdToken(oldToken, true)).firebase.sign_in_provider).toBe('password');
    const durable = {
      [`carts/${uid}`]: { cartItems: [{ id: 'p', quantity: 2 }], untouched: 'same uid' },
      [`clients/${uid}`]: { uid, name: 'Synthetic' }, [`usuarios/${uid}`]: { uid },
      'orders/synthetic-existing': { uid, commerceVersion: 2, total: 100, inventory: { state: 'reserved' } },
      'products/p': { stockTotal: 7, webReservations: { synthetic: { quantity: 2 } }, title: 'Unchanged' },
      'categories/c': { name: 'Unchanged' }, 'categories/c/subcategories/s': { name: 'Unchanged' },
    };
    for (const [path, value] of Object.entries(durable)) await h.db.doc(path).set(value);
    expect((await h.firestore(oldToken, `carts/${uid}`)).status).toBe(200); // Original defect at real Rules destination.
    await h.setControl(); await h.db.doc(`credentialAccess/${uid}`).set(account(uid, email, true));
    await env.cleanup();
    env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8188, rules: readFileSync('firebase.catalog-cutover.rules', 'utf8') } });
    for (const token of [oldToken, text(oldRefresh.id_token), text(original.idToken)]) {
      expect((await h.access('session', {}, token)).status).toBe(403);
      for (const path of Object.keys(durable).filter(path => !path.startsWith('products/') && !path.startsWith('categories/')))
        expect((await h.firestore(token, path)).status).toBe(403);
    }
    expect((await h.firestore(undefined, 'products/p')).status).toBe(200);
    const acknowledgment = await h.access('request', { email });
    expect(acknowledgment).toEqual({ status: 202, body: { status: 'REQUEST_RECEIVED' } });
    expect(await h.access('request', { email: 'unknown@example.invalid' })).toEqual(acknowledgment);
    const mailed = await h.oob(email); // Demo mailbox access models possession, never production mail delivery.
    expect((await h.access('complete', { nonce: mailed.nonce }, oldToken)).status).toBe(403); // Reset not completed.
    expect((await h.access('complete', { nonce: '3'.repeat(64) }, oldToken)).status).toBe(403);
    const wrong = await h.newPasswordUser();
    expect((await h.access('complete', { nonce: mailed.nonce }, text(wrong.signed.idToken))).status).toBe(403);
    const newPassword = `synthetic-return-${randomUUID()}`;
    await confirmPasswordReset(h.browserAuth, mailed.code, newPassword);
    const returned = await h.post('signInWithPassword', { email, password: newPassword, returnSecureToken: true });
    const recovered = await h.access('complete', { nonce: mailed.nonce }, text(returned.idToken));
    expect(recovered.status).toBe(200); expect(recovered.body.uid).toBe(uid);
    const custom = await h.post('signInWithCustomToken', { token: text(recovered.body.customToken), returnSecureToken: true });
    const capToken = text(custom.idToken), capClaims = await h.auth.verifyIdToken(capToken, true);
    expect(typeof capClaims.mutterCredentialSession).toBe('string');
    expect(capClaims.mutterCredentialEpoch).toBe(epoch);
    expect(await requireCredentialSession(h.auth, h.db, capClaims, 'admin')).toMatchObject({ uid, admin: true, superadmin: true });
    expect((await h.auth.getUser(uid)).customClaims).toEqual({ admin: true, superadmin: true }); // No global capability.
    const renewed = await h.refresh(custom.refreshToken);
    expect((await h.auth.verifyIdToken(text(renewed.id_token), true)).mutterCredentialSession).toBe(capClaims.mutterCredentialSession);
    const ordinary = await h.post('signInWithPassword', { email, password: newPassword, returnSecureToken: true });
    expect((await h.auth.verifyIdToken(text(ordinary.idToken), true)).mutterCredentialSession).toBeUndefined();
    expect((await h.access('session', {}, text(ordinary.idToken))).status).toBe(403);
    // Even a refresh issued before the new custom session must never inherit its capability.
    for (const refreshToken of [derived.refreshToken, original.refreshToken]) {
      const olderRenewed = await h.refresh(refreshToken);
      expect((await h.auth.verifyIdToken(text(olderRenewed.id_token))).mutterCredentialSession).toBeUndefined();
      expect((await h.access('session', {}, text(olderRenewed.id_token))).status).toBe(403);
    }
    for (const rules of ['firebase.catalog-r1b.rules', 'firebase.catalog-cutover.rules']) {
      await env.cleanup(); env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8188, rules: readFileSync(rules, 'utf8') } });
      expect((await h.firestore(capToken, `carts/${uid}`)).status).toBe(200);
      expect((await h.firestore(text(ordinary.idToken), `carts/${uid}`)).status).toBe(403);
      expect((await h.firestore(capToken, `credentialSessions/${text(capClaims.mutterCredentialSession)}`)).status).toBe(403);
      expect((await h.firestore(capToken, `credentialAccess/${uid}`, 'PATCH')).status).toBe(403);
    }
    expect((await h.access('complete', { nonce: mailed.nonce }, text(returned.idToken))).status).toBe(403); // Consumed proof.
    await expect(confirmPasswordReset(h.browserAuth, mailed.code, `synthetic-unused-${randomUUID()}`)).rejects.toMatchObject({ code: 'auth/invalid-action-code' });
    await h.post('signInWithPassword', { email, password, returnSecureToken: true }, 400);
    // The demo provider deliberately retains other unused OOB actions. Even
    // that adverse provider behavior cannot turn an old link into admission.
    const historicalPassword = `synthetic-old-link-${randomUUID()}`;
    await confirmPasswordReset(h.browserAuth, historicalCode, historicalPassword);
    const historicalLogin = await h.post('signInWithPassword', { email, password: historicalPassword, returnSecureToken: true });
    expect((await h.access('session', {}, text(historicalLogin.idToken))).status).toBe(403);
    expect((await h.firestore(text(historicalLogin.idToken), `carts/${uid}`)).status).toBe(403);
    // Direct account changes remain outside Rules. A fresh password-derived
    // credential still cannot undo the protected admission or receive a capability.
    const racedPassword = `synthetic-race-${randomUUID()}`;
    await h.post('update', { idToken: text(historicalLogin.idToken), password: racedPassword, returnSecureToken: true });
    const raced = await h.post('signInWithPassword', { email, password: racedPassword, returnSecureToken: true });
    expect((await h.access('session', {}, text(raced.idToken))).status).toBe(403);
    expect((await h.firestore(text(raced.idToken), `carts/${uid}`)).status).toBe(403);
    const expiredRef = h.db.doc(`credentialSessions/${text(capClaims.mutterCredentialSession)}`);
    await expiredRef.update({ expiresAtMs: Date.now() + 8 * 24 * 60 * 60 * 1000 });
    await expect(requireCredentialSession(h.auth, h.db, capClaims, 'buyer')).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect((await h.firestore(capToken, `carts/${uid}`)).status).toBe(403);
    await expiredRef.update({ expiresAtMs: Date.now() - 1 });
    await expect(requireCredentialSession(h.auth, h.db, capClaims, 'buyer')).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect((await h.firestore(capToken, `carts/${uid}`)).status).toBe(403);
    for (const [path, value] of Object.entries(durable)) expect((await h.db.doc(path).get()).data()).toEqual(value);
  } finally { await env.cleanup(); await h.dispose(); }
}, 90_000);

test('fresh ordinary password and anonymous accounts bootstrap at the same UID; pending/no-channel accounts never silently recreate or recover', async () => {
  const h = await harness();
  const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8188, rules: readFileSync('firebase.catalog-r1b.rules', 'utf8') } });
  try {
    await env.clearFirestore();
    await h.db.doc('operations/credentialAccessCutover').set({ schema: 1, phase: 'ENFORCED', epoch, legacyCutoffMs: 1 });
    const ordinary = await h.newPasswordUser(true); // Global role claims do not grant new-buyer privileges.
    const anonymous = await h.post('signUp', { returnSecureToken: true }); h.ownedUsers.add(text(anonymous.localId));
    for (const signed of [ordinary.signed, anonymous]) {
      const native = await h.access('session', {}, text(signed.idToken));
      expect(native.status).toBe(200); expect(native.body.admin).toBe(false); expect(native.body.superadmin).toBe(false);
      const token = await h.post('signInWithCustomToken', { token: text(native.body.customToken), returnSecureToken: true });
      const decoded = await h.auth.verifyIdToken(text(token.idToken), true);
      expect(decoded.uid).toBe(text(native.body.uid)); expect(decoded.admin).toBe(false);
      await h.db.doc(`carts/${decoded.uid}`).set({ cartItems: [{ id: 'p', quantity: 1 }] });
      expect((await h.firestore(text(token.idToken), `carts/${decoded.uid}`)).status).toBe(200);
      expect((await h.access('session', {}, text(token.idToken))).status).toBe(200);
      await expect(requireCredentialSession(h.auth, h.db, decoded, 'admin')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    const pending = await h.newPasswordUser();
    await h.db.doc(`credentialAccess/${pending.uid}`).set(account(pending.uid, null));
    await h.db.doc(`carts/${pending.uid}`).set({ cartItems: [{ id: 'p', quantity: 3 }] });
    expect((await h.access('session', {}, text(pending.signed.idToken))).status).toBe(403);
    expect((await h.access('request', { email: pending.email })).status).toBe(202);
    expect(h.resetRequests()).toBe(0);
    expect((await h.auth.getUser(pending.uid)).uid).toBe(pending.uid);
    expect((await h.db.doc(`carts/${pending.uid}`).get()).data()).toEqual({ cartItems: [{ id: 'p', quantity: 3 }] });
    const guest = await h.post('signUp', { returnSecureToken: true }), guestUid = text(guest.localId); h.ownedUsers.add(guestUid);
    await h.db.doc(`credentialAccess/${guestUid}`).set(account(guestUid, null));
    await h.db.doc(`carts/${guestUid}`).set({ cartItems: [{ id: 'p', quantity: 2 }] });
    expect((await h.access('session', {}, text(guest.idToken))).status).toBe(403);
    expect((await h.auth.getUser(guestUid)).uid).toBe(guestUid);
    expect((await h.db.doc(`carts/${guestUid}`).get()).data()).toEqual({ cartItems: [{ id: 'p', quantity: 2 }] });
  } finally { await env.cleanup(); await h.dispose(); }
}, 60_000);

