import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const sdk = vi.hoisted(() => {
  const user = { uid: 'same-demo-uid', email: 'holder@example.invalid', displayName: null, providerData: [], getIdToken: async () => sdk.token };
  return { user, token: 'old-demo-id-token', currentUser: user, listeners: [] as ((value: typeof user) => void)[], exchange: vi.fn(), signOut: vi.fn() };
});
vi.mock('../../src/firebase', () => ({ auth: { get currentUser() { return sdk.currentUser; } } }));
vi.mock('firebase/auth', () => ({
  onIdTokenChanged: (_auth: unknown, listener: (value: typeof sdk.user) => void) => { sdk.listeners.push(listener); listener(sdk.currentUser); return () => { sdk.listeners = sdk.listeners.filter(value => value !== listener); }; },
  signInWithCustomToken: async (_auth: unknown, customToken: string) => { sdk.exchange(customToken); sdk.token = 'new-demo-id-token'; sdk.listeners.forEach(listener => listener(sdk.currentUser)); return { user: sdk.currentUser }; },
  signOut: async () => { sdk.signOut(); },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { auth } from '../../src/firebase';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import { captureRecoveryNonce, completeCredentialRecovery, discardRecoveryNonce, ensureCredentialSession, requestCredentialRecovery } from '../../src/utils/credentialAccess';
let context: ReturnType<typeof useAuth> | null = null;
let root: ReturnType<typeof createRoot> | null = null;
function current() { if (!context) throw new Error('Context unavailable'); return context; }
function firebaseUser() { const user = auth.currentUser; if (!user) throw new Error('Demo user unavailable'); return user; }
function Probe() { context = useAuth(); return <p>{context.credentialAccess}</p>; }
async function mount() { const element = document.createElement('div'); document.body.append(element); root = createRoot(element); await act(async () => { root?.render(<AuthProvider><Probe /></AuthProvider>); }); }
const active = (admin = false) => ({ status: 'ACTIVE', uid: sdk.user.uid, admin, superadmin: false, expiresAtMs: Date.now() + 86400000 });
beforeEach(() => { sdk.currentUser = sdk.user; sdk.token = 'old-demo-id-token'; sdk.listeners = []; sdk.exchange.mockReset(); sdk.signOut.mockReset(); localStorage.clear(); discardRecoveryNonce(); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; context = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); });

test('old credential leaves the same account pending; local login data cannot grant admin or erase saved data', async () => {
  localStorage.setItem('mutter-cart:same-demo-uid', 'saved-cart');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
  await mount(); expect(current().credentialAccess).toBe('pending'); expect(current().user).toBeNull();
  await act(async () => { await expect(current().login({ id: 'forged-admin', name: 'Demo', email: 'fake@example.invalid', password: '' })).rejects.toThrow(); });
  expect(current().user).toBeNull(); expect(sdk.signOut).not.toHaveBeenCalled(); expect(sdk.currentUser.uid).toBe('same-demo-uid');
  expect(localStorage.getItem('mutter-cart:same-demo-uid')).toBe('saved-cart');
});
test('new admitted buyer exchanges only once, confirms same UID and has no administrative UI authority', async () => {
  let count = 0;
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { requests.push(url); return new Response(JSON.stringify(++count === 1 ? { ...active(), customToken: 'demo-custom-token' } : active())); }));
  await mount(); expect(current().credentialAccess).toBe('active'); expect(current().user).toBeNull(); expect(sdk.exchange).toHaveBeenCalledTimes(1);
  expect(requests).toEqual(['/api/access/session', '/api/access/session']); expect(sdk.currentUser.uid).toBe('same-demo-uid');
});
test('server-confirmed role admits the same administrative UID; failed later admission removes UI authority', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(active(true)))));
  await mount(); expect(current().user?.uid).toBe(sdk.user.uid);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
  await act(async () => { sdk.listeners.forEach(listener => listener(sdk.currentUser)); });
  expect(current().credentialAccess).toBe('pending'); expect(current().user).toBeNull(); expect(sdk.signOut).not.toHaveBeenCalled();
});
test('wrong UID response and an unavailable server never exchange or admit', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...active(true), uid: 'different-demo-uid', customToken: 'must-not-exchange' }))));
  await expect(ensureCredentialSession(firebaseUser())).rejects.toThrow(); expect(sdk.exchange).not.toHaveBeenCalled();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Transport failure'); }));
  await mount(); expect(current().credentialAccess).toBe('unavailable'); expect(current().user).toBeNull();
});
test('mail fragment is removed immediately and held only in memory; acknowledgment reveals no account details', async () => {
  const nonce = 'a'.repeat(64); window.history.replaceState(null, '', '/login#recovery=' + nonce);
  expect(captureRecoveryNonce()).toBe(nonce); expect(window.location.hash).toBe(''); expect(captureRecoveryNonce()).toBe(nonce);
  discardRecoveryNonce(); expect(captureRecoveryNonce()).toBeNull();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"status":"REQUEST_RECEIVED"}', { status: 202 })));
  await requestCredentialRecovery('holder@example.invalid'); expect(localStorage.length).toBe(0);
});
test('completion uses bearer and mail proof, then confirms capability with the same UID; failures retain the account', async () => {
  const calls: { url: string; body: unknown; header: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => { calls.push({ url, body: JSON.parse(String(options.body)), header: new Headers(options.headers).get('authorization') }); return new Response(JSON.stringify(url.endsWith('/complete') ? { ...active(true), customToken: 'demo-custom-token' } : active(true))); }));
  expect((await completeCredentialRecovery(firebaseUser(), 'b'.repeat(64))).uid).toBe(sdk.user.uid);
  expect(calls.map(call => call.url)).toEqual(['/api/access/recovery/complete', '/api/access/session']); expect(calls[0].body).toEqual({ nonce: 'b'.repeat(64) });
  expect(calls[0].header).toBe('Bearer old-demo-id-token'); expect(calls[1].header).toBe('Bearer new-demo-id-token'); expect(sdk.signOut).not.toHaveBeenCalled();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
  await expect(completeCredentialRecovery(firebaseUser(), 'c'.repeat(64))).rejects.toThrow(); expect(sdk.currentUser.uid).toBe(sdk.user.uid);
});
