import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';

const sdk = vi.hoisted(() => {
    type User = { uid: string; isAnonymous: boolean; getIdToken: () => Promise<string> };
    return { stock: 5, listeners: [] as ((value: unknown) => void)[], authListeners: [] as ((user: User | null) => void)[], user: { uid: 'repeat-anonymous', isAnonymous: true, getIdToken: async () => 'synthetic' } as User | null };
});
vi.mock('../../src/firebase', () => ({ auth: { get currentUser() { return sdk.user; } }, db: {} }));
vi.mock('../../src/firebaseUtils', () => ({ db: {}, upsertClientFromCheckout: vi.fn() }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, fn: (user: typeof sdk.user) => void) => { sdk.authListeners.push(fn); fn(sdk.user); return () => { sdk.authListeners = sdk.authListeners.filter(listener => listener !== fn); }; } }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, collection: string, id?: string) => ({ collection, id: id ?? 'cart' }), collection: vi.fn(), query: vi.fn(), where: vi.fn(), limit: vi.fn(), startAfter: vi.fn(), getDocsFromServer: vi.fn(),
    getDocFromServer: async (ref: { id: string }) => ({ exists: () => true, id: ref.id, data: () => ({ active: true, title: ref.id.toUpperCase(), priceUSD: 100, stockTotal: sdk.stock }) }),
    setDoc: async () => undefined, serverTimestamp: () => 0,
    onSnapshot: (ref: { collection: string }, _options: unknown, fn: (value: unknown) => void) => { if (ref.collection === 'carts') sdk.listeners.push(fn); return () => { sdk.listeners = sdk.listeners.filter(listener => listener !== fn); }; },
    addDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { CartProvider, useCart } from '../../src/context/CartContext';
import { useCatalogCheckout } from '../../src/hooks/useCatalogCheckout';
import { toast } from 'react-hot-toast';

