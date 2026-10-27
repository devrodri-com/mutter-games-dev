// @vitest-environment node
import type { Auth as ClientAuth } from 'firebase/auth';
import type { Firestore, Transaction, ReadOnlyTransactionOptions, ReadWriteTransactionOptions } from 'firebase-admin/firestore';
import { EmailAuthProvider, linkWithCredential, reauthenticateWithCredential, signInWithCustomToken } from 'firebase/auth';
import { expect, test, vi } from 'vitest';
import { BUYER_SCOPE, CREDENTIAL_SESSION_TTL_MS, HASHED_CAPABILITY_FORMAT, JOHN_ADMIN_SCOPE, parseAccount, parseSession } from '../../api/_lib/credential-access-state';
import { credentialSessionLocator } from '../../api/_lib/credential-capability';
import { renewCredentialSession, requireCredentialSession, resumeCredentialSession } from '../../api/_lib/credential-session';
import { guestEpoch, guestHarness, record, text } from './guest-reentry-harness';

const binding: { auth: ClientAuth | null } = vi.hoisted(() => ({ auth: null }));
// Bind the actual connected client SDK only; exchange, verifier, parsers,
// protected state and session business rules are production implementations.
vi.mock('../../src/firebase', () => ({ get auth() { if (!binding.auth) throw Error('Expected real demo SDK binding'); return binding.auth; } }));
import { ensureCredentialSession } from '../../src/utils/credentialAccess';

async function harness() {
  const h = await guestHarness('firebase.catalog-cutover.rules'); binding.auth = h.browserAuth;
  await h.db.doc('operations/credentialAccessCutover').set({ schema: 2, phase: 'ENFORCED', epoch: guestEpoch,
    legacyCutoffMs: 1, scope: JOHN_ADMIN_SCOPE, capabilityFormat: HASHED_CAPABILITY_FORMAT,
    subjectUid: 'synthetic-buyer-admin-john', additionalSubject: { uid: 'synthetic-buyer-admin-rodrigo', email: 'rodrigo@example.invalid' } });
  return h;
}
async function finish(h: Awaited<ReturnType<typeof harness>>) { binding.auth = null; await h.dispose(); }

/** Hold the earlier request before the SDK transaction, then let later real
 * requests commit first. All callbacks, clocks and persisted timestamps remain
 * real; no transaction result or business rule is replaced. */
async function laterRequestsWin<T>(db: Firestore, request: () => Promise<T>, followers: number): Promise<T[]> {
  const original: Firestore['runTransaction'] = db.runTransaction.bind(db);
  let enter: () => void = () => { throw Error('Transaction entry not initialized'); };
  let release: () => void = () => { throw Error('Transaction release not initialized'); };
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  let enteredAt = 0;
  const held = vi.spyOn(db, 'runTransaction').mockImplementationOnce(async function <R>(
    body: (tx: Transaction) => Promise<R>, options?: ReadOnlyTransactionOptions | ReadWriteTransactionOptions,
  ): Promise<R> {
    enteredAt = Date.now(); enter(); await released;
    return original(body, options);
  });
  const earlier = request();
  try {
    await Promise.race([entered, earlier.then(() => { throw Error('Request ended before its transaction'); })]);
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(Date.now()).toBeGreaterThan(enteredAt);
    const later = await Promise.all(Array.from({ length: followers }, () => request()));
    release(); return [await earlier, ...later];
  } finally {
    release();
    try { await earlier; } finally { held.mockRestore(); }
  }
}

