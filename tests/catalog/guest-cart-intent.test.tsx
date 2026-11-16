import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { CartItem } from '../../src/data/types';

type Identity = { uid: string; email: string | null; phoneNumber: string | null; displayName: string | null;
  providerData: { providerId: string }[]; isAnonymous: boolean; provider: 'native' | 'custom'; getIdToken: () => Promise<string> };
type Snapshot = { id: string; metadata: { fromCache: boolean; hasPendingWrites: boolean }; exists: () => boolean; data: () => unknown };
const sdk = vi.hoisted(() => ({
  currentUser: null as Identity | null,
  tokenListeners: [] as ((user: Identity | null) => void)[],
  authListeners: [] as ((user: Identity | null) => void)[],
  before: [] as ((user: Identity | null) => void)[],
  carts: [] as { uid: string; next: (snapshot: Snapshot) => void; error: (failure: Error) => void; stopped: boolean }[],
  signups: 0, signouts: 0, stock: 9, ready: Promise.resolve(),
  write: vi.fn<(ref: { id: string }, body: { cartItems: CartItem[] }) => Promise<void>>(),
  session: vi.fn<(user: Identity) => Promise<Response>>(),
}));
vi.mock('../../src/firebase', () => ({ auth: {
  get currentUser() { return sdk.currentUser; },
  app: { options: { projectId: 'demo-guest-cart-intent' } },
  authStateReady: () => sdk.ready,
}, db: {} }));
vi.mock('../../src/firebaseUtils', () => ({ db: {} }));
vi.mock('firebase/auth', () => ({
  onIdTokenChanged: (_auth: unknown, listener: (user: Identity | null) => void) => {
    sdk.tokenListeners.push(listener); listener(sdk.currentUser);
    return () => { sdk.tokenListeners = sdk.tokenListeners.filter(value => value !== listener); };
  },
  onAuthStateChanged: (_auth: unknown, listener: (user: Identity | null) => void) => {
    sdk.authListeners.push(listener); listener(sdk.currentUser);
    return () => { sdk.authListeners = sdk.authListeners.filter(value => value !== listener); };
  },
  beforeAuthStateChanged: (_auth: unknown, listener: (user: Identity | null) => void) => {
    sdk.before.push(listener); return () => { sdk.before = sdk.before.filter(value => value !== listener); };
  },
  signInAnonymously: async () => {
    sdk.signups++;
    const user = identity(`fresh-guest-${sdk.signups}`, true);
    changeIdentity(user);
    return { user };
  },
  signInWithCustomToken: async () => {
    const current = sdk.currentUser;
    if (!current) throw new Error('Missing synthetic SDK identity');
    const user = identity(current.uid, false, current.email);
    changeIdentity(user);
    return { user };
  },
  signOut: async () => { sdk.signouts++; changeIdentity(null); },
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  collection: vi.fn(), query: vi.fn(), where: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
  getDocsFromServer: vi.fn(), addDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(),
  serverTimestamp: () => 0,
  getDocFromServer: async () => ({ id: 'selected-product', exists: () => true,
    data: () => ({ active: true, title: { es: 'Actual', en: 'Current' }, priceUSD: 20, stockTotal: sdk.stock, variants: [] }) }),
  setDoc: (ref: { id: string }, body: { cartItems: CartItem[] }) => sdk.write(ref, body),
  onSnapshot: (ref: { collection: string; id: string }, _options: unknown, next: (snapshot: Snapshot) => void, error: (failure: Error) => void) => {
    if (ref.collection !== 'carts') return () => undefined;
    const listener = { uid: ref.id, next, error, stopped: false }; sdk.carts.push(listener);
    return () => { listener.stopped = true; };
  },
}));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn() } }));

// Only the SDK/network boundary is synthetic. AuthProvider, admission/exchange,
// CartProvider, authoritative-snapshot filtering, enrichment and persistence run
// their production implementations together; no readiness result is injected.
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import { CartProvider, useCart } from '../../src/context/CartContext';
import { auth } from '../../src/firebase';
import { recordObservedIdentity } from '../../src/utils/observedIdentity';
let root: Root | null = null;
let current: { auth: ReturnType<typeof useAuth>; cart: ReturnType<typeof useCart> } | null = null;
const item: CartItem = { id: 'selected-product', slug: 'selected-product', name: 'Selected', title: { es: 'Selected', en: 'Selected' },
  image: '', quantity: 2, price: 1, priceUSD: 1 };
