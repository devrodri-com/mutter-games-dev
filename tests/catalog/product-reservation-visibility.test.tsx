import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
const source = vi.hoisted(() => ({
    failInventory: false,
    error: undefined as (() => void) | undefined,
    raw: { active: true, title: { es: 'Juego', en: 'Game' }, priceUSD: 100, stockTotal: 5,
        webReservations: { synthetic_reservation_12345: { expiresAt: 1, lines: [{ slot: 'base', identity: 'base', quantity: 1 }] } } },
}));
vi.mock('../../src/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'other' } } }));
vi.mock('firebase/firestore', () => ({ doc: () => ({}), onSnapshot: (_ref: unknown, _opts: unknown, _next: (s: unknown) => void, error: () => void) => {
    source.error = error; return () => {};
} }));
vi.mock('../../src/firebase/products', async () => {
    const { mapCatalogProduct } = await import('../../src/domain/catalog');
    return { fetchProductBySlug: async () => {
        if (source.failInventory) throw new Error('Authoritative inventory read failed');
        return mapCatalogProduct('game', source.raw);
    } };
});
import { usePublishedProduct } from '../../src/hooks/usePublishedProduct';
import { ProductReservationNotice } from '../../src/components/product/ProductReservationNotice';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
function Probe() {
    const { product, loading, error } = usePublishedProduct('game');
    if (loading) return <p>Cargando</p>;
    if (error) return <p role="alert">{error}</p>;
    return product ? <article><h1>{product.name}</h1><p>Disponible: {product.stockTotal}</p>
        <ProductReservationNotice hasReservations={product.hasWebReservations === true} />
        <button disabled={!product.stockTotal}>Comprar</button></article> : <p>No disponible</p>;
}
async function mount() {
    const element = document.createElement('div'); document.body.append(element); root = createRoot(element);
    await act(async () => { root?.render(<Probe />); });
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ''; source.failInventory = false; vi.unstubAllGlobals(); });
test('R1-4 trusted physical5/held1 displays4 and permits buying despite unrelated provider failure', async () => {
    const provider = vi.fn().mockRejectedValue(new Error('Provider unavailable'));
    vi.stubGlobal('fetch', provider);
    await mount();
    expect(document.querySelector('article')).not.toBeNull();
    expect(document.body.textContent).toContain('Disponible: 4');
    expect(document.querySelector('button')?.disabled).toBe(false);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('pendientes de verificación');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(provider).not.toHaveBeenCalled();
});
test('inventory read failure stays blocking and does not fabricate available quantity', async () => {
    source.failInventory = true; await mount();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.querySelector('button')).toBeNull(); expect(document.body.textContent).not.toContain('Disponible:');
});
test('live inventory loss removes purchase controls; another order reconciliation never does', async () => {
    await mount(); await act(async () => { source.error?.(); });
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.querySelector('button')).toBeNull();
});
