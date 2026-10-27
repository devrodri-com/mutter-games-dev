import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const sdk = vi.hoisted(() => {
  const user = { uid: 'selective-demo', email: 'holder@example.invalid', displayName: null,
    providerData: [], getIdToken: async () => 'synthetic-access-token' };
  return { user, currentUser: user, reads: [] as string[], listeners: [] as ((value: typeof user) => void)[],
    failRead: false, inconsistentInventory: false, afterProductRead: undefined as (() => void) | undefined };
});
vi.mock('../../src/firebase', () => ({ auth: { get currentUser() { return sdk.currentUser; } }, db: {} }));
vi.mock('../../src/firebaseUtils', () => ({ db: {} }));
vi.mock('firebase/auth', () => ({
  onIdTokenChanged: (_auth: unknown, listener: (value: typeof sdk.user) => void) => {
    sdk.listeners.push(listener); listener(sdk.currentUser);
    return () => { sdk.listeners = sdk.listeners.filter(item => item !== listener); };
  },
  signOut: vi.fn(), signInWithCustomToken: () => { throw new Error('Unexpected token exchange'); },
}));
// Replace only transport/SDK boundaries. The admission parser, read helper,
// normalizers, AuthProvider, route guard and catalog components run unchanged.
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocs: async (path: string) => {
    sdk.reads.push(path);
    return { docs: [{ id: path === 'categories' ? 'games' : 'sub', data: () => ({ name: path === 'categories' ? 'Juegos' : 'Consolas' }) }] };
  },
  getDocsFromServer: async (path: string) => {
    sdk.reads.push(path);
    if (sdk.failRead) throw new Error('Synthetic Firestore unavailable');
    sdk.afterProductRead?.();
    return { docs: [true, false].map(active => ({ id: active ? 'active-document' : 'inactive-document',
      data: () => ({ id: 'untrusted-data-id', title: { es: active ? 'Publicada' : 'Archivada', en: '' },
        category: 'games', subcategory: 'sub', priceUSD: 10, stockTotal: 1, active,
        images: ['https://example.invalid/catalog-image'], variants: [],
        ...(!active && sdk.inconsistentInventory ? {
          webReservations: { invalid: { quantity: -5 } },
          variants: [{ options: [{ priceUSD: 'invalid', stock: -8 }] }],
        } : {}) }) })) };
  },
  doc: vi.fn(), addDoc: () => { throw new Error('Unexpected Firestore write'); },
  deleteDoc: () => { throw new Error('Unexpected Firestore delete'); },
}));
vi.mock('../../src/components/admin/ClientList', () => ({ default: () => <p>Clients writer</p> }));
vi.mock('../../src/components/admin/ProductForm', () => ({ default: () => <p>Product writer</p> }));
vi.mock('../../src/components/admin/UserList', () => ({ default: () => <p>Users writer</p> }));
vi.mock('../../src/components/admin/AdminCategoryManager', () => ({ default: () => <p>Categories writer</p> }));
vi.mock('../../src/components/admin/OrderAdmin', () => ({ default: () => <p>Orders writer</p> }));
vi.mock('../../src/components/admin/ClientDetail', () => ({ ClientDetailWrapper: () => <p>Client detail writer</p> }));

import { AuthProvider } from '../../src/context/AuthContext';
import RequireAuth from '../../src/components/RequireAuth';
import AdminPanel from '../../src/pages/AdminPanel';
import { readAdminCatalog, requireWritableCatalog } from '../../src/firebase/adminCatalogRead';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let requests: string[];
let reply: () => Response;
const admitted = () => ({ status: 'ACTIVE', uid: sdk.user.uid, admin: true, superadmin: false,
  expiresAtMs: Date.now() + 60000, scope: 'JOHN_ADMIN_CLOSED_V1' });

