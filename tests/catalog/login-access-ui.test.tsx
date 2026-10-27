import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const sdk = vi.hoisted(() => {
  const user = { uid: 'login-demo-a', email: 'holder-a@example.invalid', displayName: null, providerData: [], getIdToken: async () => 'login-token-a' };
  return { user, currentUser: user, listeners: [] as ((value: typeof user) => void)[], signOut: vi.fn(), signInCalls: 0, emitOnSignIn: true, signInBarrier: null as Promise<void> | null };
});
// HTTP and Firebase sign-in are external UI boundaries. The real AuthProvider,
// admission parser and LoginForm remain coupled; real SDK/Rules suites cover authority.
vi.mock('../../src/firebase', () => ({ auth: { get currentUser() { return sdk.currentUser; } } }));
vi.mock('firebase/auth', () => ({
  onIdTokenChanged: (_auth: unknown, listener: (value: typeof sdk.user) => void) => { sdk.listeners.push(listener); listener(sdk.currentUser); return () => { sdk.listeners = sdk.listeners.filter(value => value !== listener); }; },
  signInWithEmailAndPassword: async () => { sdk.signInCalls++; if (sdk.signInBarrier) await sdk.signInBarrier; sdk.currentUser = sdk.user; if (sdk.emitOnSignIn) sdk.listeners.forEach(listener => listener(sdk.user)); return { user: sdk.user }; },
  signInWithCustomToken: vi.fn(() => { throw new Error('This login fixture never exchanges a custom token'); }),
  signOut: async () => { sdk.signOut(); },
  EmailAuthProvider: { credential: vi.fn() },
  linkWithCredential: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import LoginForm from '../../src/components/LoginForm';
import { captureRecoveryNonce, discardRecoveryNonce } from '../../src/utils/credentialAccess';
let root: ReturnType<typeof createRoot> | null = null;
let context: ReturnType<typeof useAuth> | null = null;
const admitted = (uid: string, admin: boolean) => ({ status: 'ACTIVE', uid, admin, superadmin: false, expiresAtMs: Date.now() + 86400000 });
const buyer = () => ({ ...sdk.user, uid: 'login-demo-b', email: 'holder-b@example.invalid', getIdToken: async () => 'login-token-b' });
function current() { if (!context) throw new Error('Auth context unavailable'); return context; }
function Probe() { context = useAuth(); return <output>{context.credentialAccess}</output>; }
async function mount() {
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  await act(async () => root?.render(<AuthProvider><Probe /><MemoryRouter initialEntries={['/login']}><Routes>
    <Route path="/login" element={<LoginForm />} /><Route path="/admin" element={<h1>Admin destination</h1>} /><Route path="/admin/productList" element={<h1>Existing catalog destination</h1>} /><Route path="/carrito" element={<h1>Cart destination</h1>} />
  </Routes></MemoryRouter></AuthProvider>));
}
async function submit() { const form = document.querySelector('form'); if (!form) throw new Error('Login form unavailable'); await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
beforeEach(() => { sdk.currentUser = sdk.user; sdk.listeners = []; sdk.signOut.mockReset(); sdk.signInCalls = 0; sdk.emitOnSignIn = true; sdk.signInBarrier = null; discardRecoveryNonce(); window.history.replaceState(null, '', '/login'); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; context = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); });

test('login navigates using the fresh role of the same UID rather than an earlier administrative admission', async () => {
  let count = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(admitted(sdk.user.uid, ++count < 3)))));
  await mount(); await submit();
  expect(document.querySelector('h1')?.textContent).toBe('Cart destination');
  expect(current().credentialAccess).toBe('active'); expect(current().user).toBeNull(); expect(sdk.currentUser.uid).toBe(sdk.user.uid);
});

test.each(['success', 'failure'] as const)('login cancels a late %s from UID A after UID B is admitted without redirecting or altering B', async outcome => {
  let count = 0;
  let resolveResponse: ((value: Response) => void) | undefined;
  let resolveBody: ((value: unknown) => void) | undefined;
  const lateResponse = new Response('{}');
  vi.spyOn(lateResponse, 'json').mockImplementation(() => new Promise<unknown>(resolve => { resolveBody = resolve; }));
  const next = buyer();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    if (new Headers(options.headers).get('authorization') === 'Bearer login-token-b') return new Response(JSON.stringify(admitted(next.uid, false)));
    if (++count < 3) return new Response(JSON.stringify(admitted(sdk.user.uid, true)));
    return outcome === 'success' ? lateResponse : new Promise<Response>(resolve => { resolveResponse = resolve; });
  }));
  await mount(); await submit();
  await act(async () => { sdk.currentUser = next; sdk.listeners.forEach(listener => listener(next)); });
  expect(current().credentialAccess).toBe('active'); expect(current().user).toBeNull();
  await act(async () => { if (outcome === 'success') resolveBody?.(admitted(sdk.user.uid, true)); else resolveResponse?.(new Response('{}', { status: 503 })); });
  expect(document.querySelector('h1')?.textContent).toBe('Ingresar a mi cuenta');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Ingreso anterior cancelado');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Cambió la cuenta');
  expect(current().credentialAccess).toBe('active'); expect(current().credentialError).toBeNull(); expect(current().user).toBeNull();
  expect(sdk.currentUser.uid).toBe(next.uid); expect(sdk.signOut).not.toHaveBeenCalled();
});

