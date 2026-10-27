// @vitest-environment node
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectFirestoreEmulator, disableNetwork, enableNetwork, getFirestore, doc, setDoc } from 'firebase/firestore';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';

const fixture = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof getFirestore> | undefined,
  user: { uid: 'selective-reader', getIdToken: async () => 'synthetic-session-token' },
}));
vi.mock('../../src/firebase', () => ({ get db() { return fixture.db; }, auth: { get currentUser() { return fixture.user; } } }));
vi.mock('../../src/firebaseUtils', () => ({ get db() { return fixture.db; } }));
const { readAdminCatalog } = await import('../../src/firebase/adminCatalogRead');
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) throw new Error('Explicit loopback emulator required');
const port = Number(host.split(':')[1]);
const projectId = 'demo-mutter-selective-access';
const app = initializeApp({ projectId, apiKey: 'synthetic' }, 'selective-access-reader');
fixture.db = getFirestore(app); connectFirestoreEmulator(fixture.db, '127.0.0.1', port);
let environment: RulesTestEnvironment;
const requests: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port,
    rules: readFileSync('firebase.catalog-r1b.rules', 'utf8') } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('categories/games').set({ name: 'Juegos' });
    await context.firestore().doc('categories/games/subcategories/sub').set({ name: 'Consolas' });
    for (const active of [true, false]) await context.firestore().doc(`products/${active ? 'active' : 'inactive'}`).set({
      id: 'embedded-id-is-not-authority', title: { es: active ? 'Publicada' : 'Archivada', en: '' },
      active, images: ['https://example.invalid/image'], category: 'games', subcategory: 'sub',
      stockTotal: 1, priceUSD: 10, variants: [],
      ...(!active ? { webReservations: { invalid: { quantity: -5 } },
        variants: [{ options: [{ priceUSD: 'invalid', stock: -8 }] }] } : {}),
    });
  });
  vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/access/session') {
      requests.push(url); expect(options?.method).toBe('POST');
      return new Response(JSON.stringify({ status: 'ACTIVE', uid: fixture.user.uid,
        admin: true, superadmin: false, scope: 'JOHN_ADMIN_CLOSED_V1', expiresAtMs: Date.now() + 60000 }));
    }
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) throw new Error('Non-loopback request forbidden');
    return realFetch(input, options);
  });
});
afterEach(async () => { if (fixture.db) await enableNetwork(fixture.db); });
afterAll(async () => { vi.unstubAllGlobals(); await deleteApp(app); await environment?.cleanup(); });

test('real Firestore query keeps active/inactive publications including inconsistent inventory, with original normalization and IDs', async () => {
  const result = await readAdminCatalog();
  expect(result.readOnly).toBe(true);
  expect(result.products.map(product => [product.id, product.active])).toEqual([['active', true], ['inactive', false]]);
  expect(result.products[1].category).toEqual({ id: 'games', name: 'Juegos' });
  expect(result.products[1].subcategory.name).toBe('Consolas');
  expect(result.products[1].images).toEqual(['https://example.invalid/image']);
  expect(result.products[1].priceUSD).toBe(10);
  expect(requests.every(url => url === '/api/access/session')).toBe(true);
});

test('server-only read rejects offline cache and the unchanged rules continue to deny catalog writes', async () => {
  const db = fixture.db; if (!db) throw new Error('Test database unavailable');
  await expect(setDoc(doc(db, 'products', 'forbidden-write'), { active: true })).rejects.toThrow();
  await disableNetwork(db);
  await expect(readAdminCatalog()).rejects.toThrow();
});
