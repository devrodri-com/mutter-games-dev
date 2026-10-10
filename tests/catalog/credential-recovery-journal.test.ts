// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { deleteApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { deleteApp as deleteClientApp, initializeApp as initializeClientApp, type FirebaseApp } from 'firebase/app';
import { confirmPasswordReset, connectAuthEmulator, getAuth as getClientAuth, signInWithCustomToken,
  signInWithEmailAndPassword, signOut, type Auth as ClientAuth } from 'firebase/auth';
import { handleCredentialAccess, type AccessAction } from '../../api/_lib/credential-access-handler.js';
import { requestCredentialRecovery, completeCredentialRecovery } from '../../api/_lib/credential-recovery.js';
import { requireCredentialSession, renewCredentialSession } from '../../api/_lib/credential-session.js';
import { object, validSecret } from '../../api/_lib/credential-access-state.js';
import { initializeDemoAdmin } from './demo-admin.js';

const epoch = 'synthetic_journal_epoch_v1';
const evidence = createHash('sha256').update('synthetic-independent-channel').digest('hex');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
type Fixture = { app: App; client: FirebaseApp; auth: Auth; browser: ClientAuth; db: Firestore;
  uid: string; email: string; password: string; projectId: string; origin: string; guardPath: string };
let fixture: Fixture;
const actualFetch = globalThis.fetch;
let sendCalls = 0;
let projectionCalls = 0;
let externalCalls = 0;
let sendMode: 'normal' | 'before-send-error' | 'lost-ack' | 'delay-ack' | 'delay-ack-error' = 'normal';
let releaseAck: (() => void) | undefined;
let pendingSend: Promise<void> | undefined;
let transport: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:9198');
  expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8188');
  sendCalls = 0; projectionCalls = 0; externalCalls = 0; sendMode = 'normal'; releaseAck = undefined; pendingSend = undefined;
  // The official emulator maps every public API key to its configured default
  // project. Isolate fixtures by UID, not by an unsupported public-key project.
  const projectId = 'demo-mutter-r1', appName = `journal-${randomUUID()}`;
  const app = initializeDemoAdmin(appName);
  const auth = getAuth(app), db = getFirestore(app);
  const client = initializeClientApp({ projectId, apiKey: 'synthetic' }, appName);
  const browser = getClientAuth(client);
  connectAuthEmulator(browser, 'http://127.0.0.1:9198', { disableWarnings: true });
  const uid = `buyer-${randomUUID()}`, email = `${uid}@example.invalid`, password = `Synthetic-${randomUUID()}`;
  await auth.createUser({ uid, email, password });
  await db.doc('operations/credentialAccessCutover').set({ schema: 1, phase: 'ENFORCED', epoch, legacyCutoffMs: Date.now() + 1000 });
  await db.doc(`credentialAccess/${uid}`).set({ schema: 1, uid, epoch, status: 'PENDING', recoveryEmail: email,
    channelStatus: 'INDEPENDENTLY_VERIFIED', channelEvidenceSha256: evidence, roles: { admin: false, superadmin: false } });
  fixture = { app, client, auth, browser, db, uid, email, password, projectId,
    origin: 'http://127.0.0.1:9198', guardPath: `credentialRecoveryRequests/${digest(`${epoch}:${uid}`)}` };
  transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== '127.0.0.1') { externalCalls++; throw new Error('External request blocked'); }
    if (url.pathname.endsWith('/accounts:lookup')) {
      expect(url.searchParams.get('fields')).toBe('users(localId,email,passwordUpdatedAt)');
      projectionCalls++;
    }
    if (!url.pathname.endsWith('/accounts:sendOobCode')) return actualFetch(input, init);
    sendCalls++;
    const body: unknown = JSON.parse(String(init?.body));
    if (!object(body)) throw new Error('Invalid synthetic request');
    expect(body.requestType).toBe('PASSWORD_RESET');
    expect(body.canHandleCodeInApp).toBe(false);
    expect(body.returnOobLink).toBe(false);
    expect(new Headers(init?.headers).get('X-Firebase-Locale')).toBe('es');
    if (sendMode === 'before-send-error') throw new Error('Synthetic transport interruption');
    const response = await actualFetch(input, init);
    if (sendMode === 'lost-ack') throw new Error('Synthetic acknowledgment interruption');
    const delayedMode = sendMode;
    if (delayedMode === 'delay-ack' || delayedMode === 'delay-ack-error') {
      await new Promise<void>(resolve => { releaseAck = resolve; });
      if (delayedMode === 'delay-ack-error') throw new Error('Synthetic delayed acknowledgment interruption');
    }
    return response;
  });
});
afterEach(async () => {
  releaseAck?.();
  await pendingSend;
  transport.mockRestore();
  expect(externalCalls).toBe(0);
  await signOut(fixture.browser);
  await deleteClientApp(fixture.client);
  await fixture.auth.deleteUser(fixture.uid);
  for (const collection of ['credentialAccess', 'credentialSessions', 'credentialRecoveryChallenges', 'credentialRecoveryRequests', 'credentialRecoveryJournal']) {
    const records = await fixture.db.collection(collection).where('uid', '==', fixture.uid).get();
    await Promise.all(records.docs.map(record => record.ref.delete()));
  }
  await fixture.db.terminate();
  await deleteApp(fixture.app);
});
async function call(action: AccessAction, body: unknown, token?: string) {
  let status = 0, result: unknown;
  const res = { setHeader() {}, status(value: number) { status = value; return res; }, json(value: unknown) { result = value; } };
  await handleCredentialAccess(action, fixture.auth, fixture.db, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
  return { status, body: result };
}
async function oldClaims(): Promise<DecodedIdToken> {
  const signed = await signInWithEmailAndPassword(fixture.browser, fixture.email, fixture.password);
  return fixture.auth.verifyIdToken(await signed.user.getIdToken(true), true);
}
async function mailbox(): Promise<{ nonce: string; code: string }> {
  const response = await actualFetch(`${fixture.origin}/emulator/v1/projects/${fixture.projectId}/oobCodes`);
  const body: unknown = await response.json();
  if (!response.ok || !object(body) || !Array.isArray(body.oobCodes)) throw new Error('Synthetic mailbox unavailable');
  const row: unknown = body.oobCodes.find((value: unknown) => object(value) && value.email === fixture.email && value.requestType === 'PASSWORD_RESET');
  if (!object(row) || typeof row.oobLink !== 'string' || typeof row.oobCode !== 'string') throw new Error('Synthetic message unavailable');
  const continueUrl = new URL(row.oobLink).searchParams.get('continueUrl');
  if (!continueUrl) throw new Error('Synthetic return path unavailable');
  const returnUrl = new URL(continueUrl);
  expect(returnUrl.origin).toBe('http://127.0.0.1:5173'); expect(returnUrl.pathname).toBe('/login');
  const nonce = new URLSearchParams(returnUrl.hash.slice(1)).get('recovery');
  if (!validSecret(nonce)) throw new Error('Synthetic mail proof unavailable');
  return { nonce, code: row.oobCode };
}
async function resetFromMailbox(): Promise<{ nonce: string; claims: DecodedIdToken; token: string }> {
  const mail = await mailbox();
  await new Promise(resolve => setTimeout(resolve, 10));
  const password = `Recovered-${randomUUID()}`;
  await confirmPasswordReset(fixture.browser, mail.code, password);
  await signOut(fixture.browser);
  const signed = await signInWithEmailAndPassword(fixture.browser, fixture.email, password);
  const token = await signed.user.getIdToken(true), claims = await fixture.auth.verifyIdToken(token, true);
  return { nonce: mail.nonce, claims, token };
}
async function admit(customToken: string | undefined) {
  if (typeof customToken !== 'string') throw new Error('Synthetic capability issuance failed');
  const signed = await signInWithCustomToken(fixture.browser, customToken);
  const claims = await fixture.auth.verifyIdToken(await signed.user.getIdToken(true), true);
  return { claims, admission: await requireCredentialSession(fixture.auth, fixture.db, claims, 'buyer') };
}

test('public response is generic, secret stays in the official mail channel, and old credential alone stays blocked', async () => {
  const claims = await oldClaims();
  await expect(requireCredentialSession(fixture.auth, fixture.db, claims, 'buyer')).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
  const absent = await call('request', { email: 'absent@example.invalid' });
  const prepared = await call('request', { email: fixture.email });
  expect(absent).toEqual({ status: 202, body: { status: 'REQUEST_RECEIVED' } });
  expect(prepared).toEqual(absent);
  expect(sendCalls).toBe(1); expect(projectionCalls).toBeGreaterThan(0);
  const mail = await mailbox();
  await expect(completeCredentialRecovery(fixture.auth, fixture.db, claims, mail.nonce)).rejects.toMatchObject({ code: 'RECOVERY_NOT_COMPLETED' });
  const challenges = await fixture.db.collection('credentialRecoveryChallenges').where('uid', '==', fixture.uid).get();
  expect(challenges.size).toBe(1);
  const serialized = JSON.stringify(challenges.docs[0].data());
  expect(serialized.includes(mail.nonce)).toBe(false);
  expect(serialized.includes(fixture.password)).toBe(false);
  await call('request', { email: fixture.email });
  expect(sendCalls).toBe(1);
}, 30000);

test('acknowledgment loss preserves uncertainty, never blindly resends, and mailbox proof resolves it once', async () => {
  sendMode = 'lost-ack';
  const response = await call('request', { email: fixture.email });
  expect(response.status).toBe(202);
  expect((await fixture.db.doc(fixture.guardPath).get()).get('deliveryState')).toBe('UNCERTAIN');
  await Promise.all([requestCredentialRecovery(fixture.auth, fixture.db, fixture.email), requestCredentialRecovery(fixture.auth, fixture.db, fixture.email)]);
  expect(sendCalls).toBe(1);
  const recovered = await resetFromMailbox();
  const result = await completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce);
  expect(result.uid).toBe(fixture.uid);
  const { admission } = await admit(result.customToken);
  expect(admission.uid).toBe(fixture.uid); expect(admission.admin).toBe(false);
  expect((await fixture.db.doc(fixture.guardPath).get()).get('deliveryState')).toBe('CONSUMED');
  await expect(completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce)).rejects.toMatchObject({ code: 'RECOVERY_NOT_COMPLETED' });
  expect(sendCalls).toBe(1);
}, 30000);