let cart: ReturnType<typeof useCart>;
let checkout: ReturnType<typeof useCatalogCheckout>;
let root: ReturnType<typeof createRoot> | undefined;
let hash: string;
let starts: Record<string, unknown>[];
let reply: (body: Record<string, unknown>) => Promise<Response>;
let statusReply: (body: Record<string, unknown>) => Promise<Response>;
let statuses: Record<string, unknown>[];
const originalLocation = window.location;
const assign = vi.fn();
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid HTTP fixture');
    return Object.fromEntries(Object.entries(value));
}
function stored(uid = sdk.user?.uid) { return record(JSON.parse(localStorage.getItem(`mutter-checkout:${uid}`) ?? '{}')); }
function Probe() { cart = useCart(); checkout = useCatalogCheckout(true); return <div />; }
async function mount() {
    const element = document.createElement('div'); document.body.append(element); root = createRoot(element);
    await act(async () => root?.render(<CartProvider><Probe /></CartProvider>));
}
async function basket(id: string) {
    const item = { id, slug: id, title: { es: id, en: id }, name: id, image: '', price: 50, priceUSD: 50, quantity: 1 };
    await act(async () => sdk.listeners.forEach(listener => listener({ metadata: { fromCache: false, hasPendingWrites: false }, exists: () => true, data: () => ({ cartItems: [item] }) })));
}
async function pay() { await act(async () => checkout.pay()); }
async function reviewThenStart() {
    const before = starts.length; await pay(); expect(starts).toHaveLength(before); expect(checkout.quote?.total).toBe(100); await pay();
}
beforeEach(async () => {
    localStorage.clear(); sdk.listeners = []; sdk.authListeners = [];
    sdk.user = { uid: 'repeat-anonymous', isAnonymous: true, getIdToken: async () => 'synthetic' };
    starts = []; statuses = []; sdk.stock = 5; hash = 'a'.repeat(64); assign.mockReset();
    reply = async body => new Response(JSON.stringify({ id: `order-${String(body.key)}`, init_point: 'https://www.mercadopago.com.uy/checkout/v1/redirect?pref_id=synthetic' }));
    statusReply = async body => new Response(JSON.stringify({ id: `order-${String(body.key)}`, inventoryState: 'reserved', paymentStatus: 'pending', reservedUntil: 1, canRetry: false, init_point: 'https://www.mercadopago.com.uy/checkout/v1/redirect?pref_id=synthetic' }));
    // Only external HTTP/SDK/navigation boundaries are replaced. Hook, CartProvider,
    // purchase serialization, response validation and localStorage remain real.
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
        const body = record(JSON.parse(String(options.body)));
        if (body.action === 'availability') return new Response(JSON.stringify({ checked: true }));
        if (body.action === 'quote') return new Response(JSON.stringify({ quote: { hash, total: 100, currency: 'UYU', shippingCost: 0, items: [{ id: 'synthetic-quote-line', title: 'Synthetic', variantId: '', quantity: 1, unitPrice: 100, stock: 5 }] } }));
        if (body.action === 'status') { statuses.push(body); return statusReply(body); }
        expect(body.action).toBe('start'); starts.push(body); return reply(body);
    }));
    Object.defineProperty(window, 'location', { configurable: true, value: { href: originalLocation.href, assign } });
    await mount(); await basket('a');
    await act(async () => cart.setShippingInfo({ ...cart.shippingInfo, name: 'Synthetic', email: 'synthetic@example.invalid', phone: '123' }));
});
afterEach(async () => {
    await act(async () => root?.unmount()); root = undefined;
    // Happy DOM Storage is a Proxy: Vitest 4 descriptor restoration alone
    // cannot remove an injected method. Reset its implementation first.
    document.body.innerHTML = ''; vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

test('AUD-R1-01: A then B then C each starts after review, using different keys without recovery', async () => {
    await reviewThenStart(); expect(starts).toHaveLength(1); expect(assign).toHaveBeenCalledTimes(1);
    await basket('b'); await reviewThenStart();
    expect(starts).toHaveLength(2); expect(starts[1].key).not.toBe(starts[0].key); expect(checkout.recovery).toBe(false);
    await basket('c'); await reviewThenStart();
    expect(starts).toHaveLength(3); expect(new Set(starts.map(start => start.key)).size).toBe(3); expect(checkout.recovery).toBe(false);
});

test('matching active purchase resumes by the same key before checking stock, including a double click', async () => {
    await pay(); await act(async () => { await Promise.all([checkout.pay(), checkout.pay()]); });
    expect(starts).toHaveLength(1); sdk.stock = 0; await pay(); expect(starts).toHaveLength(1);
    expect(statuses[0].key).toBe(starts[0].key); expect(assign).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('lastOrderId')).toBe(`order-${String(starts[0].key)}`); expect(checkout.recovery).toBe(false);
});

test('a price change never rotates the key of an active identical purchase', async () => {
    await reviewThenStart(); hash = 'b'.repeat(64); const pending = stored();
    await pay(); await pay(); expect(starts).toHaveLength(1); expect(statuses).toHaveLength(2);
    expect(statuses.every(status => status.key === pending.key)).toBe(true); expect(stored()).toEqual(pending);
});

test('received start is persisted before navigation and survives remount', async () => {
    let receiptAtNavigation: unknown;
    assign.mockImplementation(() => { receiptAtNavigation = stored().receivedOrderId; });
    await reviewThenStart(); expect(assign).toHaveBeenCalledTimes(1);
    expect(receiptAtNavigation).toBe(`order-${String(starts[0].key)}`);
    await act(async () => root?.unmount()); await mount(); await basket('a'); await pay();
    expect(starts).toHaveLength(1); expect(statuses[0].key).toBe(starts[0].key); expect(assign).toHaveBeenCalledTimes(2);
    assign.mockReset(); await basket('b'); await reviewThenStart(); expect(starts).toHaveLength(2);
    expect(starts[1].key).not.toBe(starts[0].key); expect(checkout.recovery).toBe(false);
});

test.each(['lost', 'uncertain', 'invalid-response'])('%s start preserves the pending key and blocks another content/quote after remount', async mode => {
    reply = async () => {
        if (mode === 'lost') throw Error('Response lost');
        if (mode === 'uncertain') return new Response(JSON.stringify({ code: 'RECOVERY_REQUIRED', error: 'Requires verification' }), { status: 409 });
        return new Response(JSON.stringify({ id: 'invalid', init_point: 'https://example.invalid' }));
    };
    statusReply = async body => new Response(JSON.stringify({ id: `order-${String(body.key)}`, inventoryState: 'attention', paymentStatus: 'unknown', reservedUntil: 1, canRetry: false }));
    await reviewThenStart(); expect(checkout.recovery).toBe(true); const pending = stored();
    expect(pending.receivedOrderId).toBeUndefined(); expect(assign).not.toHaveBeenCalled();
    await pay(); expect(starts).toHaveLength(1); expect(statuses[0].key).toBe(starts[0].key);
    await act(async () => root?.unmount()); await mount(); await basket('b'); await pay();
    expect(starts).toHaveLength(1); expect(checkout.recovery).toBe(true); expect(stored()).toEqual(pending);
    await basket('a'); hash = 'b'.repeat(64); await pay(); expect(starts).toHaveLength(1); expect(stored()).toEqual(pending);
});

test('lost response recovered with the same key enables a later different purchase', async () => {
    const success = reply; reply = async () => { throw Error('Response lost'); };
    await reviewThenStart(); expect(checkout.recovery).toBe(true);
    reply = success; await pay(); expect(statuses[0].key).toBe(starts[0].key); expect(checkout.recovery).toBe(false); expect(starts).toHaveLength(1);
    await basket('b'); await reviewThenStart(); expect(starts).toHaveLength(2); expect(starts[1].key).not.toBe(starts[0].key);
});

test('legacy record without receipt remains uncertain rather than being migrated to success', async () => {
    reply = async () => { throw Error('Response lost'); }; await reviewThenStart();
    const { key, content, quoteHash } = stored(); localStorage.setItem('mutter-checkout:repeat-anonymous', JSON.stringify({ key, content, quoteHash }));
    statusReply = async () => { throw Error('Historic intent cannot be verified'); };
    await basket('b'); await pay(); expect(starts).toHaveLength(1); expect(checkout.recovery).toBe(true);
});

test('anonymous and registered UIDs each repurchase, while an uncertain UID cannot borrow another receipt', async () => {
    await reviewThenStart(); await basket('b'); await reviewThenStart(); expect(starts).toHaveLength(2);
    const anonymous = stored();
    await act(async () => { sdk.user = { uid: 'repeat-registered', isAnonymous: false, getIdToken: async () => 'synthetic' }; sdk.authListeners.forEach(listener => listener(sdk.user)); });
    await basket('c'); await reviewThenStart(); await basket('d'); await reviewThenStart(); expect(starts).toHaveLength(4);
    expect(stored('repeat-anonymous')).toEqual(anonymous); expect(stored().key).not.toBe(anonymous.key);
    reply = async () => { throw Error('Response lost'); }; await basket('e'); await reviewThenStart(); const pending = stored();
    await act(async () => { sdk.user = { uid: 'repeat-anonymous', isAnonymous: true, getIdToken: async () => 'synthetic' }; sdk.authListeners.forEach(listener => listener(sdk.user)); });
    await basket('f'); reply = async body => new Response(JSON.stringify({ id: `order-${String(body.key)}`, init_point: 'https://www.mercadopago.com.uy/checkout/v1/redirect?pref_id=synthetic' }));
    await reviewThenStart(); expect(starts).toHaveLength(6); expect(checkout.recovery).toBe(false); expect(stored('repeat-registered')).toEqual(pending);
});

test.each(['initial-write', 'receipt-write', 'read'])('storage %s failure stays visible, never navigates or rotates an uncertain attempt', async mode => {
    const set = localStorage.setItem.bind(localStorage); const get = localStorage.getItem.bind(localStorage);
    const writeSpy = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
        if (key.startsWith('mutter-checkout:') && (mode === 'initial-write' || (mode === 'receipt-write' && 'receivedOrderId' in record(JSON.parse(value))))) throw Error('Storage unavailable');
        set(key, value);
    });
    const readSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(key => { if (mode === 'read' && key.startsWith('mutter-checkout:')) throw Error('Storage unavailable'); return get(key); });
    if (mode === 'read') await pay(); else await reviewThenStart();
    expect(starts).toHaveLength(mode === 'receipt-write' ? 1 : 0); expect(assign).not.toHaveBeenCalled();
    expect(checkout.recovery).toBe(true); expect(toast.error).toHaveBeenCalled();
    writeSpy.mockRestore(); readSpy.mockRestore();
    if (mode === 'receipt-write') {
        const pending = stored(); expect(pending.receivedOrderId).toBeUndefined();
        const resume = statusReply; statusReply = async () => { throw Error('Uncertain receipt'); };
        await basket('b'); await pay(); expect(starts).toHaveLength(1); expect(stored()).toEqual(pending);
        statusReply = resume; await basket('a'); await pay(); expect(starts).toHaveLength(1); expect(statuses.at(-1)?.key).toBe(starts[0].key); expect(assign).toHaveBeenCalledTimes(1);
    }
});