test.each(['anonymous', 'password'] as const)('post-cutover %s exchanges the same UID for a buyer-only hashed capability', async provider => {
  const h = await harness();
  try {
    const guest = await h.newGuest();
    if (provider === 'password') {
      const password = EmailAuthProvider.credential(`${guest.uid}@example.invalid`, `synthetic-${guest.uid}`);
      await linkWithCredential(guest, password); await reauthenticateWithCredential(guest, password);
    }
    // Real emulator/official SDK evidence for the original anonymous failure:
    // no revocation has been recorded, so the optional metadata is absent.
    const officialUser = await h.auth.getUser(guest.uid);
    if (provider === 'anonymous') expect(officialUser.tokensValidAfterTime).toBeUndefined();
    else expect(typeof officialUser.tokensValidAfterTime).toBe('string');
    const control = await h.db.doc('operations/credentialAccessCutover').get();
    const admitted = await ensureCredentialSession(guest);
    expect(admitted).toMatchObject({ status: 'ACTIVE', uid: guest.uid, scope: BUYER_SCOPE, admin: false, superadmin: false });
    const source = await h.identity(), locator = credentialSessionLocator(source.sessionId);
    expect(source.claims.firebase.sign_in_provider).toBe('custom'); expect(locator).not.toBe(source.sessionId);
    expect((await h.db.doc(`credentialSessions/${source.sessionId}`).get()).exists).toBe(false);
    const account = parseAccount((await h.db.doc(`credentialAccess/${guest.uid}`).get()).data());
    const session = parseSession((await h.db.doc(`credentialSessions/${locator}`).get()).data());
    expect(account).toMatchObject({ schema: 2, scope: BUYER_SCOPE, uid: guest.uid, status: 'NATIVE_POST_CUTOVER', roles: { admin: false, superadmin: false } });
    expect(session).toMatchObject({ schema: 2, scope: BUYER_SCOPE, uid: guest.uid, proofKind: 'NEW_POST_CUTOVER',
      capabilityFormat: HASHED_CAPABILITY_FORMAT, nativeCreatedAtMs: account?.nativeCreatedAtMs });
    expect(await requireCredentialSession(h.auth, h.db, source.claims, 'buyer')).toMatchObject({ uid: guest.uid, sessionId: locator, scope: BUYER_SCOPE });
    await expect(requireCredentialSession(h.auth, h.db, source.claims, 'admin')).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    const data = await h.seedData(guest.uid);
    expect(await h.privateReads(guest.uid, data.orderId)).toEqual({ cart: data.cart, order: data.order });
    const after = await h.db.doc('operations/credentialAccessCutover').get();
    if (!after.updateTime || !control.updateTime) throw Error('Expected actual control versions');
    expect(after.updateTime.isEqual(control.updateTime)).toBe(true);
    expect((await h.auth.getUser(guest.uid)).customClaims?.mutterCredentialSession).toBeUndefined();
  } finally { await finish(h); }
}, 60_000);

test('a later native bootstrap can commit first; both same-JWT requests recover exactly one capability', async () => {
  const h = await harness();
  try {
    const guest = await h.newGuest(), native = await guest.getIdToken(true);
    const responses = await laterRequestsWin(h.db, () => h.access(native), 1);
    for (const response of responses) expect(response).toMatchObject({ status: 200,
      body: { uid: guest.uid, scope: BUYER_SCOPE, admin: false, superadmin: false } });
    expect(responses[0].body.expiresAtMs).toBe(responses[1].body.expiresAtMs);
    const sessions = await h.db.collection('credentialSessions').get(); expect(sessions.size).toBe(1);
    expect(sessions.docs[0].get('expiresAtMs')).toBe(responses[0].body.expiresAtMs);
    expect(Number(responses[0].body.expiresAtMs)).toBeLessThanOrEqual(Date.now() + CREDENTIAL_SESSION_TTL_MS);
    await signInWithCustomToken(h.browserAuth, text(responses[0].body.customToken));
    expect(await ensureCredentialSession(h.browserAuth.currentUser ?? guest)).toMatchObject({ uid: guest.uid, scope: BUYER_SCOPE });
    expect((await h.db.collection('credentialSessions').get()).size).toBe(1);
  } finally { await finish(h); }
}, 60_000);

test('four renewals recover one child when an earlier request observes the later winner', async () => {
  const h = await harness();
  try {
    await ensureCredentialSession(await h.newGuest()); const source = await h.identity();
    const locator = credentialSessionLocator(source.sessionId), parent = h.db.doc(`credentialSessions/${locator}`);
    await parent.update({ expiresAtMs: Date.now() + 60_000 });
    const responses = await laterRequestsWin(h.db, () => h.access(source.token), 3);
    for (const response of responses) expect(response).toMatchObject({ status: 200, body: { scope: BUYER_SCOPE, uid: source.uid, admin: false, superadmin: false } });
    expect((await h.db.collection('credentialSessions').get()).size).toBe(2);
    const pointer = text((await parent.get()).get('renewedToLocator'));
    await signInWithCustomToken(h.browserAuth, text(responses[0].body.customToken));
    await ensureCredentialSession(h.browserAuth.currentUser ?? source.user);
    const current = await h.identity(); expect(credentialSessionLocator(current.sessionId)).toBe(pointer);
    expect(current.uid).toBe(source.uid);
    expect((await h.access(source.token)).status).toBe(200);
    expect((await h.db.collection('credentialSessions').get()).size).toBe(2);
  } finally { await finish(h); }
}, 60_000);