beforeEach(() => {
  sdk.currentUser = sdk.user; sdk.reads = []; sdk.listeners = []; sdk.failRead = false;
  sdk.afterProductRead = undefined; sdk.inconsistentInventory = false; requests = [];
  reply = () => new Response(JSON.stringify(admitted()));
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    requests.push(url);
    if (url !== '/api/access/session' || options?.method !== 'POST') throw new Error('Unexpected administrative request');
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer synthetic-access-token');
    return reply();
  }));
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined;
  document.body.innerHTML = ''; vi.unstubAllGlobals();
});
async function waitFor(check: () => void) {
  let failure: unknown;
  for (let i = 0; i < 100; i++) {
    try { check(); return; } catch (error: unknown) { failure = error; }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  throw failure;
}
async function mount(path: string) {
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  await act(async () => root?.render(<AuthProvider><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/admin/categorias" element={<RequireAuth><p>Categories writer</p></RequireAuth>} />
    <Route path="/admin/clientes/:id" element={<RequireAuth><p>Client detail writer</p></RequireAuth>} />
    <Route path="/admin/*" element={<RequireAuth><AdminPanel /></RequireAuth>} />
    <Route path="/login" element={<p>Login required</p>} />
  </Routes></MemoryRouter></AuthProvider>));
}

test('server admission selects all Firestore publications, keeps document IDs and images, and denies writes', async () => {
  const catalog = await readAdminCatalog();
  expect(catalog.readOnly).toBe(true);
  expect(catalog.products.map(product => [product.id, product.active])).toEqual([
    ['active-document', true], ['inactive-document', false],
  ]);
  expect(catalog.products[1].category.name).toBe('Juegos');
  expect(catalog.products[1].subcategory.name).toBe('Consolas');
  expect(catalog.products[1].images).toEqual(['https://example.invalid/catalog-image']);
  await expect(requireWritableCatalog()).rejects.toThrow('solamente ver');
  expect(sdk.reads).toEqual(['categories', 'categories/games/subcategories', 'products']);
  expect(requests).toEqual(['/api/access/session', '/api/access/session']);
});

test('inventory inconsistencies do not hide an inactive publication or enable general writes', async () => {
  sdk.inconsistentInventory = true;
  const catalog = await readAdminCatalog();
  expect(catalog.products[1].id).toBe('inactive-document');
  expect(catalog.products[1].active).toBe(false);
  expect(catalog.products[1].images).toEqual(['https://example.invalid/catalog-image']);
  await mount('/admin/productList');
  await waitFor(() => expect(document.body.textContent).toContain('Archivada'));
  expect(document.body.textContent).toContain('Inactiva');
  const labels = [...document.querySelectorAll('button')].map(button => button.textContent?.trim());
  for (const label of ['Crear producto', 'Activar', 'Desactivar', 'Eliminar']) expect(labels).not.toContain(label);
  expect(labels.filter(label => label === 'Abrir y editar')).toHaveLength(2);
  expect(labels).toContain('Crear publicación');
  await expect(requireWritableCatalog()).rejects.toThrow('solamente ver');
  expect(requests.every(path => path === '/api/access/session')).toBe(true);
});

test.each(['denied', 'expired', 'wrong-uid', 'non-admin', 'unknown-scope'] as const)(
  '%s admission stops before catalog reads', async failure => {
    reply = () => new Response(JSON.stringify({ ...admitted(),
      ...(failure === 'expired' ? { expiresAtMs: Date.now() - 1 } : {}),
      ...(failure === 'wrong-uid' ? { uid: 'another-user' } : {}),
      ...(failure === 'non-admin' ? { admin: false } : {}),
      ...(failure === 'unknown-scope' ? { scope: 'UNRECOGNIZED' } : {}),
    }), { status: failure === 'denied' ? 403 : 200 });
    await expect(readAdminCatalog()).rejects.toThrow(); expect(sdk.reads).toEqual([]);
  });

test('late identity change rejects actual catalog result instead of showing another session data', async () => {
  sdk.afterProductRead = () => { sdk.currentUser = { ...sdk.user, uid: 'changed-user' }; };
  await expect(readAdminCatalog()).rejects.toThrow('acceso actual');
});

test('failed server-only Firestore read is visible and never falls back to Admin API', async () => {
  sdk.failRead = true;
  await mount('/admin/productList');
  await waitFor(() => expect(document.body.textContent).toContain('No se pudieron cargar las publicaciones'));
  expect(document.body.textContent).not.toContain('Archivada');
  expect(requests.every(path => path === '/api/access/session')).toBe(true);
});

test.each(['/admin/productList', '/admin/productForm', '/admin/editar/synthetic', '/admin/categorias', '/admin/clientes/synthetic'])(
  'John route %s shows catalog with scoped editing without mounting a general writer', async path => {
    await mount(path);
    await waitFor(() => expect(document.body.textContent).toContain('Archivada'));
    const labels = [...document.querySelectorAll('button')].map(button => button.textContent?.trim());
    for (const label of ['Crear Publicaciones', 'Crear producto', 'Activar', 'Desactivar', 'Eliminar']) expect(labels).not.toContain(label);
    expect(labels.filter(label => label === 'Abrir y editar')).toHaveLength(2);
    expect(labels).toContain('Crear publicación');
    expect(document.body.textContent).not.toContain('writer');
    expect(document.body.textContent).toContain('Las compras siguen cerradas');
    expect(document.querySelectorAll('ul img')).toHaveLength(2);
    expect(requests.every(url => url === '/api/access/session')).toBe(true);
  });