test.each(['QUOTE_CHANGED', 'CATALOG_UNAVAILABLE', 'INVALID_INPUT', 'INVALID_SHIPPING', 'INVALID_QUANTITY'])('definitive %s rejection clears only the rejected pending intent and requires review again', async code => {
    reply = async () => new Response(JSON.stringify({ code, error: 'Rejected before admission' }), { status: 409 });
    statusReply = async body => new Response(JSON.stringify({ id: `order-${String(body.key)}`, inventoryState: 'released', paymentStatus: 'not_started', reservedUntil: 0, canRetry: true }));
    await reviewThenStart(); expect(starts).toHaveLength(1); expect(localStorage.getItem('mutter-checkout:repeat-anonymous')).toBeNull(); expect(checkout.quote).toBeNull();
    await pay(); expect(starts).toHaveLength(1);
});

test('failed cleanup of a definitive rejection preserves the key with a visible recovery error', async () => {
    reply = async () => new Response(JSON.stringify({ code: 'QUOTE_CHANGED', error: 'Review again' }), { status: 409 });
    statusReply = async body => new Response(JSON.stringify({ id: `order-${String(body.key)}`, inventoryState: 'released', paymentStatus: 'not_started', reservedUntil: 0, canRetry: true }));
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw Error('Cannot persist rejection'); });
    await reviewThenStart(); expect(starts).toHaveLength(1); expect(stored().key).toBe(starts[0].key);
    expect(checkout.recovery).toBe(true); expect(assign).not.toHaveBeenCalled();
});

