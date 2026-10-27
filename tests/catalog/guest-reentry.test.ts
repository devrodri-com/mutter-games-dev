// @vitest-environment node
import type { Auth as ClientAuth } from 'firebase/auth';
import { signInWithCustomToken } from 'firebase/auth';
import { test, expect, vi } from 'vitest';
import { requireCredentialSession } from '../../api/_lib/credential-session';
import { CREDENTIAL_SESSION_TTL_MS } from '../../api/_lib/credential-access-state';
import { guestEpoch, guestHarness, record, text } from './guest-reentry-harness';
const binding: { auth: ClientAuth | null } = vi.hoisted(() => ({ auth: null }));
// Supply only the actual connected SDK instance in place of the production app
// singleton. No Auth method, token API, verifier, state parser or policy is mocked.
vi.mock('../../src/firebase', () => ({ get auth() { if (!binding.auth) throw Error('Expected real demo SDK binding'); return binding.auth; } }));
import { ensureCredentialSession } from '../../src/utils/credentialAccess';

for (const rules of ['firebase.catalog-r1b.rules', 'firebase.catalog-cutover.rules']) {
  test(`same post-cutover guest reenters after capability expiry at the same UID with ${rules}`, async () => {
    const h = await guestHarness(rules); binding.auth = h.browserAuth;
    try {
      const guest = await h.newGuest(); await ensureCredentialSession(guest);
      const first = await h.identity(), durable = await h.seedData(first.uid);
      expect(await h.privateReads(first.uid, durable.orderId)).toEqual({ cart: durable.cart, order: durable.order });
      await h.expire(first.sessionId);
      await expect(requireCredentialSession(h.auth, h.db, first.claims, 'buyer')).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
      // Fresh REST requests avoid reusing an already admitted SDK listen stream.
      expect((await h.privateRequest(first.token, `carts/${first.uid}`)).status).toBe(403);
      expect((await h.privateRequest(first.token, `orders/${durable.orderId}`)).status).toBe(403);
      // This exact assertion fails against the base, rather than merely printing a blocked result.
      const returned = await h.access(await first.user.getIdToken(true)); expect(returned.status).toBe(200);
      expect(returned.body.uid).toBe(first.uid); expect(returned.body.admin).toBe(false); expect(returned.body.superadmin).toBe(false);
      await signInWithCustomToken(h.browserAuth, text(returned.body.customToken));
      await ensureCredentialSession(h.browserAuth.currentUser ?? first.user);
      const next = await h.identity(); expect(next.uid).toBe(first.uid); expect(next.sessionId).not.toBe(first.sessionId);
      expect((await h.db.doc(`credentialSessions/${first.sessionId}`).get()).data()?.expiresAtMs).toBeLessThanOrEqual(Date.now());
      expect(await requireCredentialSession(h.auth, h.db, next.claims, 'buyer')).toMatchObject({ uid: first.uid, admin: false, superadmin: false });
      expect(await h.privateReads(first.uid, durable.orderId)).toEqual({ cart: durable.cart, order: durable.order });
      expect((await h.db.doc(`carts/${first.uid}`).get()).data()).toEqual(durable.cart);
      expect((await h.db.doc(`orders/${durable.orderId}`).get()).data()).toEqual(durable.order);
      expect((await h.auth.getUser(first.uid)).customClaims?.mutterCredentialSession).toBeUndefined();
    } finally { binding.auth = null; await h.dispose(); }
  }, 60_000);
}

test('reentry works at exact expiry, one millisecond afterward and beyond two capability windows', async () => {
  const h = await guestHarness(); binding.auth = h.browserAuth;
  let restoreClock: (() => void) | undefined;
  try {
    const guest = await h.newGuest(); await ensureCredentialSession(guest); const first = await h.identity(), durable = await h.seedData(first.uid);
    for (const offset of [0, -1, -2 * CREDENTIAL_SESSION_TTL_MS - 1]) {
      const source = await h.identity(), now = Date.now();
      // Only protected expiry is made old; the actual Firebase token is refreshed
      // by its SDK. This does not claim weeks of remote provider persistence.
      await h.expire(source.sessionId, now + offset); const clock = vi.spyOn(Date, 'now').mockReturnValue(now); restoreClock = () => clock.mockRestore();
      await expect(requireCredentialSession(h.auth, h.db, source.claims, 'buyer')).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
      await ensureCredentialSession(source.user);
      const returned = await h.identity(); expect(returned.uid).toBe(first.uid); expect(returned.sessionId).not.toBe(source.sessionId);
      expect((await h.db.doc(`credentialSessions/${returned.sessionId}`).get()).data()?.expiresAtMs).toBe(now + CREDENTIAL_SESSION_TTL_MS);
      restoreClock(); restoreClock = undefined;
      expect(await h.privateReads(first.uid, durable.orderId)).toEqual({ cart: durable.cart, order: durable.order });
    }
  } finally { restoreClock?.(); binding.auth = null; await h.dispose(); }
}, 60_000);

