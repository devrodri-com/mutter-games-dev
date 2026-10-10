import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mapCatalogProduct, currentCartItem } from '../../src/domain/catalog';
import { identityForOption } from '../../src/domain/webInventory';

const sdk = vi.hoisted(() => ({
  product: undefined as unknown,
  listeners: [] as ((snapshot: unknown) => void)[],
  user: { uid: 'stock-ui', getIdToken: async () => 'synthetic' },
  credentialAccess: 'active' as 'loading' | 'active' | 'pending' | 'unavailable',
  credentialError: null as string | null,
  cartReady: true,
  cartError: null as string | null,
  addToCart: vi.fn(async (_item: unknown) => true),
}));
vi.mock('../../src/firebase', () => ({ auth: { currentUser: sdk.user }, db: {} }));
vi.mock('../../src/firebase/products', () => ({ fetchProductBySlug: async () => mapCatalogProduct('p', sdk.product) }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), onSnapshot: (_ref: unknown, _options: unknown, callback: (value: unknown) => void) => { sdk.listeners.push(callback); return () => undefined; } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: typeof sdk.user) => void) => { callback(sdk.user); return () => undefined; } }));
// This UI boundary supplies dispositions only; real SDK/Rules/browser suites
// independently exercise admission and authority without replacing Auth.
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ credentialAccess: sdk.credentialAccess, credentialError: sdk.credentialError }) }));
vi.mock('../../src/context/CartContext', () => ({ useCart: () => ({ addToCart: sdk.addToCart, items: [], cartReady: sdk.cartReady, cartError: sdk.cartError }) }));
vi.mock('../../src/components/ProductPageNavbar', () => ({ default: () => null }));
vi.mock('../../src/components/RelatedProducts', () => ({ default: () => null }));
vi.mock('../../src/components/Footer', () => ({ default: () => null }));
vi.mock('react-helmet-async', () => ({ Helmet: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'es' }, t: (text: string) => text }) }));
vi.mock('keen-slider/react', () => ({ useKeenSlider: () => [() => undefined, { current: null }] }));
import ProductPage from '../../src/pages/ProductPage';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
const base = { active: true, title: { es: 'Producto', en: 'Product' }, priceUSD: 100, stockTotal: 5, variants: [], images: [] };
const holdId = 'opaque-reservation-00000001';
const baseHold = { [holdId]: { expiresAt: 1, lines: [{ slot: 'base', identity: 'base', quantity: 1 }] } };
beforeEach(() => {
  sdk.listeners = [];
  sdk.credentialAccess = 'active'; sdk.credentialError = null;
  sdk.cartReady = true; sdk.cartError = null; sdk.addToCart.mockReset().mockResolvedValue(true);
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ checked: true }))));
});

async function renderProduct() {
  if (!root) {
    const element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  }
  await act(async () => root?.render(<MemoryRouter initialEntries={['/product/p']}><Routes><Route path="/product/:slug" element={<ProductPage />} /></Routes></MemoryRouter>));
}
function purchaseButtons() {
  const add = document.querySelector<HTMLButtonElement>('button[aria-label="Agregar al carrito"]');
  const quick = document.querySelector<HTMLButtonElement>('button[aria-label="Comprar ahora"]');
  if (!add || !quick) throw new Error('Missing responsive purchase controls');
  return { add, quick };
}

test('both purchase controls wait for admission and cart readiness, and remain blocked while adding', async () => {
  vi.useFakeTimers(); sdk.product = base; sdk.credentialAccess = 'loading'; sdk.cartReady = false;
  await renderProduct();
  const { add, quick } = purchaseButtons();
  expect(add.disabled).toBe(true); expect(quick.disabled).toBe(true);
  expect(document.body.textContent).toContain('Comprobando el acceso a tu carrito');
  await act(async () => { add.click(); quick.click(); }); expect(sdk.addToCart).not.toHaveBeenCalled();
  sdk.credentialAccess = 'active'; await renderProduct();
  expect(add.disabled).toBe(true); expect(quick.disabled).toBe(true);
  expect(document.body.textContent).toContain('Preparando tu carrito');
  sdk.cartReady = true; await renderProduct();
  expect(add.disabled).toBe(false); expect(quick.disabled).toBe(false);
  let finishAdd: ((added: boolean) => void) | undefined;
  sdk.addToCart.mockImplementationOnce(() => new Promise<boolean>(resolve => { finishAdd = resolve; }));
  await act(async () => add.click());
  expect(sdk.addToCart).toHaveBeenCalledTimes(1);
  expect(sdk.addToCart).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p', priceUSD: 100, quantity: 1 }));
  expect(add.disabled).toBe(true); expect(quick.disabled).toBe(true);
  if (!finishAdd) throw new Error('Missing pending add operation');
  await act(async () => finishAdd?.(true));
  await act(async () => vi.advanceTimersByTimeAsync(800));
  expect(add.disabled).toBe(false); expect(quick.disabled).toBe(false);
  await act(async () => quick.click()); expect(sdk.addToCart).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(800));
});

