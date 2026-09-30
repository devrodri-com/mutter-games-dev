import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const sdk = vi.hoisted(() => {
  type User = { uid: string; getIdToken: () => Promise<string> };
  return { user: { uid: 'return-owner', getIdToken: async () => 'synthetic' } as User | null, callbacks: [] as ((user: User | null) => void)[] };
});
vi.mock('../../src/firebase', () => ({ auth: { get currentUser() { return sdk.user; } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: typeof sdk.user) => void) => { sdk.callbacks.push(callback); callback(sdk.user); return () => undefined; } }));
import SuccessPage from '../../src/pages/SuccessPage';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let response: Record<string, unknown>;
beforeEach(() => {
  sdk.user = { uid: 'return-owner', getIdToken: async () => 'synthetic' }; sdk.callbacks = [];
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
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ action: 'verify', orderId: 'order', paymentId: '99' });
  expect(localStorage.getItem('mutter-cart:return-owner')).toBe('later-cart');
});
test('only server-committed inventory displays the confirmed sale', async () => {
  response = { ...response, inventoryState: 'committed', paymentStatus: 'approved' };
  await mount('?orderId=order'); expect(document.body.textContent).toContain('¡Pago confirmado!');
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ action: 'status', orderId: 'order' });
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
});
test('UID changes invalidate a late verification response', async () => {
  let resolve: ((response: Response) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  await mount('?orderId=order');
  await act(async () => { sdk.user = null; sdk.callbacks.forEach(callback => callback(null)); });
  await act(async () => resolve?.(new Response(JSON.stringify({ ...response, inventoryState: 'committed', paymentStatus: 'approved' }))));
  expect(document.body.textContent).not.toContain('¡Pago confirmado!');
});