function Inspect() { current = { auth: useAuth(), cart: useCart() }; return <output>{current.cart.cartReady ? 'ready' : current.auth.credentialAccess}</output>; }
function view() { if (!current) throw new Error('Providers not rendered'); return current; }
function identity(uid: string, anonymous: boolean, email: string | null = null): Identity {
  return { uid, email, phoneNumber: null, displayName: null, providerData: email ? [{ providerId: 'password' }] : [],
    isAnonymous: anonymous, provider: anonymous ? 'native' : 'custom', getIdToken: async () => `${anonymous ? 'native' : 'custom'}:${uid}` };
}
function changeIdentity(user: Identity | null) {
  sdk.before.forEach(listener => listener(user)); sdk.currentUser = user;
  if (user) recordObservedIdentity(auth, user.uid);
  sdk.authListeners.forEach(listener => listener(user)); sdk.tokenListeners.forEach(listener => listener(user));
}
function active(user: Identity, scope: 'BUYER_POST_CUTOVER_V1' | 'JOHN_ADMIN_CLOSED_V1' = 'BUYER_POST_CUTOVER_V1') {
  return new Response(JSON.stringify({ status: 'ACTIVE', uid: user.uid, admin: scope === 'JOHN_ADMIN_CLOSED_V1', superadmin: false,
    expiresAtMs: Date.now() + 86400000, scope, ...(user.provider === 'native' ? { customToken: 'synthetic-exchange' } : {}) }));
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred not initialized'); };
  const promise = new Promise<T>(complete => { resolve = complete; }); return { promise, resolve };
}
async function mount() {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(<AuthProvider><CartProvider><Inspect /></CartProvider></AuthProvider>));
}
function listener(uid = sdk.currentUser?.uid) {
  const found = sdk.carts.findLast(value => value.uid === uid && !value.stopped);
  if (!found) throw new Error(`No cart subscription for ${uid}`); return found;
}
async function restore(items: CartItem[] = [], fromCache = false) {
  await act(async () => listener().next({ id: 'cart', metadata: { fromCache, hasPendingWrites: false }, exists: () => true, data: () => ({ cartItems: items }) }));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear();
  sdk.currentUser = null; sdk.tokenListeners = []; sdk.authListeners = []; sdk.before = []; sdk.carts = [];
  sdk.signups = 0; sdk.signouts = 0; sdk.stock = 9; sdk.ready = Promise.resolve(); current = null;
  sdk.write.mockReset().mockResolvedValue(undefined); sdk.session.mockReset().mockImplementation(async user => active(user));
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, task: () => Promise<unknown>) => task() } });
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path === '/api/access/new-purchase-choice') return new Response(JSON.stringify({ newPurchase: null }));
    if (path !== '/api/access/session' || !sdk.currentUser) throw new Error(`Unexpected synthetic request ${path}`);
    return sdk.session(sdk.currentUser);
  }));
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = null; current = null; document.body.innerHTML = '';
  vi.unstubAllGlobals(); Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
});

test('navigation creates nothing; first Add waits through admission and the matching authoritative cart, and duplicate intent persists once', async () => {
  const admission = deferred<Response>(); sdk.session.mockImplementationOnce(() => admission.promise);
  const legacyCache = JSON.stringify([{ ...item, quantity: 7 }]);
  localStorage.setItem('cartItems', legacyCache);
  localStorage.setItem('lastOrderId', 'retained-order-reference');
  localStorage.setItem('shippingData', JSON.stringify({ name: 'Saved delivery' }));
  await mount();
  expect(sdk.signups).toBe(0); expect(sdk.session).not.toHaveBeenCalled(); expect(sdk.write).not.toHaveBeenCalled();
  expect(view().auth.canStartGuestPurchase).toBe(true);
  let first: Promise<boolean> | undefined, repeated: Promise<boolean> | undefined;
  await act(async () => { first = view().cart.addToCart(item); repeated = view().cart.addToCart(item); });
  expect(first).toBe(repeated); expect(sdk.signups).toBe(1); expect(view().cart.cartReady).toBe(false);
  expect(view().cart.cartError).toContain('comprobando'); expect(sdk.write).not.toHaveBeenCalled();
  const guest = sdk.currentUser; if (!guest) throw new Error('Missing guest');
  await act(async () => admission.resolve(active(guest)));
  expect(view().auth.credentialAccess).toBe('active'); expect(view().cart.cartReady).toBe(false);
  expect(sdk.write).not.toHaveBeenCalled();
  await restore([], true); expect(sdk.write).not.toHaveBeenCalled();
  await restore();
  expect(await first).toBe(true); expect(await repeated).toBe(true);
  expect(sdk.signups).toBe(1); expect(sdk.signouts).toBe(0); expect(sdk.write).toHaveBeenCalledTimes(1);
  expect(sdk.write.mock.calls[0]).toEqual([{ collection: 'carts', id: guest.uid }, expect.objectContaining({ cartItems: [expect.objectContaining({ id: item.id, quantity: 2, priceUSD: 20 })] })]);
  expect(view().cart.items).toEqual([expect.objectContaining({ id: item.id, quantity: 2 })]);
  expect(localStorage.getItem('cartItems')).toBe(legacyCache);
  expect(localStorage.getItem('lastOrderId')).toBe('retained-order-reference');
  expect(view().cart.shippingInfo.name).toBe('Saved delivery');
  expect(JSON.parse(localStorage.getItem('shippingData') || '{}')).toMatchObject({ name: 'Saved delivery' });
});

