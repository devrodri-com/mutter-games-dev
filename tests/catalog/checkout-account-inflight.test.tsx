import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { parsePurchase } from '../../api/_lib/checkout-domain';
const state = vi.hoisted(() => ({
  user: { uid: 'synthetic-inflight-guest', email: null, phoneNumber: null, providerData: [], getIdToken: async () => 'SYNTHETIC_TOKEN' },
  refresh: vi.fn(), start: vi.fn(),
  items: [{ id: 'synthetic-product', slug: 'synthetic-product', title: { es: 'Producto', en: 'Product' }, priceUSD: 100, price: 100, quantity: 1, availability: 'available' }],
}));
vi.mock('../../src/firebase/products', () => ({ fetchProductById: vi.fn() }));
vi.mock('../../src/firebase', () => ({ db: {}, auth: { get currentUser() { return state.user; } } }));
vi.mock('../../src/firebaseUtils', () => ({ upsertClientFromCheckout: vi.fn() }));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ credentialAccess: 'active', credentialScope: 'BUYER_POST_CUTOVER_V1', credentialError: null, newPurchaseOffer: null, refreshAccess: vi.fn() }) }));
vi.mock('../../src/context/CartContext', () => ({ useCart: () => ({
  items: state.items,
  shippingInfo: { name: 'Comprador', email: 'synthetic@example.invalid', phone: '091234567', address: 'Av. Sintetica 123', address2: '', city: 'Las Piedras', state: 'Canelones', country: 'Uruguay', postalCode: '90200' },
  setShippingInfo: vi.fn(), removeItem: vi.fn(), refreshCart: state.refresh, cartReady: true, cartError: null,
}) }));
vi.mock('../../src/utils/credentialAccess', async original => ({
  ...await original<typeof import('../../src/utils/credentialAccess')>(),
  ensureCredentialSession: async () => {
    admissions++;
    if (phase === 'admission' && admissions === 3) { entered(); await pending; }
    return { status: 'ACTIVE', uid: state.user.uid, scope: 'BUYER_POST_CUTOVER_V1', admin: false, superadmin: false, expiresAtMs: Date.now() + 60_000 };
  },
}));
vi.mock('../../src/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'es' }) }));
vi.mock('../../src/components/CartNavbar', () => ({ default: () => null }));
vi.mock('../../src/components/Footer', () => ({ default: () => null }));
vi.mock('../../src/components/RelatedProducts', () => ({ default: () => null }));
vi.mock('../../src/components/cart/CartItems', () => ({ default: () => null }));
import CartPage from '../../src/pages/CartPage';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | null = null;
let phase: 'availability' | 'quote' | 'admission' = 'availability';
let admissions = 0;
let release: () => void;
let entered: () => void;
let started: Promise<void>;
let pending: Promise<void>;
function element<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector); if (!value) throw Error(`Missing ${selector}`); return value;
}
function choice() {
  const label = [...document.querySelectorAll('label')].find(value => value.textContent?.trim() === 'Crear una cuenta');
  const input = label?.querySelector<HTMLInputElement>('input'); if (!input) throw Error('Missing account choice'); return input;
}
function loginControl() {
  return element<HTMLElement>('a[href="/login?return=cart"], [role="link"][aria-disabled="true"]');
}
function submit() { element<HTMLFormElement>('#cart-checkout').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
function LocationProbe() { return <output data-testid="location">{useLocation().pathname}</output>; }
beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear(); admissions = 0; phase = 'availability';
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, options: unknown, task: (lock: object) => Promise<void>) => { void name; void options; return task({ name: 'synthetic-owned-lock' }); } } });
  started = new Promise<void>(resolve => { entered = resolve; });
  pending = new Promise<void>(resolve => { release = resolve; });
  state.refresh.mockReset().mockResolvedValue(state.items); state.start.mockReset();
  // Transport and SDK admission are synthetic. CartPage, payment hook,
  // request/send guards, attempt owner and purchase parser stay production code.
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    expect(String(input)).toBe('/api/create-mp-preference');
    const body: unknown = JSON.parse(String(init?.body));
    if (!body || typeof body !== 'object' || !('action' in body)) throw Error('Missing request action');
    if ('purchase' in body) expect(parsePurchase(body.purchase).shipping).toEqual(
      body.purchase && typeof body.purchase === 'object' && 'shipping' in body.purchase ? body.purchase.shipping : undefined,
    );
    if (body.action === phase) { entered(); await pending; }
    if (body.action === 'availability') return new Response(JSON.stringify({ checked: true }), { status: 200 });
    if (body.action === 'quote') return new Response(JSON.stringify({ quote: { hash: 'synthetic-current-quote', currency: 'UYU', total: 100, shippingCost: 0, items: [{ id: 'synthetic-product', variantId: '', title: 'Producto', quantity: 1, unitPrice: 100, stock: 1 }] } }), { status: 200 });
    if (body.action === 'start') { state.start(body); throw Error('SYNTHETIC_STOP_AFTER_START_FETCH_INVOKED'); }
    throw Error('Unexpected synthetic request action');
  }));
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(<MemoryRouter initialEntries={['/carrito']}><CartPage /><LocationProbe /></MemoryRouter>));
});
afterEach(async () => { release(); await act(async () => root?.unmount()); root = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); });
test('control: unchanged guest checkout reaches its real START dispatch once', async () => {
  await act(async () => submit()); await started;
  expect(choice().checked).toBe(false); await act(async () => release());
  expect(state.start).toHaveBeenCalledTimes(1);
});
test.each(['availability', 'quote', 'admission'] as const)('checkout excludes account choice and login throughout pending %s', async hold => {
  phase = hold;
  await act(async () => submit()); await started;
  const checkbox = choice(); expect(checkbox.disabled).toBe(true);
  const login = loginControl();
  await act(async () => { checkbox.click(); login.click(); submit(); });
  expect(checkbox.checked).toBe(false); expect(login.getAttribute('aria-disabled')).toBe('true');
  expect(login.hasAttribute('href')).toBe(false);
  expect(element<HTMLOutputElement>('[data-testid=location]').textContent).toBe('/carrito');
  expect(document.querySelector('input[type=password]')).toBeNull(); expect(state.start).not.toHaveBeenCalled();
  await act(async () => release());
  expect(state.start).toHaveBeenCalledTimes(1); expect(checkbox.checked).toBe(false); expect(checkbox.disabled).toBe(false);
  expect(loginControl().getAttribute('aria-disabled')).toBe('false');
  expect(loginControl().getAttribute('href')).toBe('/login?return=cart');
});
