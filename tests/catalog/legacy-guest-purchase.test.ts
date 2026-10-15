// @vitest-environment node
import type { Auth as ClientAuth } from 'firebase/auth';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { guestHarness, guestEpoch, text } from './guest-reentry-harness';
import { mintCredentialSession, requireCredentialSession } from '../../api/_lib/credential-session';
import type { CredentialAccount } from '../../api/_lib/credential-access-state';
const binding: { auth: ClientAuth | null } = vi.hoisted(() => ({ auth: null }));
// Only the app singleton is bound to the real connected SDK. Auth, transport,
// policy, official signup/exchange and Firestore remain actual implementations.
vi.mock('../../src/firebase', () => ({ get auth() { if (!binding.auth) throw new Error('Expected real demo Auth'); return binding.auth; } }));
import { startLegacyGuestPurchase } from '../../src/utils/guestPurchase';
import { readGuestPurchaseTransition } from '../../src/utils/guestPurchaseState';
import { CredentialAccessError, ensureCredentialSession, type LegacyGuestNewPurchase } from '../../src/utils/credentialAccess';
import { recordObservedIdentity, observedIdentityUid } from '../../src/utils/observedIdentity';
import { bootstrapAnonymousVisitor, startExplicitAnonymousVisitor } from '../../src/utils/anonymousBootstrap';

let h: Awaited<ReturnType<typeof guestHarness>> | undefined;
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
  });
  const events = new EventTarget();
  vi.stubGlobal('window', {
    dispatchEvent: (event: Event) => events.dispatchEvent(event),
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    location: { href: 'http://127.0.0.1/', protocol: 'http:' },
  });
  let tail: Promise<unknown> = Promise.resolve();
  // Native orchestration fixture only; browser tests use the real Web Locks API.
  vi.stubGlobal('navigator', { userAgent: 'Node.js/22', locks: {
    request: <T>(_name: string, _options: unknown, callback: () => Promise<T>) => {
      const next = tail.then(callback); tail = next.catch(() => undefined); return next;
    },
  } });
});
afterEach(async () => {
  binding.auth = null; await h?.dispose(); h = undefined; localStorage.clear();
  vi.unstubAllGlobals();
});
async function legacy() {
  h = await guestHarness(); binding.auth = h.browserAuth;
  const source = await h.newGuest();
  const account: CredentialAccount = { schema: 1, uid: source.uid, epoch: guestEpoch, status: 'PENDING', recoveryEmail: null,
    channelStatus: 'UNVERIFIED', channelEvidenceSha256: null, roles: { admin: false, superadmin: false } };
  await h.db.doc(`credentialAccess/${source.uid}`).set(account);
  const cutoff = Date.parse((await h.auth.getUser(source.uid)).metadata.creationTime);
  await h.db.doc('operations/credentialAccessCutover').update({ legacyCutoffMs: cutoff });
  // Admin's documented UTC metadata is second-precision. Ensure the later
  // official signup is demonstrably after this fixture's cutoff.
  await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, cutoff + 1001 - Date.now())));
  let offer: LegacyGuestNewPurchase | null = null;
  try { await ensureCredentialSession(source); }
  catch (error: unknown) { if (!(error instanceof CredentialAccessError)) throw error; offer = error.newPurchase; }
  if (!offer) throw new Error('Expected authoritative legacy choice');
  const durable = await h.seedData(source.uid);
  return { harness: h, source, offer, durable, account };
}
async function adminFixture(harness: Awaited<ReturnType<typeof guestHarness>>) {
  const uid = `synthetic-concurrent-admin-${randomUUID()}`;
  const email = `synthetic-${randomUUID()}@example.invalid`;
  await harness.auth.createUser({ uid, email });
  const account: CredentialAccount = { schema: 1, uid, epoch: guestEpoch, status: 'RECOVERED', recoveryEmail: email,
    channelStatus: 'INDEPENDENTLY_VERIFIED', channelEvidenceSha256: 'c'.repeat(64), roles: { admin: true, superadmin: false } };
  await harness.db.doc(`credentialAccess/${uid}`).set(account);
  const admission = await mintCredentialSession(harness.auth, harness.db, account, 'RECOVERY_CHANNEL');
  return { uid, token: text(admission.customToken) };
}

