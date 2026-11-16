import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

type DemoUser = { uid: string; email: string | null; phoneNumber: null; providerData: { providerId: string }[] };
const sdk = vi.hoisted(() => {
  const user: DemoUser = { uid: 'checkout-guest', email: null, phoneNumber: null, providerData: [] };
  return {
    user, currentUser: user as DemoUser | null,
    guards: [] as ((next: DemoUser | null) => void)[],
    access: 'active', scope: 'BUYER_POST_CUTOVER_V1',
    admit: vi.fn(), refresh: vi.fn(), link: vi.fn(),
  };
});
vi.mock('../../src/firebase', () => ({ auth: { get currentUser() { return sdk.currentUser; } } }));
vi.mock('firebase/auth', () => ({
  beforeAuthStateChanged: (_auth: unknown, guard: (next: DemoUser | null) => void) => {
    sdk.guards.push(guard); return () => { sdk.guards = sdk.guards.filter(value => value !== guard); };
  },
  EmailAuthProvider: { credential: (email: string, password: string) => ({ email, password }) },
  linkWithCredential: (user: DemoUser, credential: { email: string; password: string }) => sdk.link(user, credential),
}));
vi.mock('../../src/utils/credentialAccess', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/utils/credentialAccess')>();
  return { ...actual, ensureCredentialSession: (user: DemoUser) => sdk.admit(user) };
});
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({
  credentialAccess: sdk.access, credentialScope: sdk.scope, refreshAccess: sdk.refresh,
}) }));
vi.mock('../../src/context/CartContext', () => ({ useCart: () => ({ shippingInfo: { email: 'contact@example.invalid' } }) }));
import CheckoutAccountOption from '../../src/components/cart/CheckoutAccountOption';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | null = null;
const pay = vi.fn(), busy = vi.fn(), blocked = vi.fn();
const admitted = () => ({ status: 'ACTIVE', uid: sdk.user.uid, scope: 'BUYER_POST_CUTOVER_V1', admin: false, superadmin: false, expiresAtMs: Date.now() + 60000 });
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw Error('Deferred promise unavailable'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function input(type: string) {
  const element = document.querySelector<HTMLInputElement>(`input[type="${type}"]`);
  if (!element) throw Error(`Missing ${type} input`);
  return element;
}
function loginControl() {
  const element = [...document.querySelectorAll<HTMLElement>('a, [role="link"]')]
    .find(candidate => candidate.textContent === 'Ya tengo cuenta: ingresar');
  if (!element) throw Error('Missing account login control');
  return element;
}
function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="account-location">{location.pathname}{location.search}</output>;
}
async function type(type: string, value: string) {
  const element = input(type), setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw Error('Expected native input value setter');
  await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function render(checkoutBusy = false, isCheckoutBusy?: () => boolean) {
  if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); }
  await act(async () => root?.render(<MemoryRouter initialEntries={['/carrito']}><CurrentLocation /><form onSubmit={event => { event.preventDefault(); pay(); }}>
    <CheckoutAccountOption checkoutBusy={checkoutBusy} isCheckoutBusy={isCheckoutBusy} onBusyChange={busy} onCheckoutBlockedChange={blocked} />
  </form></MemoryRouter>));
}
async function choose() { await act(async () => input('checkbox').click()); }
async function save() {
  const button = document.querySelector<HTMLButtonElement>('button');
  if (!button) throw Error('Missing account action');
  await act(async () => button.click());
}
function linked() {
  sdk.user.email = 'contact@example.invalid'; sdk.user.providerData = [{ providerId: 'password' }];
  return { user: sdk.user };
}
beforeEach(() => {
  sdk.user.email = null; sdk.user.providerData = []; sdk.currentUser = sdk.user; sdk.guards = [];
  sdk.access = 'active'; sdk.scope = 'BUYER_POST_CUTOVER_V1';
  sdk.admit.mockReset().mockImplementation(async () => admitted());
  sdk.refresh.mockReset().mockImplementation(async () => admitted());
  sdk.link.mockReset().mockImplementation(async () => linked());
  pay.mockReset(); busy.mockReset(); blocked.mockReset(); localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = null; document.body.innerHTML = ''; vi.restoreAllMocks();
});