test.each(['{broken', '[]', '{"receivedOrderId":"unbound"}'])('malformed persisted record %s fails closed without replacing it', async raw => {
    localStorage.setItem('mutter-checkout:repeat-anonymous', raw);
    await pay(); expect(starts).toHaveLength(0); expect(checkout.recovery).toBe(true);
    expect(localStorage.getItem('mutter-checkout:repeat-anonymous')).toBe(raw); expect(assign).not.toHaveBeenCalled();
});

test('a late response after UID changes records its original owner and does not navigate the new user', async () => {
    const success = reply;
    reply = async body => {
        sdk.user = { uid: 'other-user', isAnonymous: false, getIdToken: async () => 'synthetic' };
        sdk.authListeners.forEach(listener => listener(sdk.user));
        return success(body);
    };
    await reviewThenStart(); expect(starts).toHaveLength(1); expect(assign).not.toHaveBeenCalled();
    expect(stored('repeat-anonymous').receivedOrderId).toBe(`order-${String(starts[0].key)}`);
    expect(localStorage.getItem('mutter-checkout:other-user')).toBeNull(); expect(checkout.recovery).toBe(false);
});

test('shipping changes use the complete purchase identity and require review before a new start', async () => {
    await reviewThenStart();
    await act(async () => cart.setShippingInfo({ ...cart.shippingInfo, phone: '456' }));
    await reviewThenStart(); expect(starts).toHaveLength(2); expect(starts[1].key).not.toBe(starts[0].key);
    expect(starts[1].purchase).toMatchObject({ shipping: { phone: '456' } });
});