test('expired post-cutover buyer explicitly reenters at the same UID; ordinary renewal refuses the expired source', async () => {
  const h = await harness();
  try {
    await ensureCredentialSession(await h.newGuest()); const source = await h.identity(), data = await h.seedData(source.uid);
    const locator = credentialSessionLocator(source.sessionId);
    await h.expire(locator);
    await expect(requireCredentialSession(h.auth, h.db, source.claims, 'buyer')).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    await expect(renewCredentialSession(h.auth, h.db, source.claims)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    const returned = await h.access(source.token); expect(returned.status).toBe(200);
    await signInWithCustomToken(h.browserAuth, text(returned.body.customToken));
    await ensureCredentialSession(h.browserAuth.currentUser ?? source.user);
    const current = await h.identity(); expect(current.uid).toBe(source.uid); expect(current.sessionId).not.toBe(source.sessionId);
    expect(await h.privateReads(current.uid, data.orderId)).toEqual({ cart: data.cart, order: data.order });
    expect((await h.db.doc(`credentialSessions/${locator}`).get()).get('expiresAtMs')).toBeLessThanOrEqual(Date.now());
    expect((await h.db.doc(`carts/${source.uid}`).get()).data()).toEqual(data.cart);
    expect((await h.db.doc(`orders/${data.orderId}`).get()).data()).toEqual(data.order);
    expect((await h.db.collection('credentialSessions').get()).size).toBe(2);
  } finally { await finish(h); }
}, 60_000);

test('public locator, foreign scope, forged roles and incompatible protected states cannot renew or reenter', async () => {
  const h = await harness();
  try {
    await ensureCredentialSession(await h.newGuest()); const source = await h.identity();
    const locator = credentialSessionLocator(source.sessionId), accountRef = h.db.doc(`credentialAccess/${source.uid}`), sessionRef = h.db.doc(`credentialSessions/${locator}`);
    const originalAccount = record((await accountRef.get()).data()), originalSession = record((await sessionRef.get()).data());
    const claims = { mutterCredentialSession: source.sessionId, mutterCredentialEpoch: guestEpoch,
      mutterCredentialScope: BUYER_SCOPE, admin: false, superadmin: false };
    for (const extra of [{ mutterCredentialSession: locator }, { mutterCredentialScope: 'UNKNOWN_SCOPE' },
      { mutterCredentialScope: JOHN_ADMIN_SCOPE }, { admin: true }, { superadmin: true }, { mutterCredentialEpoch: 'synthetic-foreign-buyer-epoch' }]) {
      const signed = await signInWithCustomToken(h.browserAuth, await h.auth.createCustomToken(source.uid, { ...claims, ...extra }));
      expect((await h.access(await signed.user.getIdToken(true))).status).toBe(403);
    }
    for (const changes of [{ status: 'PENDING' }, { status: 'RECOVERED' }, { roles: { admin: true, superadmin: false } },
      { restrictionAction: 'ACCOUNT_INACTIVE', restrictedAtMs: Date.now() }, { nativeCreatedAtMs: Date.now() + 60_000 },
      { nativeCreatedAtMs: Number(originalAccount.nativeCreatedAtMs) - 1 }]) {
      await accountRef.set({ ...originalAccount, ...changes });
      expect((await h.access(source.token)).status).toBe(403);
    }
    await accountRef.set(originalAccount);
    for (const changes of [{ status: 'REVOKED' }, { status: 'ISSUANCE_UNCERTAIN' }, { scope: JOHN_ADMIN_SCOPE },
      { roles: { admin: false, superadmin: true } }, { nativeCreatedAtMs: Number(originalAccount.nativeCreatedAtMs) - 1 }]) {
      await sessionRef.set({ ...originalSession, ...changes });
      expect((await h.access(source.token)).status).toBe(403);
    }
    await sessionRef.set(originalSession);
    expect((await h.db.collection('credentialSessions').get()).size).toBe(1);
  } finally { await finish(h); }
}, 60_000);

test('native issuance refuses named Admin, pre-cutover creation and historical recovered records without a buyer proof', async () => {
  const h = await harness();
  try {
    const guest = await h.newGuest(), native = await guest.getIdToken(true), controlRef = h.db.doc('operations/credentialAccessCutover');
    const control = record((await controlRef.get()).data());
    await controlRef.update({ subjectUid: guest.uid }); expect((await h.access(native)).status).toBe(403);
    await controlRef.set({ ...control, legacyCutoffMs: Date.now() + 1 }); expect((await h.access(native)).status).toBe(403);
    await controlRef.set(control);
    const historical = { schema: 1, uid: guest.uid, epoch: guestEpoch, status: 'RECOVERED', recoveryEmail: 'historical@example.invalid',
      channelStatus: 'INDEPENDENTLY_VERIFIED', channelEvidenceSha256: 'a'.repeat(64), roles: { admin: false, superadmin: false } };
    const ref = h.db.doc(`credentialAccess/${guest.uid}`); await ref.set(historical);
    expect((await h.access(native)).status).toBe(403); expect((await ref.get()).data()).toEqual(historical);
    expect((await h.db.collection('credentialSessions').get()).empty).toBe(true);
  } finally { await finish(h); }
}, 60_000);

test('a protected account with a mismatched UID is rejected before creating a capability', async () => {
  const h = await harness();
  try {
    const guest = await h.newGuest(), native = await guest.getIdToken(true);
    const user = await h.auth.getUser(guest.uid), ref = h.db.doc(`credentialAccess/${guest.uid}`);
    const incompatible = { schema: 2, scope: BUYER_SCOPE, uid: 'another-synthetic-buyer', epoch: guestEpoch,
      status: 'NATIVE_POST_CUTOVER', recoveryEmail: null, channelStatus: 'UNVERIFIED', channelEvidenceSha256: null,
      roles: { admin: false, superadmin: false }, nativeCreatedAtMs: Date.parse(user.metadata.creationTime) };
    await ref.set(incompatible);
    expect((await h.access(native)).status).toBe(403);
    expect((await h.db.collection('credentialSessions').get()).empty).toBe(true);
    expect((await ref.get()).data()).toEqual(incompatible);
  } finally { await finish(h); }
}, 60_000);

test('revoked Auth token and a lost signer cannot manufacture a new buyer capability', async () => {
  const h = await harness();
  try {
    const guest = await h.newGuest(), native = await guest.getIdToken(true);
    const signer = vi.spyOn(h.auth, 'createCustomToken').mockRejectedValueOnce(new Error('Synthetic signing outage'));
    const failed = await h.access(native); expect(failed).toMatchObject({ status: 503, body: { code: 'SESSION_ISSUANCE_UNCERTAIN' } });
    expect((await h.db.collection('credentialSessions').get()).size).toBe(1);
    const recovered = await h.access(native); expect(recovered.status).toBe(200);
    expect((await h.db.collection('credentialSessions').get()).size).toBe(1); signer.mockRestore();
    await signInWithCustomToken(h.browserAuth, text(recovered.body.customToken));
    const source = await h.identity(); await h.expire(credentialSessionLocator(source.sessionId));
    await new Promise(resolve => setTimeout(resolve, 1100)); await h.auth.revokeRefreshTokens(source.uid);
    const officialUser = await h.auth.getUser(source.uid);
    if (typeof officialUser.tokensValidAfterTime !== 'string') throw Error('Expected official revocation boundary');
    expect(Date.parse(officialUser.tokensValidAfterTime)).toBeGreaterThan(source.claims.auth_time * 1000);
    // Revalidate the now-revoked source even if a caller holds previously
    // verified claims; the missing-metadata correction cannot reopen it.
    await expect(resumeCredentialSession(h.auth, h.db, source.claims)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect((await h.access(source.token)).status).toBe(401);
    expect((await h.db.collection('credentialSessions').get()).size).toBe(1);
  } finally { await finish(h); }
}, 60_000);