test('guest checkout starts without password fields or Auth requests and explains the existing-account cart', async () => {
  await render();
  expect(input('checkbox').checked).toBe(false);
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(document.querySelectorAll('form')).toHaveLength(1);
  expect(loginControl().getAttribute('href')).toBe('/login?return=cart');
  expect(document.body.textContent).toContain('Al ingresar usarás el carrito de esa cuenta.');
  expect(sdk.admit).not.toHaveBeenCalled(); expect(sdk.link).not.toHaveBeenCalled(); expect(blocked).not.toHaveBeenCalled();
});

test('optional account preserves the UID and waits for both post-link admission and refresh before success', async () => {
  const pendingLink = deferred<{ user: DemoUser }>(), pendingRefresh = deferred<ReturnType<typeof admitted>>();
  sdk.link.mockImplementation(() => pendingLink.promise); sdk.refresh.mockImplementation(() => pendingRefresh.promise);
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  await render(); await choose();
  expect(blocked).toHaveBeenLastCalledWith(true); expect(input('email').value).toBe('contact@example.invalid');
  expect(input('email').required).toBe(false); expect(input('password').required).toBe(false);
  await type('password', 'optional-secret'); await save(); await save();
  expect(sdk.link).toHaveBeenCalledTimes(1); expect(sdk.link.mock.calls[0]?.[0].uid).toBe('checkout-guest');
  expect(busy).toHaveBeenLastCalledWith(true); expect(pay).not.toHaveBeenCalled();
  expect(loginControl().tagName).toBe('SPAN'); expect(loginControl().hasAttribute('href')).toBe(false);
  expect(document.body.textContent).not.toContain('Tu cuenta está lista');
  await act(async () => pendingLink.resolve(linked()));
  expect(sdk.admit).toHaveBeenCalledTimes(2); expect(sdk.refresh).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain('Tu cuenta está lista');
  await act(async () => pendingRefresh.resolve(admitted()));
  expect(document.body.textContent).toContain('Tu cuenta está lista. Conservás este carrito.');
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  expect(blocked).toHaveBeenLastCalledWith(false); expect(busy).toHaveBeenLastCalledWith(false);
  expect(document.querySelector('input[type="password"]')).toBeNull(); expect(storage).not.toHaveBeenCalled();
});

test('Enter in account inputs creates only the optional account and never submits the checkout form', async () => {
  await render(); await choose(); await type('password', 'optional-secret');
  const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => input('password').dispatchEvent(key));
  expect(key.defaultPrevented).toBe(true); expect(sdk.link).toHaveBeenCalledTimes(1); expect(pay).not.toHaveBeenCalled();
});

test('a failed link stays selected and blocked, clears the password, and lets the buyer uncheck to continue as guest', async () => {
  sdk.link.mockRejectedValue({ code: 'auth/email-already-in-use' });
  await render(); await choose(); await type('password', 'optional-secret'); await save();
  expect(document.body.textContent).toContain('Ese correo ya tiene una cuenta.');
  expect(document.body.textContent).not.toContain('Tu cuenta está lista'); expect(input('password').value).toBe('');
  expect(input('checkbox').checked).toBe(true); expect(blocked).toHaveBeenLastCalledWith(true);
  expect(sdk.refresh).not.toHaveBeenCalled(); expect(pay).not.toHaveBeenCalled();
  await choose(); expect(blocked).toHaveBeenLastCalledWith(false);
  expect(document.querySelector('input[type="password"]')).toBeNull(); expect(document.body.textContent).not.toContain('Ese correo');
});

test('a post-link admission failure never reports account success even after the checkbox is cleared', async () => {
  sdk.admit.mockResolvedValueOnce(admitted()).mockRejectedValueOnce(Error('Synthetic unavailable admission'));
  await render(); await choose(); await type('password', 'optional-secret'); await save();
  expect(sdk.link).toHaveBeenCalledTimes(1); expect(sdk.refresh).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('Tu cuenta está lista'); expect(blocked).toHaveBeenLastCalledWith(true);
  await choose(); expect(blocked).toHaveBeenLastCalledWith(false);
  expect(document.body.textContent).toContain('Ingresá a tu cuenta para comprobar');
  expect(document.body.textContent).not.toContain('Estás comprando con tu cuenta');
});