test('failed admission resolves the Add without a cart write or an automatic signup retry', async () => {
  sdk.session.mockResolvedValue(new Response('{}', { status: 503 })); await mount();
  let adding: Promise<boolean> | undefined;
  await act(async () => { adding = view().cart.addToCart(item); });
  expect(await adding).toBe(false); expect(sdk.signups).toBe(1); expect(sdk.signouts).toBe(0);
  expect(view().auth.credentialAccess).toBe('unavailable'); expect(sdk.write).not.toHaveBeenCalled();
});

test('an independently signed-in registered identity during guest admission is preserved and receives no queued Add', async () => {
  const admission = deferred<Response>(); sdk.session.mockImplementationOnce(() => admission.promise); await mount();
  let adding: Promise<boolean> | undefined;
  await act(async () => { adding = view().cart.addToCart(item); });
  const guest = sdk.currentUser; if (!guest) throw new Error('Missing guest');
  const registered = identity('independent-registered', false, 'holder@example.invalid');
  await act(async () => changeIdentity(registered));
  await act(async () => admission.resolve(active(guest)));
  expect(await adding).toBe(false); expect(sdk.currentUser?.uid).toBe(registered.uid);
  expect(view().auth.credentialAccess).toBe('active'); expect(view().auth.credentialError).toBeNull();
  expect(sdk.signouts).toBe(0); expect(sdk.write).not.toHaveBeenCalled();
});

test('a registered identity appearing before the fresh signup starts is retained without signup or Add', async () => {
  const ready = deferred<void>(); sdk.ready = ready.promise; await mount();
  let adding: Promise<boolean> | undefined;
  await act(async () => { adding = view().cart.addToCart(item); });
  await act(async () => changeIdentity(identity('registered-before-start', false, 'holder@example.invalid')));
  await act(async () => ready.resolve());
  expect(await adding).toBe(false); expect(sdk.currentUser?.uid).toBe('registered-before-start');
  expect(view().auth.credentialAccess).toBe('active'); expect(sdk.signups).toBe(0); expect(sdk.signouts).toBe(0);
  expect(sdk.write).not.toHaveBeenCalled();
});

test('identity change while the new cart initializes cancels the pending Add before any account receives it', async () => {
  await mount(); let adding: Promise<boolean> | undefined;
  await act(async () => { adding = view().cart.addToCart(item); });
  const oldListener = listener();
  await act(async () => changeIdentity(identity('other-buyer', false, 'other@example.invalid')));
  expect(await adding).toBe(false);
  await act(async () => oldListener.next({ id: 'old', metadata: { fromCache: false, hasPendingWrites: false }, exists: () => true, data: () => ({ cartItems: [] }) }));
  await restore(); expect(sdk.write).not.toHaveBeenCalled(); expect(sdk.currentUser?.uid).toBe('other-buyer');
});

test('a scoped administrator superseding initialization cannot receive the pending Add', async () => {
  await mount(); let adding: Promise<boolean> | undefined;
  await act(async () => { adding = view().cart.addToCart(item); });
  const currentGuest = sdk.currentUser; if (!currentGuest) throw new Error('Missing guest');
  sdk.session.mockImplementation(async user => active(user, 'JOHN_ADMIN_CLOSED_V1'));
  await act(async () => changeIdentity(identity(currentGuest.uid, false, 'admin@example.invalid')));
  expect(await adding).toBe(false); expect(view().auth.credentialScope).toBe('JOHN_ADMIN_CLOSED_V1');
  expect(sdk.write).not.toHaveBeenCalled(); expect(sdk.signouts).toBe(0);
});