test('missing, incompatible, privileged or deliberately restricted protected states never reenter or change data', async () => {
  const h = await guestHarness(); binding.auth = h.browserAuth;
  try {
    const guest = await h.newGuest(); await ensureCredentialSession(guest); const source = await h.identity(), durable = await h.seedData(source.uid);
    const accountRef = h.db.doc(`credentialAccess/${source.uid}`), sessionRef = h.db.doc(`credentialSessions/${source.sessionId}`);
    await h.expire(source.sessionId);
    const originalAccount = record((await accountRef.get()).data()), originalSession = record((await sessionRef.get()).data());
    const before = (await h.db.collection('credentialSessions').get()).size;
    const accountChanges = [
      null, { status: 'PENDING' }, { status: 'RECOVERED' }, { uid: 'synthetic-foreign-uid' }, { epoch: 'synthetic-foreign-epoch' },
      { roles: { admin: true, superadmin: false } }, { roles: { admin: false, superadmin: true } },
      { restrictionAction: 'ACCOUNT_INACTIVE', restrictedAtMs: Date.now() },
      { roles: { admin: 'false', superadmin: false } },
    ];
    for (const changes of accountChanges) {
      if (changes === null) await accountRef.delete(); else await accountRef.set({ ...originalAccount, ...changes });
      expect((await h.access(source.token)).status).toBe(403);
      expect((await h.db.collection('credentialSessions').get()).size).toBe(before);
    }
    await accountRef.set(originalAccount);
    for (const changes of [null, { status: 'REVOKED' }, { status: 'ISSUANCE_UNCERTAIN' }, { uid: 'synthetic-foreign-uid' },
      { epoch: 'synthetic-foreign-epoch' }, { proofKind: 'RECOVERY_CHANNEL' }, { roles: { admin: true, superadmin: false } },
      { expiresAtMs: 'yesterday' }]) {
      if (changes === null) await sessionRef.delete(); else await sessionRef.set({ ...originalSession, ...changes });
      expect((await h.access(source.token)).status).toBe(403);
      expect((await h.db.collection('credentialSessions').get()).size).toBe(before - (changes === null ? 1 : 0));
    }
    await sessionRef.set(originalSession);
    expect((await h.access(source.token, { createdAtMs: Date.now(), uid: source.uid, admin: false })).status).toBe(400);
    for (const extra of [{ mutterCredentialEpoch: 'synthetic-foreign-epoch' }, { mutterCredentialSession: 'missing' }, { admin: true }, { superadmin: true }]) {
      const actual = await signInWithCustomToken(h.browserAuth, await h.auth.createCustomToken(source.uid, {
        mutterCredentialSession: source.sessionId, mutterCredentialEpoch: guestEpoch, admin: false, superadmin: false, ...extra,
      }));
      expect((await h.access(await actual.user.getIdToken(true))).status).toBe(403);
    }
    expect((await h.db.collection('credentialSessions').get()).size).toBe(before);
    expect((await h.db.doc(`carts/${source.uid}`).get()).data()).toEqual(durable.cart);
    expect((await h.db.doc(`orders/${durable.orderId}`).get()).data()).toEqual(durable.order);
  } finally { binding.auth = null; await h.dispose(); }
}, 60_000);