test('completion during an in-flight send consumes PENDING and later acknowledgment cannot reopen the challenge', async () => {
  sendMode = 'delay-ack';
  const request = requestCredentialRecovery(fixture.auth, fixture.db, fixture.email);
  pendingSend = request;
  for (let i = 0; !releaseAck && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(typeof releaseAck).toBe('function');
  expect((await fixture.db.doc(fixture.guardPath).get()).get('deliveryState')).toBe('PENDING');
  const recovered = await resetFromMailbox();
  const result = await completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce);
  expect(result.uid).toBe(fixture.uid);
  releaseAck?.(); await request;
  expect((await fixture.db.doc(fixture.guardPath).get()).get('deliveryState')).toBe('CONSUMED');
  expect((await fixture.db.doc(`credentialRecoveryChallenges/${digest(recovered.nonce)}`).get()).get('deliveryState')).toBe('CONSUMED');
  await expect(completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce)).rejects.toMatchObject({ code: 'RECOVERY_NOT_COMPLETED' });
  await admit(result.customToken);
}, 30000);

test('failure before sending keeps account pending and blocks concurrent retries without inventing delivery', async () => {
  sendMode = 'before-send-error';
  await Promise.all([requestCredentialRecovery(fixture.auth, fixture.db, fixture.email), requestCredentialRecovery(fixture.auth, fixture.db, fixture.email)]);
  expect(sendCalls).toBe(1);
  const guard = await fixture.db.doc(fixture.guardPath).get();
  expect(guard.get('deliveryState')).toBe('UNCERTAIN');
  expect((await fixture.db.doc(`credentialAccess/${fixture.uid}`).get()).get('status')).toBe('PENDING');
  expect((await fixture.db.collection('credentialSessions').where('uid', '==', fixture.uid).get()).size).toBe(0);
  await requestCredentialRecovery(fixture.auth, fixture.db, fixture.email);
  expect(sendCalls).toBe(1);
}, 30000);

