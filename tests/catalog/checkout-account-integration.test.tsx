import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({
  access: 'active',
  pay: vi.fn(async (): Promise<void> => undefined),
  link: vi.fn(), admit: vi.fn(),
  user: { uid: 'checkout-integration', email: null as string | null, phoneNumber: null, providerData: [] as { providerId: string }[] },
}));
vi.mock('../../src/firebase/products', () => ({ fetchProductById: vi.fn() }));
vi.mock('../../src/firebase', () => ({ db: {}, auth: { get currentUser() { return state.user; } } }));
vi.mock('firebase/auth', () => ({
  beforeAuthStateChanged: () => () => undefined,
  EmailAuthProvider: { credential: (email: string, password: string) => ({ email, password }) },
  linkWithCredential: (user: unknown, credential: unknown) => state.link(user, credential),
}));
vi.mock('../../src/utils/credentialAccess', async original => ({
  ...await original<typeof import('../../src/utils/credentialAccess')>(),
  ensureCredentialSession: () => state.admit(),
}));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({
  credentialAccess: state.access, credentialScope: 'BUYER_POST_CUTOVER_V1', credentialError: null,
  refreshAccess: () => state.admit(), newPurchaseOffer: null,
}) }));
vi.mock('../../src/context/CartContext', () => ({ useCart: () => ({
  items: [{ id: 'p', slug: 'p', title: { es: 'Producto', en: 'Product' }, priceUSD: 100, price: 100, quantity: 1 }],
  shippingInfo: { name: 'Comprador', email: 'contact@example.invalid', phone: '123456789', address: '', address2: '', city: '', state: '', country: 'Uruguay', postalCode: '' },
  setShippingInfo: vi.fn(), removeItem: vi.fn(), refreshCart: vi.fn(), cartReady: true, cartError: null,
}) }));
vi.mock('../../src/hooks/useCatalogCheckout', () => ({ useCatalogCheckout: () => ({ pay: state.pay, loading: false, quote: null, recovery: null }) }));
vi.mock('../../src/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'es' }) }));
vi.mock('../../src/components/CartNavbar', () => ({ default: () => null }));
vi.mock('../../src/components/Footer', () => ({ default: () => null }));
vi.mock('../../src/components/RelatedProducts', () => ({ default: () => null }));
vi.mock('../../src/components/cart/CartItems', () => ({ default: () => null }));
function LocationProbe() { return <output data-testid="location">{useLocation().pathname}</output>; }
import CartPage from '../../src/pages/CartPage';
import CredentialAccessNotice from '../../src/components/CredentialAccessNotice';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | null = null;
function element<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector); if (!value) throw Error(`Missing ${selector}`); return value;
}
function accountChoice() {
  const label = [...document.querySelectorAll('label')].find(value => value.textContent?.trim() === 'Crear una cuenta');
  const choice = label?.querySelector<HTMLInputElement>('input'); if (!choice) throw Error('Missing account choice'); return choice;
}
function loginControl() {
  return element<HTMLElement>('a[href="/login?return=cart"], [role="link"][aria-disabled="true"]');
}
function submit() { element<HTMLFormElement>('#cart-checkout').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
async function typePassword() {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw Error('Missing input setter');
  const input = element<HTMLInputElement>('input[type=password]');
  await act(async () => { setter.call(input, 'Synthetic-secret'); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
beforeEach(async () => {
  state.access = 'active'; state.user.email = null; state.user.providerData = [];
  state.pay.mockReset().mockResolvedValue(undefined); state.link.mockReset();
  state.admit.mockReset().mockResolvedValue({ uid: state.user.uid, scope: 'BUYER_POST_CUTOVER_V1', admin: false, superadmin: false });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(<MemoryRouter initialEntries={['/carrito']}><CredentialAccessNotice /><CartPage /><LocationProbe /></MemoryRouter>));
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.innerHTML = ''; });

test('the actual cart form permits guest checkout and requires no password or account action', async () => {
  expect(document.body.textContent).not.toContain('Podés continuar como invitado o');
  expect(accountChoice().checked).toBe(false); expect(document.querySelector('input[type=password]')).toBeNull();
  expect(element<HTMLButtonElement>('button[form=cart-checkout]').disabled).toBe(false);
  await act(async () => submit()); expect(state.pay).toHaveBeenCalledTimes(1);
  expect(state.admit).not.toHaveBeenCalled(); expect(state.link).not.toHaveBeenCalled();
});
test('choosing an account blocks even a same-tick checkout submission until it is unchecked', async () => {
  await act(async () => { accountChoice().click(); submit(); });
  expect(state.pay).not.toHaveBeenCalled(); expect(element<HTMLButtonElement>('button[form=cart-checkout]').disabled).toBe(true);
  await typePassword(); await act(async () => submit()); expect(state.pay).not.toHaveBeenCalled();
  await act(async () => accountChoice().click());
  expect(document.querySelector('input[type=password]')).toBeNull();
  await act(async () => submit()); expect(state.pay).toHaveBeenCalledTimes(1);
});
test('Enter in the account field links the same identity and releases checkout only after admission', async () => {
  let finish: (() => void) | undefined;
  state.link.mockImplementation(async () => {
    await new Promise<void>(resolve => { finish = resolve; });
    state.user.email = 'contact@example.invalid'; state.user.providerData = [{ providerId: 'password' }];
    return { user: state.user };
  });
  await act(async () => accountChoice().click()); await typePassword();
  const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => element<HTMLInputElement>('input[type=password]').dispatchEvent(key));
  expect(key.defaultPrevented).toBe(true); expect(state.link).toHaveBeenCalledTimes(1); expect(state.pay).not.toHaveBeenCalled();
  await act(async () => submit()); expect(state.pay).not.toHaveBeenCalled();
  await act(async () => finish?.());
  expect(state.admit).toHaveBeenCalledTimes(3); expect(document.body.textContent).toContain('Conservás este carrito');
  expect(element<HTMLButtonElement>('button[form=cart-checkout]').disabled).toBe(false);
  await act(async () => submit()); expect(state.pay).toHaveBeenCalledTimes(1);
});
test('a failed optional registration does not silently pay as guest', async () => {
  state.link.mockRejectedValue({ code: 'auth/email-already-in-use' });
  await act(async () => accountChoice().click()); await typePassword();
  const save = [...document.querySelectorAll('button')].find(button => button.textContent === 'Crear mi cuenta');
  if (!save) throw Error('Missing account save');
  await act(async () => save.click()); await act(async () => submit());
  expect(state.pay).not.toHaveBeenCalled(); expect(element<HTMLInputElement>('input[type=password]').value).toBe('');
  expect(element<HTMLButtonElement>('button[form=cart-checkout]').disabled).toBe(true);
});

test.each(['pending', 'unavailable', 'loading'])('the remaining %s access notice retains actual recovery and status feedback', async access => {
  state.access = access;
  await act(async () => root?.render(<MemoryRouter initialEntries={['/carrito']}><CredentialAccessNotice /></MemoryRouter>));
  expect(document.querySelector('[role=status]')).not.toBeNull();
  if (access === 'loading') expect(document.body.textContent).toContain('Comprobando el acceso');
  else expect(document.querySelector('a[href="/login?return=cart"]')).not.toBeNull();
});

test('starting checkout excludes same-tick account selection and login, then restores both controls', async () => {
  let finish: (() => void) | undefined;
  const choice = accountChoice();
  const originalLogin = loginControl();
  const auxiliary = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
  const context = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true });
  state.pay.mockImplementationOnce(() => new Promise<void>(resolve => {
    finish = resolve;
    // Reenter the actual UI before the submit handler returns and React replaces
    // the anchor. Events on a detached old node would not exercise its guards.
    expect(originalLogin.isConnected).toBe(true);
    originalLogin.dispatchEvent(auxiliary); originalLogin.dispatchEvent(context);
  }));
  await act(async () => { submit(); choice.click(); });
  expect(auxiliary.defaultPrevented).toBe(true); expect(context.defaultPrevented).toBe(true);
  expect(choice.checked).toBe(false); expect(choice.disabled).toBe(true);
  expect(state.pay).toHaveBeenCalledTimes(1); expect(state.admit).not.toHaveBeenCalled();
  const login = loginControl();
  expect(login.getAttribute('aria-disabled')).toBe('true');
  expect(login.hasAttribute('href')).toBe(false);
  await act(async () => login.click());
  expect(element<HTMLOutputElement>('[data-testid=location]').textContent).toBe('/carrito');
  await act(async () => submit()); expect(state.pay).toHaveBeenCalledTimes(1);
  await act(async () => finish?.());
  expect(choice.disabled).toBe(false); expect(loginControl().getAttribute('aria-disabled')).toBe('false');
  expect(loginControl().getAttribute('href')).toBe('/login?return=cart');
  await act(async () => choice.click());
  expect(choice.checked).toBe(true); expect(element<HTMLButtonElement>('button[form=cart-checkout]').disabled).toBe(true);
  expect(state.link).not.toHaveBeenCalled();
});

test('checkout failure releases account controls without a retry or account operation', async () => {
  state.pay.mockRejectedValueOnce(Error('Synthetic interrupted preflight'));
  await act(async () => submit());
  expect(state.pay).toHaveBeenCalledTimes(1); expect(accountChoice().disabled).toBe(false);
  await act(async () => accountChoice().click()); expect(accountChoice().checked).toBe(true);
  expect(state.admit).not.toHaveBeenCalled(); expect(state.link).not.toHaveBeenCalled();
});