test.each(['last-order-write', 'navigation', 'lost-retry'])('a durable received start remains known after %s fails', async mode => {
    const set = localStorage.setItem.bind(localStorage);
    if (mode === 'last-order-write') vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => { if (key === 'lastOrderId') throw Error('Cannot save last order'); set(key, value); });
    if (mode === 'navigation') assign.mockImplementation(() => { throw Error('Navigation unavailable'); });
    await reviewThenStart();
    if (mode === 'lost-retry') {
        const success = statusReply; statusReply = async () => { throw Error('Retry response lost'); }; await pay(); statusReply = success;
        expect(statuses[0].key).toBe(starts[0].key); expect(starts).toHaveLength(1);
    }
    expect(stored().receivedOrderId).toBe(`order-${String(starts[0].key)}`); expect(checkout.recovery).toBe(false);
    expect(toast.error).toHaveBeenCalled(); const before = starts.length;
    vi.resetAllMocks(); vi.restoreAllMocks(); assign.mockReset();
    await basket('b'); await reviewThenStart(); expect(starts).toHaveLength(before + 1); expect(starts[before].key).not.toBe(starts[0].key);
});

test('an empty order identity never records a receipt or navigates', async () => {
    reply = async () => new Response(JSON.stringify({ id: '', init_point: 'https://www.mercadopago.com.uy/checkout/v1/redirect?pref_id=synthetic' }));
    await reviewThenStart(); expect(starts).toHaveLength(1); expect(stored().receivedOrderId).toBeUndefined();
    expect(checkout.recovery).toBe(true); expect(assign).not.toHaveBeenCalled();
});


test('only a server-confirmed release permits a new key after a fresh review', async () => {
    await reviewThenStart(); const original = stored();
    statusReply = async body => new Response(JSON.stringify({ id: `order-${String(body.key)}`, inventoryState: 'released', paymentStatus: 'rejected', reservedUntil: 1, canRetry: true }));
    await pay(); expect(starts).toHaveLength(1); expect(localStorage.getItem('mutter-checkout:repeat-anonymous')).toBeNull();
    expect(checkout.quote?.total).toBe(100); await pay(); expect(starts).toHaveLength(2); expect(starts[1].key).not.toBe(original.key);
});

test.each(['reserved', 'attention'])('a %s status without a payment link never unlocks uncertain inventory', async inventoryState => {
    reply = async () => { throw Error('Lost start'); }; await reviewThenStart(); const original = stored();
    statusReply = async body => new Response(JSON.stringify({ id: `order-${String(body.key)}`, inventoryState, paymentStatus: 'in_process', reservedUntil: 1, canRetry: false }));
    await pay(); await pay(); expect(starts).toHaveLength(1); expect(stored()).toEqual(original); expect(checkout.recovery).toBe(true); expect(assign).not.toHaveBeenCalled();
});

test('a definitive start error alone cannot discard an uncertain key', async () => {
    reply = async () => new Response(JSON.stringify({ code: 'CATALOG_UNAVAILABLE', error: 'Unavailable' }), { status: 409 });
    statusReply = async () => { throw Error('Cannot prove release'); };
    await reviewThenStart(); expect(stored().key).toBe(starts[0].key); expect(checkout.recovery).toBe(true);
});

test('verified paid status prevents a new admission or payment redirect', async () => {
    await reviewThenStart(); assign.mockReset();
    statusReply = async body => new Response(JSON.stringify({ id: `order-${String(body.key)}`, inventoryState: 'committed', paymentStatus: 'approved', reservedUntil: 1, canRetry: false }));
    await pay(); expect(starts).toHaveLength(1); expect(assign).not.toHaveBeenCalled(); expect(localStorage.getItem('mutter-checkout:repeat-anonymous')).toBeNull();
    expect(checkout.quote).toBeNull(); expect(toast.success).toHaveBeenCalledWith('El pago de esta compra ya está confirmado.');
    await pay(); expect(starts).toHaveLength(1); expect(checkout.quote?.total).toBe(100);
    await pay(); expect(starts).toHaveLength(2); expect(starts[1].key).not.toBe(starts[0].key);
});


test('an explicit nonstandard payment port never records a receipt or navigates', async () => {
    reply = async () => new Response(JSON.stringify({ id: 'order', init_point: 'https://www.mercadopago.com.uy:8443/checkout' }));
    await reviewThenStart(); expect(starts).toHaveLength(1); expect(stored().receivedOrderId).toBeUndefined();
    expect(checkout.recovery).toBe(true); expect(assign).not.toHaveBeenCalled();
});