test('legacy creation, disabled, revoked and deleted official Auth users never receive a replacement session', async () => {
  const h = await guestHarness(); binding.auth = h.browserAuth;
  try {
    const guest = await h.newGuest(); await ensureCredentialSession(guest); const source = await h.identity(), durable = await h.seedData(source.uid);
    await h.expire(source.sessionId);
    const control = h.db.doc('operations/credentialAccessCutover');
    await control.update({ legacyCutoffMs: Date.now() + 1 });
    expect((await h.access(source.token)).status).toBe(403);
    await control.update({ legacyCutoffMs: 1 });
    await h.auth.updateUser(source.uid, { disabled: true }); expect((await h.access(source.token)).status).toBe(401);
    await h.auth.updateUser(source.uid, { disabled: false });
    // Provider revocation compares whole seconds; cross that boundary explicitly.
    await new Promise(resolve => setTimeout(resolve, 1100)); await h.auth.revokeRefreshTokens(source.uid);
    expect((await h.access(source.token)).status).toBe(401);
    await h.auth.deleteUser(source.uid); expect((await h.access(source.token)).status).toBe(401);
    expect((await h.db.collection('credentialSessions').get()).size).toBe(1);
    expect((await h.db.doc(`carts/${source.uid}`).get()).data()).toEqual(durable.cart);
    expect((await h.db.doc(`orders/${durable.orderId}`).get()).data()).toEqual(durable.order);
  } finally { binding.auth = null; await h.dispose(); }
}, 60_000);

test.each(['epoch', 'restriction', 'cutoff', 'roles', 'source-revocation'] as const)('a concurrent %s change is reread before reentry issuance', async change => {
  const h = await guestHarness(); binding.auth = h.browserAuth;
  const actualGetUser = h.auth.getUser.bind(h.auth);
  let transitioned = false, providerReads = 0;
  try {
    const guest = await h.newGuest(); await ensureCredentialSession(guest); const source = await h.identity(); await h.expire(source.sessionId);
    const transition = vi.spyOn(h.auth, 'getUser').mockImplementation(async uid => {
      const actual = await actualGetUser(uid);
      if (++providerReads === 2) {
        transitioned = true;
        if (change === 'restriction') await h.db.doc(`credentialAccess/${uid}`).update({ status: 'PENDING' });
        else if (change === 'roles') await h.db.doc(`credentialAccess/${uid}`).update({ roles: { admin: true, superadmin: false } });
        else if (change === 'source-revocation') await h.db.doc(`credentialSessions/${source.sessionId}`).update({ status: 'REVOKED' });
        else await h.db.doc('operations/credentialAccessCutover').update(change === 'epoch' ? { epoch: 'synthetic-next-guest-epoch' } : { legacyCutoffMs: Date.now() + 1 });
      }
      return actual; // Real SDK read: verifyIdToken's read precedes the creation check.
    });
    try {
      expect((await h.access(source.token)).status).toBe(403);
      expect(transitioned).toBe(true); expect((await h.db.collection('credentialSessions').get()).size).toBe(1);
    } finally { transition.mockRestore(); }
  } finally { binding.auth = null; await h.dispose(); }
}, 60_000);

test('concurrent reentry requests keep the same UID and data without administrative roles', async () => {
  const h = await guestHarness(); binding.auth = h.browserAuth;
  try {
    const guest = await h.newGuest(); await ensureCredentialSession(guest); const source = await h.identity(), durable = await h.seedData(source.uid); await h.expire(source.sessionId);
    const replies = await Promise.all([h.access(source.token), h.access(source.token), h.access(source.token)]);
    for (const reply of replies) { expect(reply.status).toBe(200); expect(reply.body.uid).toBe(source.uid); expect(reply.body.admin).toBe(false); expect(reply.body.superadmin).toBe(false); }
    const sessions = await h.db.collection('credentialSessions').get(); expect(sessions.size).toBe(4);
    for (const entry of sessions.docs) expect(entry.data().roles).toEqual({ admin: false, superadmin: false });
    expect((await h.db.doc(`carts/${source.uid}`).get()).data()).toEqual(durable.cart);
    expect((await h.db.doc(`orders/${durable.orderId}`).get()).data()).toEqual(durable.order);
  } finally { binding.auth = null; await h.dispose(); }
}, 60_000);