test('explicit new purchase completes at a distinct official UID; double submit and retry reuse it without touching the historical documents', async () => {
  const { harness, source, offer, durable, account } = await legacy();
  const before = await harness.auth.listUsers();
  const [first, second] = await Promise.all([startLegacyGuestPurchase(offer), startLegacyGuestPurchase(offer)]);
  expect(first.uid).not.toBe(source.uid); expect(second.uid).toBe(first.uid);
  expect(first).toMatchObject({ admin: false, superadmin: false });
  const identity = await harness.identity();
  expect(identity.uid).toBe(first.uid);
  expect(await requireCredentialSession(harness.auth, harness.db, identity.claims, 'buyer')).toMatchObject({ uid: first.uid, admin: false, superadmin: false });
  expect((await harness.auth.listUsers()).users).toHaveLength(before.users.length + 1);
  expect(readGuestPurchaseTransition(harness.browserAuth)?.phase).toBe('SETTLED');
  expect((await harness.db.doc(`carts/${first.uid}`).get()).exists).toBe(false);
  expect((await harness.db.doc(`credentialAccess/${source.uid}`).get()).data()).toEqual(account);
  expect((await harness.db.doc(`carts/${source.uid}`).get()).data()).toEqual(durable.cart);
  expect((await harness.db.doc(`orders/${durable.orderId}`).get()).data()).toEqual(durable.order);
  expect((await harness.privateRequest(await harness.browserAuth.currentUser?.getIdToken() ?? '', `orders/${durable.orderId}`)).status).toBe(403);
}, 60_000);

test('the awaited real SDK signup cannot replace a concurrently admitted administrator when its unchanged HTTP response arrives late', async () => {
  const { harness, source, offer, durable } = await legacy();
  const admin = await adminFixture(harness), hold = harness.holdNextSignupResponse();
  try {
    const operation = startLegacyGuestPurchase(offer).catch((error: unknown) => error);
    await hold.reading;
    await signInWithCustomToken(harness.browserAuth, admin.token);
    const current = await harness.identity();
    expect(await requireCredentialSession(harness.auth, harness.db, current.claims, 'admin')).toMatchObject({ uid: admin.uid, admin: true });
    hold.release();
    expect(await operation).toMatchObject({ code: 'ACCESS_UNAVAILABLE' });
    expect(harness.browserAuth.currentUser?.uid).toBe(admin.uid);
    const returned = await harness.identity();
    expect(await requireCredentialSession(harness.auth, harness.db, returned.claims, 'admin')).toMatchObject({ uid: admin.uid, admin: true });
    expect(readGuestPurchaseTransition(harness.browserAuth)?.phase).toBe('SETTLED');
    expect((await harness.db.doc(`carts/${source.uid}`).get()).data()).toEqual(durable.cart);
    expect((await harness.db.doc(`orders/${durable.orderId}`).get()).data()).toEqual(durable.order);
  } finally { hold.release(); await harness.auth.deleteUser(admin.uid); }
}, 60_000);

test('a delayed authoritative eligibility body is discarded before sign-out if another registered identity now owns the SDK', async () => {
  const { harness, source, offer, durable } = await legacy();
  const admin = await adminFixture(harness), hold = harness.holdNextEligibilityBody();
  try {
    const operation = startLegacyGuestPurchase(offer).catch((error: unknown) => error);
    await hold.reading; await signInWithCustomToken(harness.browserAuth, admin.token); hold.release();
    expect(await operation).toMatchObject({ code: 'ACCESS_UNAVAILABLE' });
    expect(harness.browserAuth.currentUser?.uid).toBe(admin.uid);
    expect(readGuestPurchaseTransition(harness.browserAuth)).toBeNull();
    expect((await harness.db.doc(`carts/${source.uid}`).get()).data()).toEqual(durable.cart);
    expect((await harness.db.doc(`orders/${durable.orderId}`).get()).data()).toEqual(durable.order);
  } finally { hold.release(); await harness.auth.deleteUser(admin.uid); }
}, 60_000);