test.each(['pending', 'unavailable'] as const)('purchase controls retain recovery for %s without adding', async status => {
  sdk.product = base; sdk.credentialAccess = status; sdk.credentialError = 'No pudimos comprobar el acceso.';
  await renderProduct(); const { add, quick } = purchaseButtons();
  expect(add.disabled).toBe(true); expect(quick.disabled).toBe(true);
  expect(document.querySelector('a[href="/login?return=cart"]')?.textContent).toBe('Entrar con mi cuenta o recuperar el acceso');
  if (status === 'pending') expect(document.body.textContent).toContain('contactá a Mutter para recuperar el acceso');
  await act(async () => { add.click(); quick.click(); }); expect(sdk.addToCart).not.toHaveBeenCalled();
});

test('an active account cannot buy through a cart error until the error clears', async () => {
  sdk.product = base; sdk.cartError = 'No pudimos sincronizar el carrito.';
  await renderProduct(); const { add, quick } = purchaseButtons();
  expect(add.disabled).toBe(true); expect(quick.disabled).toBe(true);
  expect(document.querySelector('a[href="/carrito"]')?.textContent).toBe('Revisar mi carrito');
  await act(async () => { add.click(); quick.click(); }); expect(sdk.addToCart).not.toHaveBeenCalled();
  sdk.cartError = null; await renderProduct();
  expect(add.disabled).toBe(false); expect(quick.disabled).toBe(false);
  expect(mapCatalogProduct('p', sdk.product).stockTotal).toBe(5);
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.useRealTimers(); });

test('real mapper subtracts even elapsed holds, preserves source stocks and drives cart availability', () => {
  const source = { ...base, stockTotal: 1, webReservations: baseHold };
  const original = structuredClone(source);
  const product = mapCatalogProduct('p', source);
  expect(product.stockTotal).toBe(0); expect(product.hasWebReservations).toBe(true); expect(source).toEqual(original);
  const item = { id: 'p', slug: 'p', name: 'P', title: base.title, image: '', price: 100, priceUSD: 100, quantity: 1 };
  expect(currentCartItem(item, product).availability).toBe('unavailable');
  expect(mapCatalogProduct('p', base).stockTotal).toBe(5);
});

test.each([null, [], { bad: {} }, { [holdId]: { expiresAt: 1, lines: [{ slot: '0:0', identity: 'other', quantity: 1 }] } }])('malformed or mismatched reservation metadata fails closed: %j', webReservations => {
  expect(() => mapCatalogProduct('p', { ...base, webReservations })).toThrow();
});

test('a selected variant stays selected while live holds update its stock and disable purchasing', async () => {
  const label = { es: 'Color', en: 'Color' };
  const red = { value: 'Rojo', priceUSD: 100, stock: 1 };
  const blue = { value: 'Azul', priceUSD: 100, stock: 4 };
  sdk.product = { ...base, variants: [{ label, options: [red, blue] }] };
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  await act(async () => root?.render(<MemoryRouter initialEntries={['/product/p']}><Routes><Route path="/product/:slug" element={<ProductPage />} /></Routes></MemoryRouter>));
  const redButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Rojo');
  if (!redButton) throw Error('Missing variant selector');
  await act(async () => redButton.click()); expect(document.body.textContent).toContain('En stock: 1 unidad');
  const reserved = { ...base, variants: [{ label, options: [red, blue] }], webReservations: { [holdId]: { expiresAt: 1, lines: [{ slot: '0:0', identity: identityForOption(label, red), quantity: 1 }] } } };
  await act(async () => sdk.listeners[0]({ metadata: { fromCache: false, hasPendingWrites: false }, exists: () => true, id: 'p', data: () => reserved }));
  expect(redButton.className).toContain('bg-black'); expect(document.body.textContent).toContain('Sin stock');
  const buy = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'SIN STOCK');
  expect(buy?.disabled).toBe(true); expect(document.body.textContent).not.toContain('Comprar ahora');
  expect(mapCatalogProduct('p', reserved).stockTotal).toBe(4);
  expect(document.querySelector('[role="status"]')?.textContent).toContain('La disponibilidad mostrada ya las excluye');
  expect(fetch).not.toHaveBeenCalled();
});

test('focus and client clock never release a hold or amplify provider reads; trusted snapshots control availability', async () => {
  vi.useFakeTimers();
  sdk.product = { ...base, stockTotal: 1, webReservations: baseHold };
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  await act(async () => root?.render(<MemoryRouter initialEntries={['/product/p']}><Routes><Route path="/product/:slug" element={<ProductPage />} /></Routes></MemoryRouter>));
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(60 * 60_000));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(fetch).not.toHaveBeenCalled();
  expect(Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'SIN STOCK')?.disabled).toBe(true);
  await act(async () => sdk.listeners[0]({ metadata: { fromCache: false, hasPendingWrites: false }, exists: () => true, id: 'p', data: () => ({ ...base, stockTotal: 1 }) }));
  expect(Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Comprar ahora'))?.disabled).toBe(false);
  expect(document.querySelector('[role="status"]')).toBeNull();
});