test('a fresh admission failure for the same UID retains its error without navigating or claiming cancellation', async () => {
  let count = 0;
  vi.stubGlobal('fetch', vi.fn(async () => ++count < 3 ? new Response(JSON.stringify(admitted(sdk.user.uid, true))) : new Response('{}', { status: 503 })));
  await mount(); await submit();
  expect(document.querySelector('h1')?.textContent).toBe('Ingresar a mi cuenta');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No pudimos comprobar el acceso');
  expect(document.querySelector('[role="status"]')?.textContent).not.toContain('cancelado');
  expect(current().credentialAccess).toBe('unavailable'); expect(sdk.currentUser.uid).toBe(sdk.user.uid); expect(sdk.signOut).not.toHaveBeenCalled();
});

const closedAdmin = (uid = sdk.user.uid) => ({ ...admitted(uid, true), scope: 'JOHN_ADMIN_CLOSED_V1' });
const unavailable = () => new Response('{}', { status: 503 });
function transport(session: () => Response) {
  const request = vi.fn(async (path: string) => {
    if (path === '/api/access/session') return session();
    if (path === '/api/access/new-purchase-choice') return new Response(JSON.stringify({ newPurchase: null }));
    if (path === '/api/access/recovery/complete') return unavailable();
    throw new Error(`Unexpected login request: ${path}`);
  });
  vi.stubGlobal('fetch', request);
  return request;
}
async function observe(next = sdk.currentUser) {
  await act(async () => { sdk.currentUser = next; sdk.listeners.forEach(listener => listener(next)); });
}
function staysAtLogin() {
  expect(document.querySelector('h1')?.textContent).toBe('Ingresar a mi cuenta');
  expect(sdk.signInCalls).toBe(1);
  expect(sdk.signOut).not.toHaveBeenCalled();
}

test('a later server admission of the failed login UID continues to its existing catalog without another form request', async () => {
  let allow = false;
  const request = transport(() => allow ? new Response(JSON.stringify(closedAdmin())) : unavailable());
  await mount(); await submit();
  staysAtLogin();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No pudimos comprobar el acceso');
  const callsBeforeObserver = request.mock.calls.length;
  allow = true;
  await observe();
  expect(current().credentialAccess).toBe('active');
  expect(current().user?.uid).toBe(sdk.user.uid);
  expect(current().credentialScope).toBe('JOHN_ADMIN_CLOSED_V1');
  expect(document.querySelector('h1')?.textContent).toBe('Existing catalog destination');
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(request.mock.calls.slice(callsBeforeObserver).map(([path]) => path)).toEqual(['/api/access/session']);
  expect(sdk.signInCalls).toBe(1);
  expect(sdk.signOut).not.toHaveBeenCalled();
});

test('the failed login stays visible when a later observer also has no server admission', async () => {
  transport(unavailable);
  await mount(); await submit(); await observe();
  staysAtLogin();
  expect(current().credentialAccess).toBe('unavailable');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No pudimos comprobar el acceso');
});

test('a later closed administrator admission for another UID cannot finish the failed login', async () => {
  let allow = false;
  const next = buyer();
  transport(() => allow ? new Response(JSON.stringify(closedAdmin(next.uid))) : unavailable());
  await mount(); await submit();
  allow = true; await observe(next);
  expect(current().credentialAccess).toBe('active');
  expect(current().user?.uid).toBe(next.uid);
  expect(current().credentialScope).toBe('JOHN_ADMIN_CLOSED_V1');
  staysAtLogin();
});

test.each(['no-admin-role', 'no-closed-scope'] as const)('a later same-UID admission with %s cannot auto-complete a failed administrative login', async boundary => {
  let allow = false;
  const result = boundary === 'no-admin-role' ? { ...closedAdmin(), admin: false } : admitted(sdk.user.uid, true);
  transport(() => allow ? new Response(JSON.stringify(result)) : unavailable());
  await mount(); await submit();
  allow = true; await observe();
  expect(current().credentialAccess).toBe('active');
  if (boundary === 'no-admin-role') expect(current().user).toBeNull();
  else expect(current().credentialScope).toBeNull();
  staysAtLogin();
});

