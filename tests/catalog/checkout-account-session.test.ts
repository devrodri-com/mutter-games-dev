// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { signInWithEmailAndPassword, signOut, type Auth } from 'firebase/auth';
import { expect, test, vi } from 'vitest';
import { HASHED_CAPABILITY_FORMAT, JOHN_ADMIN_SCOPE } from '../../api/_lib/credential-access-state';
import { guestEpoch, guestHarness } from './guest-reentry-harness';

const binding: { auth: Auth | null } = vi.hoisted(() => ({ auth: null }));
// Only bind the actual demo SDK. The helper, account link, admission and Rules run unchanged.
vi.mock('../../src/firebase', () => ({ get auth() { if (!binding.auth) throw Error('Expected connected demo Auth'); return binding.auth; } }));
import { ensureCredentialSession } from '../../src/utils/credentialAccess';
import { linkCheckoutAccount } from '../../src/utils/checkoutAccount';

test('an admitted guest creates an optional same-UID account and returns by password without changing its cart or order', async () => {
  const h = await guestHarness('firebase.catalog-cutover.rules'); binding.auth = h.browserAuth;
  try {
    await h.db.doc('operations/credentialAccessCutover').set({ schema: 2, phase: 'ENFORCED', epoch: guestEpoch,
      legacyCutoffMs: 1, scope: JOHN_ADMIN_SCOPE, capabilityFormat: HASHED_CAPABILITY_FORMAT,
      subjectUid: 'synthetic-checkout-admin', additionalSubject: { uid: 'synthetic-checkout-owner', email: 'owner@example.invalid' } });
    const guest = await h.newGuest(), uid = guest.uid;
    const before = (await h.auth.listUsers()).users.length;
    expect(await ensureCredentialSession(guest)).toMatchObject({ uid, scope: 'BUYER_POST_CUTOVER_V1', admin: false, superadmin: false });
    const durable = await h.seedData(uid);
    const email = `checkout-${randomUUID()}@example.invalid`, password = `Synthetic-${randomUUID()}`;
    let refreshes = 0;
    await linkCheckoutAccount({ uid, email, password, refreshAccess: async () => {
      refreshes++;
      const current = h.browserAuth.currentUser;
      if (!current) throw Error('Expected same checkout account');
      return ensureCredentialSession(current);
    } });
    expect(refreshes).toBe(1);
    expect(h.browserAuth.currentUser?.uid).toBe(uid);
    expect((await h.auth.getUser(uid)).email).toBe(email);
    expect((await h.auth.listUsers()).users).toHaveLength(before);
    expect(await h.privateReads(uid, durable.orderId)).toEqual({ cart: durable.cart, order: durable.order });
    await signOut(h.browserAuth);
    const returned = await signInWithEmailAndPassword(h.browserAuth, email, password);
    expect(returned.user.uid).toBe(uid);
    expect(await ensureCredentialSession(returned.user)).toMatchObject({ uid, scope: 'BUYER_POST_CUTOVER_V1', admin: false, superadmin: false });
    expect(await h.privateReads(uid, durable.orderId)).toEqual({ cart: durable.cart, order: durable.order });
    expect((await h.auth.listUsers()).users).toHaveLength(before);
  } finally { binding.auth = null; await h.dispose(); }
}, 60_000);