test('an old revoked token never admits its UID but cannot block the explicit public new-purchase transition', async () => {
  const { harness, source, offer, durable } = await legacy();
  const token = await source.getIdToken();
  await new Promise<void>(resolve => setTimeout(resolve, 1100));
  await harness.auth.revokeRefreshTokens(source.uid);
  expect(await harness.access(token)).toMatchObject({ status: 401 });
  const before = (await harness.auth.listUsers()).users.length;
  const admitted = await startLegacyGuestPurchase(offer);
  expect(admitted).toMatchObject({ admin: false, superadmin: false });
  expect(admitted.uid).not.toBe(source.uid);
  expect((await harness.auth.listUsers()).users).toHaveLength(before + 1);
  expect((await harness.db.doc(`orders/${durable.orderId}`).get()).data()).toEqual(durable.order);
  expect((await harness.db.collection('credentialSessions').where('uid', '==', source.uid).get()).empty).toBe(true);
}, 60_000);

test('an observed SDK identity loss suppresses ordinary signup until the explicit choice creates exactly one distinct user', async () => {
  const { harness, source, offer, durable } = await legacy();
  recordObservedIdentity(harness.browserAuth, source.uid);
  const before = (await harness.auth.listUsers()).users.length;
  // The official SDK operation delivers a real null state. This is a session
  // loss regression, not a claim that the Auth emulator invalidates refreshes.
  await signOut(harness.browserAuth);
  expect(harness.browserAuth.currentUser).toBeNull();
  expect(observedIdentityUid(harness.browserAuth)).toBe(source.uid);
  await expect(bootstrapAnonymousVisitor(harness.browserAuth)).rejects.toThrow('Elegí');
  expect((await harness.auth.listUsers()).users).toHaveLength(before);
  const admitted = await startLegacyGuestPurchase(offer);
  expect(admitted.uid).not.toBe(source.uid);
  expect(admitted).toMatchObject({ admin: false, superadmin: false });
  expect((await harness.auth.listUsers()).users).toHaveLength(before + 1);
  expect((await harness.db.doc(`carts/${source.uid}`).get()).data()).toEqual(durable.cart);
  expect((await harness.db.doc(`orders/${durable.orderId}`).get()).data()).toEqual(durable.order);
}, 60_000);

test('unknown cold SDKnull never starts a user until the explicit generic action; double action creates once and retries admission at the same UID', async () => {
  h = await guestHarness(); binding.auth = h.browserAuth;
  const before = (await h.auth.listUsers()).users.length;
  expect(h.browserAuth.currentUser).toBeNull();
  await expect(bootstrapAnonymousVisitor(h.browserAuth)).rejects.toThrow('Elegí');
  await expect(bootstrapAnonymousVisitor(h.browserAuth)).rejects.toThrow('Elegí');
  expect((await h.auth.listUsers()).users).toHaveLength(before);
  const [first, second] = await Promise.all([startExplicitAnonymousVisitor(h.browserAuth), startExplicitAnonymousVisitor(h.browserAuth)]);
  expect(second.uid).toBe(first.uid);
  expect((await h.auth.listUsers()).users).toHaveLength(before + 1);
  const admitted = await ensureCredentialSession(first);
  expect(admitted).toMatchObject({ uid: first.uid, admin: false, superadmin: false });
  const current = h.browserAuth.currentUser;
  if (!current) throw new Error('Expected current official guest identity');
  expect(await ensureCredentialSession(current)).toMatchObject({ uid: first.uid, admin: false });
  expect((await h.auth.listUsers()).users).toHaveLength(before + 1);
}, 60_000);