test('revoked, expired and mismatched proofs fail closed even after the official reset', async () => {
  await requestCredentialRecovery(fixture.auth, fixture.db, fixture.email);
  const recovered = await resetFromMailbox(), challenge = fixture.db.doc(`credentialRecoveryChallenges/${digest(recovered.nonce)}`);
  expect((await call('complete', { nonce: 'malformed' }, recovered.token)).status).toBe(403);
  await fixture.db.doc(`credentialAccess/${fixture.uid}`).update({ uid: 'different-synthetic-uid' });
  await expect(completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce)).rejects.toMatchObject({ code: 'RECOVERY_NOT_COMPLETED' });
  await fixture.db.doc(`credentialAccess/${fixture.uid}`).update({ uid: fixture.uid });
  await fixture.db.doc(fixture.guardPath).update({ schema: 2 });
  await expect(completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce)).rejects.toMatchObject({ code: 'RECOVERY_NOT_COMPLETED' });
  await fixture.db.doc(fixture.guardPath).update({ schema: 1 });
  await fixture.db.doc(fixture.guardPath).update({ challengeHash: '0'.repeat(64) });
  await expect(completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce)).rejects.toMatchObject({ code: 'RECOVERY_NOT_COMPLETED' });
  await fixture.db.doc(fixture.guardPath).update({ challengeHash: digest(recovered.nonce) });
  await challenge.update({ expiresAtMs: Date.now() + 60 * 60 * 1000 });
  await expect(completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce)).rejects.toMatchObject({ code: 'RECOVERY_NOT_COMPLETED' });
  await challenge.update({ expiresAtMs: Date.now() - 1 });
  await expect(completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce)).rejects.toMatchObject({ code: 'RECOVERY_NOT_COMPLETED' });
  await challenge.update({ expiresAtMs: Date.now() + 10000 });
  await fixture.db.doc(`credentialAccess/${fixture.uid}`).update({ channelStatus: 'UNVERIFIED', channelEvidenceSha256: null });
  await expect(completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce)).rejects.toMatchObject({ code: 'RECOVERY_NOT_COMPLETED' });
  expect((await fixture.db.collection('credentialSessions').where('uid', '==', fixture.uid).get()).size).toBe(0);
  expect((await fixture.db.doc(`credentialAccess/${fixture.uid}`).get()).get('status')).toBe('PENDING');
}, 30000);

