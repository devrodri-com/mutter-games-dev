import { randomUUID } from 'node:crypto';
import { deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { initializeDemoAdmin } from '../catalog/demo-admin';
import { readInventory } from '../../api/_lib/inventory-transactions';

export const origin = 'https://muttergames.com';
export const localOrigin = 'http://127.0.0.1:5277';
const clientPath = '/tests/e2e/guest-checkout-client.ts';
const app = initializeDemoAdmin('guest-checkout-browser-observations');
const db = getFirestore(app);
const auth = getAuth(app);
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected synthetic test object');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Expected synthetic test identifier');
  return value;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Expected nonnegative test counter');
  return value;
}
export type Preference = { id: string; orderId: string; returnUrl: string; paymentId: string };
export type ProviderState = { preferences: Preference[]; posts: number; reads: number; dispatchCounts: Record<string, number> };
export async function providerState(request: APIRequestContext): Promise<ProviderState> {
  const response = await request.get(`${localOrigin}/__test/state`);
  expect(response.status()).toBe(200);
  const body = record(await response.json());
  if (!Array.isArray(body.preferences)) throw new Error('Expected synthetic preference ledger');
  return { preferences: body.preferences.map((value: unknown) => {
    const row = record(value), returnUrl = text(row.returnUrl), parsed = new URL(returnUrl);
    if (!['https://muttergames.com', 'https://www.muttergames.com'].includes(parsed.origin)
      || parsed.username || parsed.password) throw new Error('Unexpected synthetic payment return origin');
    return { id: text(row.id), orderId: text(row.orderId), returnUrl, paymentId: text(row.paymentId) };
  }), posts: count(body.posts), reads: count(body.reads),
  dispatchCounts: Object.fromEntries(Object.entries(record(body.dispatchCounts)).map(([key, value]) => [key, count(value)])) };
}
export async function resetProvider(request: APIRequestContext, dropStartResponse = false) {
  const response = await request.post(`${localOrigin}/__test/reset`, { data: { state: 'open', dropStartResponse } });
  expect(response.status()).toBe(200);
  expect(await providerState(request)).toMatchObject({ preferences: [], posts: 0, reads: 0 });
}
export async function approveWithoutReturn(request: APIRequestContext, preference: Preference) {
  const response = await request.post(`${localOrigin}/__test/payment`, { data: { orderId: preference.orderId, status: 'approved' } });
  expect(response.status()).toBe(200);
}
export type Traffic = { actions: { action: string; key: string | null }[]; signups: number; denied: string[];
  dropStartExpected: boolean; dropStartObserved: boolean };