test('a pending recovery nonce is retained even when the same UID later receives closed administrator admission', async () => {
  const nonce = 'b'.repeat(64);
  window.history.replaceState(null, '', `/login#recovery=${nonce}`);
  let allow = false;
  const request = transport(() => allow ? new Response(JSON.stringify(closedAdmin())) : unavailable());
  await mount(); await submit();
  expect(request.mock.calls.filter(([path]) => path === '/api/access/recovery/complete')).toHaveLength(1);
  const callsBeforeObserver = request.mock.calls.length;
  allow = true; await observe();
  expect(current().credentialAccess).toBe('active');
  staysAtLogin();
  expect(captureRecoveryNonce()).toBe(nonce);
  expect(request.mock.calls.slice(callsBeforeObserver).map(([path]) => path)).toEqual(['/api/access/session']);
});

test('a closed administrator admission from before the failed login does not complete that attempt', async () => {
  let allow = true;
  const request = transport(() => allow ? new Response(JSON.stringify(closedAdmin())) : unavailable());
  await mount();
  expect(current().credentialAccess).toBe('active');
  expect(current().user?.uid).toBe(sdk.user.uid);
  expect(document.querySelector('h1')?.textContent).toBe('Ingresar a mi cuenta');
  // Firebase may retain the same token without a fresh observer notification.
  // The existing server admission must not authorize navigation after this failure.
  sdk.emitOnSignIn = false;
  allow = false; await submit();
  expect(current().credentialAccess).toBe('active');
  expect(current().credentialScope).toBe('JOHN_ADMIN_CLOSED_V1');
  staysAtLogin();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No pudimos comprobar el acceso');
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/access/session', '/api/access/session']);
});

test.each(['observer-commit', 'refresh-before-commit'] as const)('an admission during a pending login (%s) cannot override its subsequent failure; a genuinely later admission can', async order => {
  let allow = false;
  const request = transport(() => allow ? new Response(JSON.stringify(closedAdmin())) : unavailable());
  await mount();
  sdk.emitOnSignIn = false;
  let releaseSignIn: (() => void) | undefined;
  sdk.signInBarrier = new Promise<void>(resolve => { releaseSignIn = resolve; });
  await submit();
  expect(sdk.signInCalls).toBe(1);
  if (order === 'observer-commit') {
    allow = true; await observe();
    expect(current().credentialAccess).toBe('active');
    allow = false; await act(async () => { releaseSignIn?.(); });
  } else {
    // The HTTP result is accepted before React commits the new context value.
    // A state value captured by the pending form would still be stale here.
    await act(async () => {
      allow = true; await current().refreshAccess();
      allow = false; releaseSignIn?.();
    });
  }
  expect(current().credentialAccess).toBe('active');
  staysAtLogin();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No pudimos comprobar el acceso');
  const callsBeforeObserver = request.mock.calls.length;
  allow = true; await observe();
  expect(document.querySelector('h1')?.textContent).toBe('Existing catalog destination');
  expect(request.mock.calls.slice(callsBeforeObserver).map(([path]) => path)).toEqual(['/api/access/session']);
  expect(sdk.signInCalls).toBe(1);
});

test('a server denial following a new admission prevents completing a failed login', async () => {
  let response = unavailable;
  const request = transport(() => response());
  await mount(); await submit();
  await act(async () => {
    response = () => new Response(JSON.stringify(closedAdmin()));
    await current().refreshAccess();
    response = () => new Response(JSON.stringify({ code: 'RECOVERY_REQUIRED' }), { status: 403 });
    await expect(current().refreshAccess()).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
  });
  expect(current().credentialAccess).toBe('pending');
  expect(current().user).toBeNull();
  expect(current().credentialScope).toBeNull();
  staysAtLogin();
  expect(request.mock.calls.filter(([path]) => path === '/api/access/session')).toHaveLength(4);
});

test('the token observer and refresh count one shared server response as one admission', async () => {
  let shared = false;
  let resolveResponse: ((value: Response) => void) | undefined;
  const response = new Promise<Response>(resolve => { resolveResponse = resolve; });
  const request = vi.fn(async (path: string) => {
    if (path === '/api/access/session') return shared ? response : unavailable();
    if (path === '/api/access/new-purchase-choice') return new Response(JSON.stringify({ newPurchase: null }));
    throw new Error(`Unexpected shared-admission request: ${path}`);
  });
  vi.stubGlobal('fetch', request);
  await mount();
  expect(current().credentialAdmissionVersion).toBe(0);
  shared = true;
  await act(async () => {
    sdk.listeners.forEach(listener => listener(sdk.user));
    const refreshing = current().refreshAccess();
    resolveResponse?.(new Response(JSON.stringify(closedAdmin())));
    await refreshing;
  });
  expect(request.mock.calls.filter(([path]) => path === '/api/access/session')).toHaveLength(2);
  expect(current().credentialAccess).toBe('active');
  expect(current().user?.uid).toBe(sdk.user.uid);
  expect(current().credentialAdmissionVersion).toBe(1);
  expect(sdk.signInCalls).toBe(0);
});