test.each(['JOHN_ADMIN_CLOSED_V1', 'unknown-scope'])('the %s session cannot link credentials', async scope => {
  sdk.scope = scope; await render(); expect(input('checkbox').disabled).toBe(true);
  await choose(); expect(sdk.admit).not.toHaveBeenCalled(); expect(sdk.link).not.toHaveBeenCalled();
});

test('a fresh denial before account linking cannot borrow the previously active UI admission', async () => {
  sdk.admit.mockResolvedValue({ ...admitted(), scope: 'JOHN_ADMIN_CLOSED_V1', admin: true });
  await render(); await choose(); await type('password', 'optional-secret'); await save();
  expect(sdk.link).not.toHaveBeenCalled(); expect(sdk.refresh).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Se necesita un acceso de compras confirmado');
});

test('a delayed account link cannot overwrite another login or report its account as saved', async () => {
  const pending = deferred<void>();
  sdk.link.mockImplementation(async () => {
    await pending.promise;
    for (const guard of sdk.guards) guard(sdk.user);
    sdk.currentUser = sdk.user;
    return linked();
  });
  await render(); await choose(); await type('password', 'optional-secret'); await save();
  const other: DemoUser = { uid: 'other-account', email: 'other@example.invalid', phoneNumber: null, providerData: [{ providerId: 'password' }] };
  for (const guard of sdk.guards) guard(other);
  sdk.currentUser = other;
  await act(async () => pending.resolve());
  expect(sdk.currentUser.uid).toBe('other-account'); expect(sdk.refresh).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Cambió la sesión'); expect(document.body.textContent).not.toContain('Tu cuenta está lista');
  expect(sdk.guards).toHaveLength(0); expect(blocked).toHaveBeenLastCalledWith(true); expect(pay).not.toHaveBeenCalled();
});

test('checkout in progress disables account choice and login, then restores the choice when it settles', async () => {
  await render(true);
  expect(input('checkbox').disabled).toBe(true);
  const login = loginControl();
  expect(login.getAttribute('aria-disabled')).toBe('true');
  expect(login.tagName).toBe('SPAN'); expect(login.hasAttribute('href')).toBe(false); expect(login.tabIndex).toBe(-1);
  expect(document.body.textContent).toContain('Estamos preparando tu pago');
  await choose();
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  const auxiliary = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
  const context = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true });
  await act(async () => { login.dispatchEvent(click); login.dispatchEvent(auxiliary); login.dispatchEvent(context); });
  expect(document.querySelector('[data-testid="account-location"]')?.textContent).toBe('/carrito');
  expect(document.querySelector('a[href="/login?return=cart"]')).toBeNull(); expect(blocked).not.toHaveBeenCalled();
  expect(sdk.admit).not.toHaveBeenCalled(); expect(sdk.link).not.toHaveBeenCalled();
  await render(false);
  expect(input('checkbox').disabled).toBe(false);
  expect(loginControl().getAttribute('aria-disabled')).toBe('false'); expect(loginControl().getAttribute('href')).toBe('/login?return=cart');
  expect(document.body.textContent).not.toContain('Estamos preparando tu pago');
  await choose(); expect(input('checkbox').checked).toBe(true); expect(blocked).toHaveBeenLastCalledWith(true);
});

test('a checkout started in the same tick rejects account selection and login before React rerenders', async () => {
  let checkoutStarted = false;
  await render(false, () => checkoutStarted);
  const checkbox = input('checkbox'), login = loginControl();
  expect(checkbox.disabled).toBe(false); expect(login.getAttribute('aria-disabled')).toBe('false');
  checkoutStarted = true;
  await choose();
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  await act(async () => login.dispatchEvent(click));
  expect(checkbox.checked).toBe(false); expect(click.defaultPrevented).toBe(true);
  expect(blocked).not.toHaveBeenCalled(); expect(sdk.admit).not.toHaveBeenCalled(); expect(sdk.link).not.toHaveBeenCalled();
  checkoutStarted = false;
  await choose(); expect(input('checkbox').checked).toBe(true);
});