test('an authoritative initialization error settles the pending Add without writing or recreating the guest', async () => {
  await mount(); let adding: Promise<boolean> | undefined;
  await act(async () => { adding = view().cart.addToCart(item); });
  await act(async () => listener().error(new Error('Synthetic cart read failed')));
  expect(await adding).toBe(false); expect(view().cart.cartError).toBe('Synthetic cart read failed');
  expect(sdk.signups).toBe(1); expect(sdk.write).not.toHaveBeenCalled();
});

test('a new access denial during initialization cancels the Add at the same UID without retrying signup', async () => {
  await mount(); let adding: Promise<boolean> | undefined;
  await act(async () => { adding = view().cart.addToCart(item); });
  const guest = sdk.currentUser; if (!guest) throw new Error('Missing guest');
  sdk.session.mockResolvedValue(new Response('{}', { status: 403 }));
  await act(async () => changeIdentity(guest));
  expect(await adding).toBe(false); expect(view().auth.credentialAccess).toBe('pending');
  expect(sdk.signups).toBe(1); expect(sdk.signouts).toBe(0); expect(sdk.write).not.toHaveBeenCalled();
});

test('current product availability is rechecked after admission and prevents an unavailable selected item from being written', async () => {
  await mount(); let adding: Promise<boolean> | undefined;
  await act(async () => { adding = view().cart.addToCart(item); });
  sdk.stock = 0;
  await restore();
  expect(await adding).toBe(false); expect(sdk.write).not.toHaveBeenCalled(); expect(sdk.signups).toBe(1);
});

test('unmount cancels the intent and late cart callbacks cannot write', async () => {
  await mount(); let adding: Promise<boolean> | undefined;
  await act(async () => { adding = view().cart.addToCart(item); }); const oldListener = listener();
  await act(async () => root?.unmount()); root = null;
  expect(await adding).toBe(false);
  oldListener.next({ id: 'late', metadata: { fromCache: false, hasPendingWrites: false }, exists: () => true, data: () => ({ cartItems: [] }) });
  expect(sdk.write).not.toHaveBeenCalled();
});

test('an existing admitted buyer keeps the UID, cart, delivery form and ordinary Add behavior', async () => {
  sdk.currentUser = identity('existing-buyer', false, 'buyer@example.invalid');
  localStorage.setItem('shippingData', JSON.stringify({ name: 'Existing delivery' }));
  await mount(); await restore([{ ...item, quantity: 1 }]);
  await act(async () => { expect(await view().cart.addToCart(item)).toBe(true); });
  expect(sdk.signups).toBe(0); expect(sdk.signouts).toBe(0); expect(sdk.currentUser?.uid).toBe('existing-buyer');
  expect(view().cart.items[0]?.quantity).toBe(3); expect(view().cart.shippingInfo.name).toBe('Existing delivery');
  expect(JSON.parse(localStorage.getItem('shippingData') || '{}')).toMatchObject({ name: 'Existing delivery' });
  expect(sdk.write).toHaveBeenCalledTimes(1);
});

test('historical recovery and scoped administrator states cannot invoke fresh guest preparation or erase their local cart', async () => {
  sdk.currentUser = identity('historical-user', false, 'holder@example.invalid');
  const cache = JSON.stringify({ items: [item], dirty: false }); localStorage.setItem('mutter-cart:historical-user', cache);
  sdk.session.mockResolvedValue(new Response('{}', { status: 403 })); await mount();
  expect(view().auth.credentialAccess).toBe('pending'); expect(view().auth.canStartGuestPurchase).toBe(false);
  await act(async () => { await expect(view().auth.prepareGuestCart()).rejects.toThrow('recuperá'); });
  expect(localStorage.getItem('mutter-cart:historical-user')).toBe(cache);
  expect(sdk.signups).toBe(0); expect(sdk.signouts).toBe(0); expect(sdk.write).not.toHaveBeenCalled();
  sdk.session.mockImplementation(async user => active(user, 'JOHN_ADMIN_CLOSED_V1'));
  await act(async () => changeIdentity(identity('scoped-admin', false, 'admin@example.invalid')));
  await act(async () => { await expect(view().auth.prepareGuestCart()).rejects.toThrow('no permite'); });
  expect(sdk.signups).toBe(0); expect(sdk.signouts).toBe(0); expect(sdk.write).not.toHaveBeenCalled();
});