export async function installLocalTransport(context: BrowserContext): Promise<Traffic> {
  const traffic: Traffic = { actions: [], signups: 0, denied: [], dropStartExpected: false, dropStartObserved: false };
  await context.grantPermissions(['local-network-access'], { origin: 'https://muttergames.com' });
  await context.grantPermissions(['local-network-access'], { origin: 'https://www.muttergames.com' });
  await context.routeWebSocket('**/*', ws => ws.close());
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (['https://muttergames.com', 'https://www.muttergames.com'].includes(url.origin)) {
      let action: string | null = null;
      if (url.pathname === '/api/create-mp-preference' && request.method() === 'POST') {
        const body = record(request.postDataJSON());
        action = text(body.action);
        traffic.actions.push({ action, key: typeof body.key === 'string' ? body.key : null });
      }
      // Preserve the canonical Host and the browser's original Origin while
      // fetching only the owned loopback transport. No provider request escapes.
      try {
        const response = await route.fetch({ url: `${localOrigin}${url.pathname}${url.search}`,
          headers: { ...await request.allHeaders(), host: url.host }, maxRedirects: 0, maxRetries: 0 });
        await route.fulfill({ response });
      } catch (error: unknown) {
        // The server's explicitly configured one-shot socket loss must reach
        // the real browser fetch as failure. All other bridge errors are fatal.
        if (action !== 'start' || !traffic.dropStartExpected || traffic.dropStartObserved) throw error;
        traffic.dropStartObserved = true;
        await route.abort('failed');
      }
      return;
    }
    if (url.origin === 'https://www.mercadopago.com.uy' && /^\/checkout\/synthetic-[1-9][0-9]*$/.test(url.pathname)) {
      const number = url.pathname.slice('/checkout/synthetic-'.length);
      // GET serves the owned provider page only. The visible form's POST marks
      // the synthetic payment approved; its HTML starts a new navigation to the
      // exact provider return URL so Playwright routes the canonical request.
      const response = await route.fetch({ url: `${localOrigin}/__test/provider/${number}`,
        method: request.method(), postData: request.postDataBuffer() ?? undefined,
        headers: { ...await request.allHeaders(), host: '127.0.0.1:5277' }, maxRedirects: 0, maxRetries: 0 });
      expect(response.status()).toBe(200);
      await route.fulfill({ response });
      return;
    }
    if (url.hostname === '127.0.0.1' && ['5277', '8188', '9198'].includes(url.port)) {
      if (url.port === '9198' && url.pathname.endsWith('/accounts:signUp')) traffic.signups++;
      await route.continue();
      return;
    }
    traffic.denied.push(`${url.origin}${url.pathname}`);
    await route.abort('blockedbyclient');
  });
  return traffic;
}
export type Identity = { uid: string; provider: string | null; scope: string | null; admin: boolean; superadmin: boolean };
export async function identity(page: Page): Promise<Identity | null> {
  const value: unknown = await page.evaluate(async path => (await import(path)).identity(), clientPath);
  if (value === null) return null;
  const row = record(value);
  if ((row.provider !== null && typeof row.provider !== 'string') || (row.scope !== null && typeof row.scope !== 'string')
    || typeof row.admin !== 'boolean' || typeof row.superadmin !== 'boolean') throw new Error('Expected observed demo SDK identity');
  return { uid: text(row.uid), provider: row.provider, scope: row.scope, admin: row.admin, superadmin: row.superadmin };
}
export async function signOutCurrent(page: Page) {
  await page.evaluate(async path => (await import(path)).signOutCurrent(), clientPath);
  expect(await identity(page)).toBeNull();
}
export async function createProduct() {
  const id = `guest-checkout-${randomUUID()}`;
  const product = { active: true, title: { es: 'Juego de prueba invitado UY', en: 'Synthetic guest game' }, priceUSD: 100,
    stockTotal: 5, slug: id, description: 'Prueba de pago local sin datos reales', category: { id: 'guest-games', name: 'Juegos' },
    subcategory: { id: 'guest-sub', name: 'Pruebas', categoryId: 'guest-games' }, variants: [], images: [] };
  await db.doc(`products/${id}`).set(product);
  return { id, product };
}
export type ProductFixture = Awaited<ReturnType<typeof createProduct>>;
export async function cart(uid: string): Promise<unknown> { return (await db.doc(`carts/${uid}`).get()).data()?.cartItems; }
export async function order(orderId: string) { return record((await db.doc(`orders/${orderId}`).get()).data()); }
export async function assertInventory(fixture: ProductFixture, orderId: string, uid: string, state: 'reserved' | 'committed') {
  const data = await order(orderId), inventory = readInventory(data.inventory);
  expect(data.uid).toBe(uid);
  expect(inventory.state).toBe(state);
  expect(inventory.lines).toMatchObject([{ productId: fixture.id, slot: 'base', quantity: 3 }]);
  const product = record((await db.doc(`products/${fixture.id}`).get()).data());
  expect(product.stockTotal).toBe(state === 'committed' ? 2 : 5);
  expect(product.active).toBe(true);
  const ordinary = Object.fromEntries(Object.entries(product).filter(([key]) => !['stockTotal', 'webReservations', 'webCatalogVersion', 'updatedAt'].includes(key)));
  const initial = Object.fromEntries(Object.entries(fixture.product).filter(([key]) => key !== 'stockTotal'));
  expect(ordinary).toEqual(initial);
  const holds = record(product.webReservations);
  if (state === 'committed') expect(holds).toEqual({});
  else expect(record(holds[inventory.reservationId]).lines).toMatchObject([{ slot: 'base', quantity: 3 }]);
  return data;
}
export async function assertNoProfile(uid: string, email: string) {
  const paths = [`clients/${uid}`, `clients/${email}`, `usuarios/${uid}`];
  for (const path of paths) expect((await db.doc(path).get()).exists).toBe(false);
  expect((await db.collection('clients').where('uid', '==', uid).get()).empty).toBe(true);
  const user = await auth.getUser(uid);
  expect(user.email).toBeUndefined();
  expect(user.providerData).toEqual([]);
}
export async function closePurchases() { await db.doc('operations/webStockCutover').update({ state: 'closed' }); }
export async function assertNoOrderAndUnchangedPublication(fixture: ProductFixture, uid: string) {
  expect((await db.collection('orders').where('uid', '==', uid).get()).empty).toBe(true);
  expect((await db.doc(`products/${fixture.id}`).get()).data()).toEqual(fixture.product);
}
export async function makeDue(orderId: string) {
  // Move only the owned local queue scheduling field. Do not change payment,
  // inventory expiry, reservation evidence, or the browser's clock.
  await db.doc(`orders/${orderId}`).update({ 'reconciliation.nextCheckAt': Date.now() - 1 });
}
export async function reconcileWithoutBrowser(request: APIRequestContext) {
  const response = await request.get(`${localOrigin}/api/internal/web-stock-reconcile`, {
    headers: { Authorization: 'Bearer synthetic-guest-cron-only' } });
  expect(response.status()).toBe(200);
  return record(await response.json());
}
export async function dispose() { await db.terminate(); await deleteApp(app); }