test('partial session issuance preserves consumed proof and denies old native reentry', async () => {
  await requestCredentialRecovery(fixture.auth, fixture.db, fixture.email);
  const recovered = await resetFromMailbox();
  const issuer = vi.spyOn(fixture.auth, 'createCustomToken').mockRejectedValue(new Error('Synthetic issuer interruption'));
  try {
    await expect(completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce)).rejects.toMatchObject({ code: 'SESSION_ISSUANCE_UNCERTAIN' });
  } finally { issuer.mockRestore(); }
  expect((await fixture.db.doc(fixture.guardPath).get()).get('deliveryState')).toBe('CONSUMED');
  expect((await fixture.db.doc(`credentialAccess/${fixture.uid}`).get()).get('status')).toBe('RECOVERED');
  const sessions = await fixture.db.collection('credentialSessions').where('uid', '==', fixture.uid).get();
  expect(sessions.size).toBe(1); expect(sessions.docs[0].get('status')).toBe('ISSUANCE_UNCERTAIN');
  expect((await call('session', {}, recovered.token)).status).toBe(403);
  await expect(completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce)).rejects.toMatchObject({ code: 'RECOVERY_NOT_COMPLETED' });
  expect(sendCalls).toBe(1);
}, 30000);

test('renewal preserves UID and effective roles, avoids refresh loops, and never revives expired or revoked sessions', async () => {
  await requestCredentialRecovery(fixture.auth, fixture.db, fixture.email);
  const recovered = await resetFromMailbox();
  const result = await completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce);
  const admitted = await admit(result.customToken), source = fixture.db.doc(`credentialSessions/${admitted.admission.sessionId}`);
  await source.update({ expiresAtMs: Date.now() + 8 * 24 * 60 * 60 * 1000 });
  await expect(renewCredentialSession(fixture.auth, fixture.db, admitted.claims)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
  await source.update({ expiresAtMs: Date.now() + 10000 });
  // Even a later legitimate account-role increase must not upgrade this session.
  await fixture.db.doc(`credentialAccess/${fixture.uid}`).update({ roles: { admin: true, superadmin: true } });
  const renewed = await renewCredentialSession(fixture.auth, fixture.db, admitted.claims);
  expect(renewed.uid).toBe(fixture.uid); expect(renewed.admin).toBe(false); expect(renewed.superadmin).toBe(false);
  expect(renewed.expiresAtMs > Date.now() + 6 * 24 * 60 * 60 * 1000).toBe(true);
  const current = await admit(renewed.customToken);
  expect((await renewCredentialSession(fixture.auth, fixture.db, current.claims)).customToken).toBeUndefined();
  await source.update({ expiresAtMs: Date.now() - 1 });
  await expect(renewCredentialSession(fixture.auth, fixture.db, admitted.claims)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
  await fixture.db.doc(`credentialAccess/${fixture.uid}`).update({ status: 'PENDING' });
  await expect(renewCredentialSession(fixture.auth, fixture.db, current.claims)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
}, 30000);

test('renewal retains a legitimate superadmin-only role without adding the admin bit', async () => {
  await fixture.db.doc(`credentialAccess/${fixture.uid}`).update({ roles: { admin: false, superadmin: true } });
  await requestCredentialRecovery(fixture.auth, fixture.db, fixture.email);
  const recovered = await resetFromMailbox();
  const result = await completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce);
  const admitted = await admit(result.customToken);
  expect(admitted.admission.admin).toBe(false); expect(admitted.admission.superadmin).toBe(true);
  await fixture.db.doc(`credentialSessions/${admitted.admission.sessionId}`).update({ expiresAtMs: Date.now() + 10000 });
  const renewed = await renewCredentialSession(fixture.auth, fixture.db, admitted.claims);
  expect(renewed.admin).toBe(false); expect(renewed.superadmin).toBe(true);
  const next = await admit(renewed.customToken);
  const authority = await requireCredentialSession(fixture.auth, fixture.db, next.claims, 'admin');
  expect(authority.admin).toBe(false); expect(authority.superadmin).toBe(true);
}, 30000);

test.each(['delay-ack', 'delay-ack-error'] as const)('late %s for consumed A never corrupts the next explicit request B', async mode => {
  sendMode = mode;
  const requestA = requestCredentialRecovery(fixture.auth, fixture.db, fixture.email);
  pendingSend = requestA;
  for (let i = 0; !releaseAck && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(typeof releaseAck).toBe('function');
  const recovered = await resetFromMailbox();
  await completeCredentialRecovery(fixture.auth, fixture.db, recovered.claims, recovered.nonce);
  sendMode = 'normal';
  await requestCredentialRecovery(fixture.auth, fixture.db, fixture.email);
  expect(sendCalls).toBe(2);
  const before = await fixture.db.doc(fixture.guardPath).get();
  expect(before.get('deliveryState')).toBe('SENT');
  expect(before.get('challengeHash') === digest(recovered.nonce)).toBe(false);
  releaseAck?.();
  await expect(requestA).resolves.toBeUndefined();
  const after = await fixture.db.doc(fixture.guardPath).get();
  expect(after.data()).toEqual(before.data());
  expect(after.updateTime && before.updateTime && after.updateTime.isEqual(before.updateTime)).toBe(true);
  expect((await fixture.db.doc(`credentialRecoveryChallenges/${digest(recovered.nonce)}`).get()).get('deliveryState')).toBe('CONSUMED');
}, 30000);