test('the live checkout guard blocks save and Enter without sending credentials and permits retry after checkout', async () => {
  let checkoutStarted = false;
  await render(false, () => checkoutStarted); await choose(); await type('password', 'optional-secret');
  checkoutStarted = true;
  await save();
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => input('password').dispatchEvent(enter));
  expect(enter.defaultPrevented).toBe(true); expect(pay).not.toHaveBeenCalled();
  expect(sdk.admit).not.toHaveBeenCalled(); expect(sdk.link).not.toHaveBeenCalled(); expect(busy).not.toHaveBeenCalled();
  expect(input('checkbox').checked).toBe(true); expect(blocked).toHaveBeenLastCalledWith(true);
  await render(true, () => checkoutStarted);
  expect(input('checkbox').disabled).toBe(true); expect(input('email').disabled).toBe(true); expect(input('password').disabled).toBe(true);
  expect(document.querySelector('button')?.disabled).toBe(true);
  checkoutStarted = false; await render(false, () => checkoutStarted); await save();
  expect(sdk.link).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain('Tu cuenta está lista');
});

test('starting an account action synchronously guards its checkbox, login and repeated save before React commits', async () => {
  const pending = deferred<{ user: DemoUser }>(); sdk.link.mockImplementation(() => pending.promise);
  await render(); await choose(); await type('password', 'optional-secret');
  const button = document.querySelector('button'), checkbox = input('checkbox'), login = loginControl();
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  const auxiliary = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
  const context = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true });
  // Reenter before the originating save handler returns and replaces the anchor.
  sdk.admit.mockImplementationOnce(async () => {
    expect(login.isConnected).toBe(true);
    login.dispatchEvent(click); login.dispatchEvent(auxiliary); login.dispatchEvent(context);
    checkbox.click(); button?.click();
    return admitted();
  });
  await act(async () => button?.click());
  expect(sdk.link).toHaveBeenCalledTimes(1); expect(checkbox.checked).toBe(true);
  expect(click.defaultPrevented).toBe(true); expect(auxiliary.defaultPrevented).toBe(true); expect(context.defaultPrevented).toBe(true);
  expect(blocked).toHaveBeenLastCalledWith(true);
  await act(async () => pending.resolve(linked()));
  expect(document.body.textContent).toContain('Tu cuenta está lista'); expect(pay).not.toHaveBeenCalled();
});

test.each(['auxclick', 'contextmenu'] as const)('the live checkout guard cancels native %s before the busy render replaces the login anchor', async eventName => {
  let checkoutStarted = false;
  await render(false, () => checkoutStarted);
  const login = loginControl(); expect(login.tagName).toBe('A');
  checkoutStarted = true;
  const event = new MouseEvent(eventName, { button: eventName === 'auxclick' ? 1 : 2, bubbles: true, cancelable: true });
  await act(async () => login.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(document.querySelector('[data-testid="account-location"]')?.textContent).toBe('/carrito');
  expect(sdk.link).not.toHaveBeenCalled(); expect(pay).not.toHaveBeenCalled();
});

test('idle login restores its destination and native auxiliary actions after checkout settles', async () => {
  await render(true); expect(loginControl().hasAttribute('href')).toBe(false);
  await render(false);
  const login = loginControl(); expect(login.tagName).toBe('A'); expect(login.getAttribute('href')).toBe('/login?return=cart');
  for (const [name, button] of [['auxclick', 1], ['contextmenu', 2]] as const) {
    const event = new MouseEvent(name, { button, bubbles: true, cancelable: true });
    await act(async () => login.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  }
  await act(async () => login.click());
  expect(document.querySelector('[data-testid="account-location"]')?.textContent).toBe('/login?return=cart');
  expect(sdk.admit).not.toHaveBeenCalled(); expect(sdk.link).not.toHaveBeenCalled(); expect(pay).not.toHaveBeenCalled();
});
