import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const sdk = vi.hoisted(() => {
  type User = { uid: string; getIdToken: () => Promise<string> };
  return { user: { uid: 'return-owner', getIdToken: async () => 'synthetic' } as User | null, callbacks: [] as ((user: User | null) => void)[] };
});
const admission = vi.hoisted(() => ({ ensure: vi.fn() }));
vi.mock('../../src/firebase', () => ({ auth: { get currentUser() { return sdk.user; } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: typeof sdk.user) => void) => { sdk.callbacks.push(callback); callback(sdk.user); return () => { sdk.callbacks = sdk.callbacks.filter(saved => saved !== callback); }; } }));
// The page/client stay real; these UI tests declare the admission boundary.
// The browser flow separately uses real Auth, session exchange and handlers.
vi.mock('../../src/utils/credentialAccess', () => ({ ensureCredentialSession: admission.ensure }));
import SuccessPage from '../../src/pages/SuccessPage';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let response: Record<string, unknown>;
beforeEach(() => {
  sdk.user = { uid: 'return-owner', getIdToken: async () => 'synthetic' }; sdk.callbacks = [];
  admission.ensure.mockReset().mockImplementation(async (user: { uid: string }) => ({ status: 'ACTIVE', uid: user.uid,
    scope: 'BUYER_POST_CUTOVER_V1', admin: false, superadmin: false, expiresAtMs: Date.now() + 60_000 }));
  response = { id: 'order', inventoryState: 'reserved', paymentStatus: 'in_process', reservedUntil: 1, canRetry: false };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response))));
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals(); localStorage.clear(); });
async function mount(search: string) {
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  await act(async () => root?.render(<MemoryRouter initialEntries={[`/success${search}`]}><SuccessPage /></MemoryRouter>));
}
test('forged approved return is a hint and cannot display confirmation or clear another cart', async () => {
  localStorage.setItem('mutter-cart:return-owner', 'later-cart');
  await mount('?external_reference=order&payment_id=99&status=approved');
  expect(document.body.textContent).toContain('Tu pago aún no está confirmado'); expect(document.body.textContent).not.toContain('¡Pago confirmado!');
  expect(document.querySelector('button')?.classList.contains('text-gray-200')).toBe(true);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ action: 'verify', orderId: 'order', paymentId: '99' });
  expect(localStorage.getItem('mutter-cart:return-owner')).toBe('later-cart');
});
test('only server-committed inventory displays the confirmed sale', async () => {
  response = { ...response, inventoryState: 'committed', paymentStatus: 'approved' };
  await mount('?orderId=order'); expect(document.body.textContent).toContain('¡Pago confirmado!');
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ action: 'status', orderId: 'order' });
  expect(admission.ensure).toHaveBeenCalledTimes(1);
});
test('R1-B confirmed sale survives an additional pending verification, including reload', async () => {
  response = { ...response, inventoryState: 'committed', paymentStatus: 'approved', verificationPending: true };
  localStorage.setItem('mutter-cart:return-owner', 'later-cart');
  await mount('?orderId=order');
  expect(document.body.textContent).toContain('¡Pago confirmado!');
  expect(document.body.textContent?.toLowerCase()).toContain('comprobación adicional');
  expect(document.body.textContent).not.toContain('Tu pago aún no está confirmado');
  await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = '';
  await mount('?external_reference=order&payment_id=99&status=pending');
  expect(document.body.textContent).toContain('¡Pago confirmado!');
  expect(localStorage.getItem('mutter-cart:return-owner')).toBe('later-cart');
});
test.each(['duplicate_approved_payment', 'approved_without_stock', 'payment_identity_mismatch', 'payment_requires_attention'])(
  'R1-B actual commercial attention %s remains unconfirmed despite the additional-check marker', async attention => {
    response = { ...response, inventoryState: 'attention', paymentStatus: 'approved', attention, verificationPending: true };
    await mount('?orderId=order');
    expect(document.body.textContent).not.toContain('¡Pago confirmado!');
    expect(document.body.textContent).toContain('Tu pago aún no está confirmado');
  });
test('missing order never makes a verification request', async () => {
  await mount('?status=approved'); expect(fetch).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('No pudimos identificar');
});
test('provider or authorization error stays unconfirmed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'FORBIDDEN', error: 'Denied' }), { status: 403 })));
  await mount('?orderId=other-owner'); expect(document.body.textContent).not.toContain('¡Pago confirmado!'); expect(document.body.textContent).toContain('no vuelvas a pagar');
  expect(document.querySelector('button')?.classList.contains('text-gray-200')).toBe(true);
});
test('UID changes invalidate a late verification response', async () => {
  let resolve: ((response: Response) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  await mount('?orderId=order');
  await act(async () => { sdk.user = null; sdk.callbacks.forEach(callback => callback(null)); });
  await act(async () => resolve?.(new Response(JSON.stringify({ ...response, inventoryState: 'committed', paymentStatus: 'approved' }))));
  expect(document.body.textContent).not.toContain('¡Pago confirmado!');
});

test('return without its session finishes with an explicit message and never creates an identity or payment request', async () => {
  sdk.user = null;
  localStorage.setItem('mutter-cart:return-owner', 'preserved-cart');
  await mount('?orderId=order&payment_id=99&status=approved');
  expect(document.body.textContent).not.toContain('Verificando tu pago…');
  expect(document.body.textContent).not.toContain('¡Pago confirmado!');
  expect(document.body.textContent).toContain('No encontramos la sesión de esta compra');
  expect(document.body.textContent).toContain('no vuelvas a pagar');
  expect(admission.ensure).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  const retry = document.querySelector('button'); if (!retry) throw Error('Missing explicit verification control');
  await act(async () => retry.click());
  expect(admission.ensure).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect(localStorage.getItem('mutter-cart:return-owner')).toBe('preserved-cart');
});

test('a UID change while return admission is pending cannot send the old payment verification', async () => {
  let release: (() => void) | undefined;
  admission.ensure.mockImplementationOnce((user: { uid: string }) => new Promise(resolve => {
    release = () => resolve({ status: 'ACTIVE', uid: user.uid, scope: 'BUYER_POST_CUTOVER_V1',
      admin: false, superadmin: false, expiresAtMs: Date.now() + 60_000 });
  }));
  await mount('?orderId=order&payment_id=99');
  expect(admission.ensure).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  await act(async () => { sdk.user = null; sdk.callbacks.forEach(callback => callback(null)); });
  if (!release) throw Error('Missing controlled return admission');
  await act(async () => release?.());
  expect(fetch).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('¡Pago confirmado!');
  expect(document.body.textContent).toContain('No encontramos la sesión de esta compra');
});
