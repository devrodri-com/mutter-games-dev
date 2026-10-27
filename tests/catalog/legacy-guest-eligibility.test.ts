// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { signInWithCustomToken } from 'firebase/auth';
import { guestHarness, guestEpoch } from './guest-reentry-harness';

let harness: Awaited<ReturnType<typeof guestHarness>> | undefined;
afterEach(async () => { await harness?.dispose(); harness = undefined; vi.restoreAllMocks(); });
async function pendingGuest() {
  const h = harness = await guestHarness();
  const user = await h.newGuest();
  const account = { schema: 1, uid: user.uid, epoch: guestEpoch, status: 'PENDING', recoveryEmail: null,
    channelStatus: 'UNVERIFIED', channelEvidenceSha256: null, roles: { admin: false, superadmin: false } };
  await h.db.doc('operations/credentialAccessCutover').update({ legacyCutoffMs: Date.now() + 1 });
  await h.db.doc(`credentialAccess/${user.uid}`).set(account);
  const token = await user.getIdToken(true);
  return { h, user, account, token };
}

test('trusted legacy anonymous PENDING may choose a distinct public purchase without admitting or modifying the old UID', async () => {
  const { h, user, token } = await pendingGuest();
  const durable = await h.seedData(user.uid);
  const before = await h.db.doc(`credentialAccess/${user.uid}`).get();
  expect(await h.access(token)).toMatchObject({ status: 403, body: { code: 'RECOVERY_REQUIRED', newPurchase: { kind: 'LEGACY_ANONYMOUS', uid: user.uid, epoch: guestEpoch } } });
  expect(await h.publicChoice(user.uid)).toEqual({ status: 200, body: { newPurchase: { kind: 'LEGACY_ANONYMOUS', uid: user.uid, epoch: guestEpoch } } });
  expect((await h.db.doc(`credentialAccess/${user.uid}`).get()).data()).toEqual(before.data());
  expect((await h.db.doc(`carts/${user.uid}`).get()).data()).toEqual(durable.cart);
  expect((await h.db.doc(`orders/${durable.orderId}`).get()).data()).toEqual(durable.order);
  expect((await h.db.collection('credentialSessions').where('uid', '==', user.uid).get()).empty).toBe(true);
});

test('official anonymous account retains eligibility after a custom-token exchange; token provider alone cannot select the flow', async () => {
  const { h, user } = await pendingGuest();
  await signInWithCustomToken(h.browserAuth, await h.auth.createCustomToken(user.uid));
  const current = h.browserAuth.currentUser;
  if (!current) throw new Error('Demo session unavailable');
  expect(current.isAnonymous).toBe(false);
  expect(await h.access(await current.getIdToken(true))).toMatchObject({ status: 403, body: { newPurchase: { uid: user.uid } } });
});

test.each(['registered', 'phone', 'admin-account', 'superadmin-record', 'channel', 'new-pending', 'foreign-epoch', 'missing-account', 'disabled'])('%s never gets the legacy new-purchase choice', async condition => {
  const { h, user, token } = await pendingGuest();
  const ref = h.db.doc(`credentialAccess/${user.uid}`);
  if (condition === 'registered') await h.auth.updateUser(user.uid, { email: 'synthetic-registered@example.invalid' });
  if (condition === 'phone') await h.auth.updateUser(user.uid, { phoneNumber: '+12025550123' });
  if (condition === 'admin-account') await ref.update({ roles: { admin: true, superadmin: false } });
  if (condition === 'superadmin-record') await h.auth.setCustomUserClaims(user.uid, { superadmin: true });
  if (condition === 'channel') await ref.update({ recoveryEmail: 'synthetic-holder@example.invalid', channelStatus: 'INDEPENDENTLY_VERIFIED', channelEvidenceSha256: 'b'.repeat(64) });
  if (condition === 'new-pending') await h.db.doc('operations/credentialAccessCutover').update({ legacyCutoffMs: 1 });
  if (condition === 'foreign-epoch') await ref.update({ epoch: 'synthetic-foreign-guest-epoch' });
  if (condition === 'missing-account') await ref.delete();
  if (condition === 'disabled') await h.auth.updateUser(user.uid, { disabled: true });
  const result = await h.access(token);
  expect(result.status).not.toBe(200);
  expect(result.body).not.toHaveProperty('newPurchase');
  expect(await h.publicChoice(user.uid)).toEqual({ status: 200, body: { newPurchase: null } });
  expect(h.browserAuth.currentUser?.uid).toBe(user.uid);
});

test('revocation keeps old admission at401 while the public choice remains available without credentials or capabilities', async () => {
  const { h, user, token } = await pendingGuest();
  const durable = await h.seedData(user.uid);
  const paths = [`credentialAccess/${user.uid}`, `carts/${user.uid}`, `orders/${durable.orderId}`];
  const before = await Promise.all(paths.map(path => h.db.doc(path).get()));
  await new Promise<void>(resolve => setTimeout(resolve, 1100));
  await h.auth.revokeRefreshTokens(user.uid);
  await expect(h.auth.verifyIdToken(token, true)).rejects.toMatchObject({ code: 'auth/id-token-revoked' });
  expect(await h.access(token)).toMatchObject({ status: 401, body: { code: 'INVALID_SESSION' } });
  expect(await h.publicChoice(user.uid)).toEqual({ status: 200, body: { newPurchase: { kind: 'LEGACY_ANONYMOUS', uid: user.uid, epoch: guestEpoch } } });
  expect((await h.db.collection('credentialSessions').where('uid', '==', user.uid).get()).empty).toBe(true);
  for (const [index, path] of paths.entries()) {
    const after = await h.db.doc(path).get();
    expect(after.data()).toEqual(before[index].data());
    const earlierTime = before[index].updateTime, laterTime = after.updateTime;
    if (!earlierTime || !laterTime) throw new Error('Expected unchanged historical document timestamps');
    expect(laterTime.isEqual(earlierTime)).toBe(true);
  }
});

test('public selector rejects malformed input and authority failures, and an unknown UID receives no choice', async () => {
  const { h, user } = await pendingGuest();
  for (const uid of ['', null, 'wrong/path', 'x'.repeat(129)])
    expect(await h.publicChoice(uid)).toMatchObject({ status: 400, body: { code: 'INVALID_INPUT' } });
  expect(await h.publicChoice(user.uid, { epoch: guestEpoch })).toMatchObject({ status: 400 });
  expect(await h.publicChoice('synthetic-unknown-uid')).toEqual({ status: 200, body: { newPurchase: null } });
  await h.db.doc('operations/credentialAccessCutover').delete();
  expect(await h.publicChoice(user.uid)).toMatchObject({ status: 503, body: { code: 'ACCESS_TRANSITION_UNAVAILABLE' } });
  expect((await h.db.collection('credentialSessions').get()).empty).toBe(true);
});

test('client-presented source UID and epoch cannot request an alternative identity or mint a capability', async () => {
  const { h, user, token } = await pendingGuest();
  expect(await h.access(token, { uid: 'forged-other-owner', epoch: guestEpoch, newPurchase: true })).toMatchObject({ status: 400, body: { code: 'INVALID_INPUT' } });
  expect((await h.db.collection('credentialSessions').where('uid', '==', user.uid).get()).empty).toBe(true);
});
