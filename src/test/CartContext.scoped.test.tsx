import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '../data/types';

const probes = vi.hoisted(() => ({
  scope: undefined as 'JOHN_ADMIN_CLOSED_V1' | undefined,
  stop: vi.fn<() => void>(),
  listen: vi.fn<(uid: string, callback: (items: CartItem[], exists: boolean) => void, onError: (error: Error) => void) => () => void>(),
  save: vi.fn<(uid: string, items: CartItem[]) => Promise<void>>(),
  enrich: vi.fn<(items: CartItem[]) => Promise<CartItem[]>>(), toast: vi.fn<(message: string) => void>(),
}));
vi.mock('../firebase', () => ({ auth: { currentUser: { uid: 'synthetic-scoped-cart' } }, db: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: { uid: string }) => void) => {
  callback({ uid: 'synthetic-scoped-cart' }); return () => undefined;
} }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ credentialAccess: 'active', credentialScope: probes.scope }) }));
vi.mock('../utils/cartFirebase', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/cartFirebase')>()),
  listenToCartChanges: probes.listen, saveCartToFirebase: probes.save,
}));
vi.mock('../utils/cartUtils', () => ({ enrichCartItems: probes.enrich, isSameItem: (a: CartItem, b: CartItem) => a.id === b.id }));
vi.mock('../hooks/useLiveCartInventory', () => ({ useLiveCartInventory: (_uid: string | null, items: CartItem[]) => items }));
vi.mock('react-hot-toast', () => ({ toast: { error: probes.toast } }));
vi.mock('../utils/guestPurchaseState', () => ({
  observeGuestPurchaseState: () => () => undefined, observeNewPurchaseForm: () => () => undefined,
  readGuestPurchaseTransition: () => null,
}));
import { CartProvider, useCart } from '../context/CartContext';

const item: CartItem = { id: 'synthetic-item', slug: 'synthetic-item', name: 'Sintético', title: { es: 'Sintético', en: 'Synthetic' },
  image: 'https://example.invalid/synthetic.png', price: 12, priceUSD: 12, quantity: 1, availability: 'available' };
let mounted: Root | null = null, host: HTMLElement | null = null, current: ReturnType<typeof useCart> | null = null;
function Inspect() { current = useCart(); return <output>{current.cartReady ? 'ready' : 'unavailable'}</output>; }
function view() { if (!current) throw new Error('CART_NOT_RENDERED'); return current; }
async function render() {
  if (!host) { host = document.createElement('div'); document.body.append(host); mounted = createRoot(host); }
  await act(async () => { mounted?.render(<CartProvider><Inspect /></CartProvider>); await new Promise(resolve => setTimeout(resolve, 0)); });
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
  localStorage.clear(); current = null; probes.scope = undefined;
  vi.clearAllMocks(); probes.save.mockResolvedValue(undefined);
  probes.enrich.mockImplementation(async (items: CartItem[]) => items);
  probes.listen.mockImplementation((_uid: string, callback: (items: CartItem[], exists: boolean) => void) => {
    callback([], true); return probes.stop;
  });
});
afterEach(async () => { await act(async () => { mounted?.unmount(); }); host?.remove(); host = null; mounted = null; });

describe('closed John catalogue authority has no cart authority', () => {
  it('does not read, migrate, subscribe or persist a cart; its historical local cache stays intact', async () => {
    probes.scope = 'JOHN_ADMIN_CLOSED_V1';
    const cached = JSON.stringify({ items: [item], dirty: true });
    localStorage.setItem('mutter-cart:synthetic-scoped-cart', cached);
    localStorage.setItem('cartItems', JSON.stringify([item]));
    await render();
    expect(probes.listen).not.toHaveBeenCalled(); expect(probes.save).not.toHaveBeenCalled(); expect(probes.enrich).not.toHaveBeenCalled();
    expect(probes.toast).not.toHaveBeenCalled(); expect(view().items).toEqual([]); expect(view().cartReady).toBe(false); expect(view().cartError).toBeNull();
    expect(localStorage.getItem('mutter-cart:synthetic-scoped-cart')).toBe(cached); expect(localStorage.getItem('mutter-cart-migrated')).toBeNull();
    await act(async () => { expect(await view().addToCart(item)).toBe(false); await view().clearCart(); await expect(view().refreshCart()).rejects.toThrow(); });
    expect(probes.listen).not.toHaveBeenCalled(); expect(probes.save).not.toHaveBeenCalled(); expect(probes.enrich).not.toHaveBeenCalled();
    expect(localStorage.getItem('mutter-cart:synthetic-scoped-cart')).toBe(cached);
  });
  it('keeps the existing general buyer synchronization and pending-cache persistence', async () => {
    localStorage.setItem('mutter-cart:synthetic-scoped-cart', JSON.stringify({ items: [item], dirty: true }));
    await render();
    expect(probes.save).toHaveBeenCalledTimes(1); expect(probes.save).toHaveBeenCalledWith('synthetic-scoped-cart', expect.arrayContaining([expect.objectContaining({ id: item.id })]));
    expect(probes.listen).toHaveBeenCalledTimes(1); expect(view().cartReady).toBe(true); expect(view().cartError).toBeNull();
  });
  it('unsubscribes an existing general cart when the admitted scope becomes closed John', async () => {
    await render(); expect(probes.listen).toHaveBeenCalledTimes(1);
    const cached = localStorage.getItem('mutter-cart:synthetic-scoped-cart');
    probes.scope = 'JOHN_ADMIN_CLOSED_V1'; await render();
    expect(probes.stop).toHaveBeenCalledTimes(1); expect(probes.listen).toHaveBeenCalledTimes(1); expect(probes.save).not.toHaveBeenCalled();
    expect(localStorage.getItem('mutter-cart:synthetic-scoped-cart')).toBe(cached); expect(view().cartReady).toBe(false); expect(view().items).toEqual([]);
    const previousEnrich=probes.enrich.mock.calls.length,oldCallback=probes.listen.mock.calls[0]?.[1];
    if(!oldCallback)throw new Error('GENERAL_LISTENER_NOT_REGISTERED');
    await act(async()=>{oldCallback([item],true);});
    expect(probes.enrich).toHaveBeenCalledTimes(previousEnrich);expect(view().items).toEqual([]);
  });
});
