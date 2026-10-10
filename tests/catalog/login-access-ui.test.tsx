import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const sdk = vi.hoisted(() => {
  const user = { uid: 'login-demo-a', email: 'holder-a@example.invalid', displayName: null, providerData: [], getIdToken: async () => 'login-token-a' };
  return { user, currentUser: user, listeners: [] as ((value: typeof user) => void)[], signOut: vi.fn() };
});
// HTTP and Firebase sign-in are external UI boundaries. The real AuthProvider,
// admission parser and LoginForm remain coupled; real SDK/Rules suites cover authority.
vi.mock('../../src/firebase', () => ({ auth: { get currentUser() { return sdk.currentUser; } } }));
vi.mock('firebase/auth', () => ({
  onIdTokenChanged: (_auth: unknown, listener: (value: typeof sdk.user) => void) => { sdk.listeners.push(listener); listener(sdk.currentUser); return () => { sdk.listeners = sdk.listeners.filter(value => value !== listener); }; },
  signInWithEmailAndPassword: async () => { sdk.currentUser = sdk.user; sdk.listeners.forEach(listener => listener(sdk.user)); return { user: sdk.user }; },
  signInWithCustomToken: vi.fn(() => { throw new Error('This login fixture never exchanges a custom token'); }),
  signOut: async () => { sdk.signOut(); },
  EmailAuthProvider: { credential: vi.fn() },
  linkWithCredential: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import LoginForm from '../../src/components/LoginForm';
import { discardRecoveryNonce } from '../../src/utils/credentialAccess';
let root: ReturnType<typeof createRoot> | null = null;
let context: ReturnType<typeof useAuth> | null = null;
const admitted = (uid: string, admin: boolean) => ({ status: 'ACTIVE', uid, admin, superadmin: false, expiresAtMs: Date.now() + 86400000 });
const buyer = () => ({ ...sdk.user, uid: 'login-demo-b', email: 'holder-b@example.invalid', getIdToken: async () => 'login-token-b' });
function current() { if (!context) throw new Error('Auth context unavailable'); return context; }
function Probe() { context = useAuth(); return <output>{context.credentialAccess}</output>; }
async function mount() {
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  await act(async () => root?.render(<AuthProvider><Probe /><MemoryRouter initialEntries={['/login']}><Routes>
    <Route path="/login" element={<LoginForm />} /><Route path="/admin" element={<h1>Admin destination</h1>} /><Route path="/carrito" element={<h1>Cart destination</h1>} />
  </Routes></MemoryRouter></AuthProvider>));
}
async function submit() { const form = document.querySelector('form'); if (!form) throw new Error('Login form unavailable'); await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
beforeEach(() => { sdk.currentUser = sdk.user; sdk.listeners = []; sdk.signOut.mockReset(); discardRecoveryNonce(); window.history.replaceState(null, '', '/login'); });
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