test('a real delayed reentry body cannot exchange UID A after the SDK has signed into B', async () => {
  const h = await guestHarness(); binding.auth = h.browserAuth;
  try {
    const guest = await h.newGuest(); await ensureCredentialSession(guest); const source = await h.identity(), durable = await h.seedData(source.uid); await h.expire(source.sessionId);
    const other = await h.otherGuest(), hold = h.holdNextCustomBody();
    const request = ensureCredentialSession(source.user).catch((error: unknown) => error);
    await hold.reading; await h.switchToOther(other.customToken); hold.release();
    const outcome = await request;
    expect(h.browserAuth.currentUser?.uid).toBe(other.uid); expect(outcome).toMatchObject({ code: 'ACCESS_UNAVAILABLE' });
    expect((await h.db.doc(`carts/${source.uid}`).get()).data()).toEqual(durable.cart);
    expect((await h.db.doc(`orders/${durable.orderId}`).get()).data()).toEqual(durable.order);
  } finally { binding.auth = null; await h.dispose(); }
}, 60_000);

test('a delayed real Auth exchange for UID A cannot replace UID B after its successful SDK sign-in', async () => {
  const h = await guestHarness(); binding.auth = h.browserAuth;
  try {
    const guest = await h.newGuest(); await ensureCredentialSession(guest); const source = await h.identity(), durable = await h.seedData(source.uid); await h.expire(source.sessionId);
    const other = await h.otherGuest(), hold = h.holdNextAuthResponse();
    const request = ensureCredentialSession(source.user).catch((error: unknown) => error);
    await hold.reading; await h.switchToOther(other.customToken); hold.release();
    expect(await request).toMatchObject({ code: 'ACCESS_UNAVAILABLE' });
    expect(h.browserAuth.currentUser?.uid).toBe(other.uid);
    // The temporary exchange guard must be removed; a later explicit login is allowed.
    const signed = await signInWithCustomToken(h.browserAuth, await h.auth.createCustomToken(source.uid));
    expect(signed.user.uid).toBe(source.uid);
    expect((await h.db.doc(`carts/${source.uid}`).get()).data()).toEqual(durable.cart);
    expect((await h.db.doc(`orders/${durable.orderId}`).get()).data()).toEqual(durable.order);
  } finally { binding.auth = null; await h.dispose(); }
}, 60_000);

test('another official UID cannot borrow the expired source capability or its existing cart', async () => {
  const h = await guestHarness(); binding.auth = h.browserAuth;
  try {
    const guest = await h.newGuest(); await ensureCredentialSession(guest); const source = await h.identity(), durable = await h.seedData(source.uid); await h.expire(source.sessionId);
    const other = await h.otherGuest();
    await h.switchToOther(await h.auth.createCustomToken(other.uid, {
      mutterCredentialSession: source.sessionId, mutterCredentialEpoch: guestEpoch, admin: false, superadmin: false,
    }));
    const current = h.browserAuth.currentUser; if (!current) throw Error('Expected real other account');
    const token = await current.getIdToken(true), before = (await h.db.collection('credentialSessions').get()).size;
    expect((await h.access(token)).status).toBe(403); expect((await h.privateRequest(token, `carts/${source.uid}`)).status).toBe(403);
    expect((await h.db.collection('credentialSessions').get()).size).toBe(before);
    expect((await h.db.doc(`carts/${source.uid}`).get()).data()).toEqual(durable.cart);
    expect((await h.db.doc(`orders/${durable.orderId}`).get()).data()).toEqual(durable.order);
  } finally { binding.auth = null; await h.dispose(); }
}, 60_000);

test('a restriction after issuance but before client exchange is enforced by real confirmation and Rules', async () => {
  const h = await guestHarness(); binding.auth = h.browserAuth;
  try {
    const guest = await h.newGuest(); await ensureCredentialSession(guest); const source = await h.identity(); await h.expire(source.sessionId);
    const hold = h.holdNextCustomBody(), request = ensureCredentialSession(source.user).catch((error: unknown) => error);
    await hold.reading; await h.db.doc(`credentialAccess/${source.uid}`).update({ status: 'PENDING' }); hold.release();
    expect(await request).toMatchObject({ code: 'RECOVERY_REQUIRED' });
    const current = await h.identity(); expect(current.uid).toBe(source.uid);
    await expect(requireCredentialSession(h.auth, h.db, current.claims, 'buyer')).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
  } finally { binding.auth = null; await h.dispose(); }
}, 60_000);
