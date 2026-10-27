import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const sdk = vi.hoisted(() => {
  const user = { uid: 'scoped-admin-a', email: 'admin-a@example.invalid', displayName: null,
    providerData: [{ providerId: 'password' }], isAnonymous: false, phoneNumber: null,
    getIdToken: async () => 'fictitious-token' };
  return { user, currentUser: null as typeof user | null,
    listeners: [] as ((value: typeof user | null) => void)[],
    before: [] as ((value: typeof user | null) => void)[],
    rejectGuest: null as ((error: Error) => void) | null,
    sessionCalls: 0, allowSession: false, signInCalls: 0 };
});
vi.mock('../../src/firebase', () => ({ auth: {
  get currentUser() { return sdk.currentUser; },
  app: { options: { projectId: 'demo-r4-cache-replay' } },
  authStateReady: async () => undefined,
} }));
vi.mock('firebase/auth', () => ({
  onIdTokenChanged: (_auth: unknown, listener: (value: typeof sdk.user | null) => void) => {
    sdk.listeners.push(listener); listener(sdk.currentUser);
    return () => { sdk.listeners = sdk.listeners.filter(item => item !== listener); };
  },
  beforeAuthStateChanged: (_auth: unknown, listener: (value: typeof sdk.user | null) => void) => {
    sdk.before.push(listener); return () => { sdk.before = sdk.before.filter(item => item !== listener); };
  },
  signInAnonymously: () => new Promise<never>((_resolve, reject) => { sdk.rejectGuest = reject; }),
  signInWithEmailAndPassword: async () => { sdk.signInCalls++; sdk.currentUser = sdk.user; return { user: sdk.user }; },
  signInWithCustomToken: () => { throw new Error('No custom token exchange expected'); },
  signOut: async () => { throw new Error('No sign-out expected'); },
  EmailAuthProvider: { credential: vi.fn() }, linkWithCredential: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import LoginForm from '../../src/components/LoginForm';
import { discardRecoveryNonce } from '../../src/utils/credentialAccess';
let root: ReturnType<typeof createRoot> | null = null;
let context: ReturnType<typeof useAuth> | null = null;
function Probe() { context = useAuth(); return null; }
function current() { if (!context) throw new Error('Missing context'); return context; }
function setInput(id: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(id);
  if (!input) throw new Error(`Missing input ${id}`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
beforeEach(() => {
  sdk.currentUser = null; sdk.listeners = []; sdk.before = []; sdk.rejectGuest = null;
  sdk.sessionCalls = 0; sdk.allowSession = false; sdk.signInCalls = 0;
  localStorage.clear(); discardRecoveryNonce(); window.history.replaceState(null, '', '/login');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_key: unknown, _options: unknown, task: () => Promise<unknown>) => task() } });
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path !== '/api/access/session') throw new Error(`Unexpected HTTP ${path}`);
    sdk.sessionCalls++;
    return sdk.allowSession
      ? new Response(JSON.stringify({ status: 'ACTIVE', uid: sdk.user.uid, admin: true, superadmin: false,
        expiresAtMs: Date.now() + 86400000, scope: 'JOHN_ADMIN_CLOSED_V1' }))
      : new Response('{}', { status: 503 });
  }));
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = null; context = null;
  document.body.innerHTML = ''; vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
});

test('cached scoped admission cannot become newer through failed guest action after failed login', async () => {
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  await act(async () => { root?.render(<AuthProvider><Probe /><MemoryRouter initialEntries={['/login']}><Routes>
    <Route path="/login" element={<LoginForm />} />
    <Route path="/admin/productList" element={<h1>Catalog destination</h1>} />
  </Routes></MemoryRouter></AuthProvider>); });
  const guestButton = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('Empezar compra como invitado'));
  expect(guestButton).toBeDefined();
  await act(async () => { guestButton?.click(); });
  expect(sdk.rejectGuest).not.toBeNull();
  sdk.allowSession = true;
  await act(async () => {
    sdk.currentUser = sdk.user;
    sdk.before.forEach(listener => listener(sdk.user));
    sdk.listeners.forEach(listener => listener(sdk.user));
  });
  expect(current().credentialAdmissionVersion).toBe(1);
  expect(current().credentialScope).toBe('JOHN_ADMIN_CLOSED_V1');
  sdk.allowSession = false;
  await act(async () => { setInput('#access-email', 'admin-a@example.invalid'); setInput('#access-password', 'fake-password'); });
  await act(async () => document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(sdk.signInCalls).toBe(1);
  expect(sdk.sessionCalls).toBe(2);
  expect(current().credentialAdmissionVersion).toBe(1);
  expect(document.querySelector('h1')?.textContent).toBe('Ingresar a mi cuenta');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No pudimos comprobar el acceso');
  await act(async () => sdk.rejectGuest?.(new Error('Superseded guest sign-in')));
  expect(sdk.sessionCalls).toBe(2); // No newer server admission.
  expect(current().credentialAdmissionVersion).toBe(1); // Restoring cached UI is not a newer server admission.
  expect(document.querySelector('h1')?.textContent).toBe('Ingresar a mi cuenta');
  sdk.allowSession = true;
  await act(async () => sdk.listeners.forEach(listener => listener(sdk.user)));
  expect(sdk.sessionCalls).toBe(3);
  expect(current().credentialAdmissionVersion).toBe(2);
  expect(document.querySelector('h1')?.textContent).toBe('Catalog destination');
  expect(sdk.signInCalls).toBe(1);
});
