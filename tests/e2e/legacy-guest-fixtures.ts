import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeDemoAdmin } from '../catalog/demo-admin';
import { mintCredentialSession } from '../../api/_lib/credential-session';
import type { CredentialAccount } from '../../api/_lib/credential-access-state';
import { beginInitialGuestPurchase } from './initial-guest-purchase';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8188'
  || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9198') throw Error('Exact owned loopback emulators required');
const app = initializeDemoAdmin('browser-legacy-guest-fixtures');
export const db = getFirestore(app);
export const auth = getAuth(app);
export const epoch = 'synthetic-browser-credential-epoch';
export const clientPath = '/tests/e2e/legacy-guest-client.ts';
const users = new Set<string>();
const documents = new Set<string>();
export const product = { active: true, title: { es: 'Juego transición invitado', en: 'Guest transition game' }, priceUSD: 100,
  stockTotal: 5, slug: 'guest-transition-synthetic', description: 'Prueba local', category: { id: 'guest-games', name: 'Games' },
  subcategory: { id: 'guest-sub', name: 'Sub', categoryId: 'guest-games' }, variants: [], images: [] };
export const item = { id: 'guest-transition-product', slug: product.slug, name: 'Selección histórica', title: product.title,
  priceUSD: 100, price: 100, quantity: 2, image: '' };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected demo object');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string { if (typeof value !== 'string') throw Error('Expected demo string'); return value; }
export type Identity = { uid: string; provider: string | null; email: string | null; admin: boolean; superadmin: boolean; sessionId: string | null };
export async function identity(page: Page): Promise<Identity | null> {
  const value: unknown = await page.evaluate(async path => (await import(path)).identity(), clientPath);
  if (value === null) return null;
  const source = record(value);
  if (typeof source.admin !== 'boolean' || typeof source.superadmin !== 'boolean'
    || (source.provider !== null && typeof source.provider !== 'string') || (source.email !== null && typeof source.email !== 'string')
    || (source.sessionId !== null && typeof source.sessionId !== 'string')) throw Error('Expected safe browser identity');
  return { uid: text(source.uid), provider: source.provider, email: source.email, admin: source.admin,
    superadmin: source.superadmin, sessionId: source.sessionId };
}
export async function signIn(page: Page, token: string) {
  return page.evaluate(async ({ path, token: value }) => (await import(path)).signIn(value), { path: clientPath, token });
}
export async function localOnly(page: Page) {
  // Continue through the remaining handlers so context-level timing probes can
  // hold real loopback responses. External destinations remain hard-aborted.
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.fallback() : route.abort());
}
async function save(path: string, value: Record<string, unknown>) { documents.add(path); await db.doc(path).set(value); }
export async function seedLegacy(page: Page) {
  await localOnly(page);
  await page.goto('/carrito');
  await beginInitialGuestPurchase(page);
  await expect.poll(async () => (await identity(page))?.sessionId).toBeTruthy();
  const initial = await identity(page); if (initial) users.add(initial.uid);
  const signed = await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signUp?key=synthetic', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  expect(signed.status).toBe(200);
  const uid = text(record(await signed.json()).localId); users.add(uid);
  const oldUser = await auth.getUser(uid);
  expect(oldUser.providerData).toEqual([]); expect(oldUser.email).toBeUndefined();
  // Admin's installed metadata parser exposes creationTime in whole seconds.
  // Bind the cutoff to that authoritative time and cross its second boundary
  // before the visitor can ask for a genuinely post-cutover signup.
  const cutoff = Date.parse(oldUser.metadata.creationTime);
  expect(Date.parse(oldUser.metadata.creationTime)).toBeLessThanOrEqual(cutoff);
  await db.doc('operations/credentialAccessCutover').set({ schema: 1, phase: 'ENFORCED', epoch, legacyCutoffMs: cutoff });
  const account: CredentialAccount = { schema: 1, uid, epoch, status: 'PENDING', recoveryEmail: null,
    channelStatus: 'UNVERIFIED', channelEvidenceSha256: null, roles: { admin: false, superadmin: false } };
  const orderId = `guest-transition-order-${randomUUID()}`;
  const cart = { cartItems: [{ ...item, historicalMarker: 'old-local-only' }] };
  const order = { uid, total: 7, status: 'Confirmado', createdAt: Timestamp.now(), items: [], historicalMarker: 'preserved-order' };
  await save(`credentialAccess/${uid}`, account);
  await save(`carts/${uid}`, cart); await save(`orders/${orderId}`, order);
  await save(`clients/${uid}`, { name: 'Historical synthetic customer', email: 'old@example.invalid' });
  await save(`usuarios/${uid}`, { retained: 'historical synthetic profile' });
  await db.doc(`products/${item.id}`).set(product);
  const paths = [`credentialAccess/${uid}`, `carts/${uid}`, `orders/${orderId}`, `clients/${uid}`, `usuarios/${uid}`];
  const before = await Promise.all(paths.map(path => db.doc(path).get()));
  await page.evaluate(({ uid: owner, value }) => {
    localStorage.setItem(`mutter-cart:${owner}`, JSON.stringify({ items: [value], dirty: true }));
    localStorage.setItem('shippingData', JSON.stringify({ name: 'Historical local name', address: 'Historical address',
      email: 'old@example.invalid', phone: '00000000' }));
    localStorage.setItem('cartItems', JSON.stringify([value]));
    localStorage.removeItem('mutter-cart-migrated');
    localStorage.setItem(`mutter-checkout:${owner}`, JSON.stringify({ key: 'historical-key-for-old-uid-only',
      content: 'historical-local-attempt', quoteHash: 'a'.repeat(64), receivedOrderId: 'historical-local-order' }));
    localStorage.setItem('lastOrderId', 'historical-local-order');
    localStorage.setItem('unrelated-owner-storage', 'preserve-me');
  }, { uid, value: item });
  await signIn(page, await auth.createCustomToken(uid));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Empezar compra nueva', exact: true })).toBeVisible();
  await new Promise(resolve => setTimeout(resolve, Math.max(0, cutoff + 1001 - Date.now())));
  return { uid, orderId, account, cart, order, paths, before, cutoff };
}
export type Legacy = Awaited<ReturnType<typeof seedLegacy>>;
export async function unchanged(legacy: Legacy) {
  const after = await Promise.all(legacy.paths.map(path => db.doc(path).get()));
  expect(after.map(value => ({ data: value.data(), updateTime: value.updateTime })))
    .toEqual(legacy.before.map(value => ({ data: value.data(), updateTime: value.updateTime })));
  expect((await auth.getUser(legacy.uid)).uid).toBe(legacy.uid);
}
async function admittedRegistered(admin: boolean) {
  const uid = `guest-transition-${admin ? 'admin' : 'buyer'}-${randomUUID()}`, email = `${uid}@example.invalid`;
  await auth.createUser({ uid, email, password: `Synthetic-only-${randomUUID()}` }); users.add(uid);
  const account: CredentialAccount = { schema: 1, uid, epoch, status: 'RECOVERED', recoveryEmail: email,
    channelStatus: 'INDEPENDENTLY_VERIFIED', channelEvidenceSha256: 'e'.repeat(64), roles: { admin, superadmin: false } };
  await save(`credentialAccess/${uid}`, account);
  const session = await mintCredentialSession(auth, db, account, 'RECOVERY_CHANNEL');
  if (!session.customToken) throw Error('Expected real issuer custom token');
  return { uid, email, customToken: session.customToken };
}
export const admittedAdministrator = () => admittedRegistered(true);
export const admittedBuyer = () => admittedRegistered(false);
export async function trackCurrent(page: Page) { const observed = await identity(page); if (observed) users.add(observed.uid); }
export function trackUid(uid: string) { if (!uid || uid.includes('/')) throw Error('Expected owned demo UID'); users.add(uid); }
export async function cleanup() {
  for (const uid of users) {
    const sessions = await db.collection('credentialSessions').where('uid', '==', uid).get();
    for (const value of sessions.docs) await value.ref.delete();
    await db.doc(`credentialAccess/${uid}`).delete(); await db.doc(`carts/${uid}`).delete();
    await auth.deleteUser(uid).catch((error: unknown) => { if (!error || typeof error !== 'object' || !('code' in error)
      || error.code !== 'auth/user-not-found') throw error; });
  }
  for (const path of documents) await db.doc(path).delete();
  users.clear(); documents.clear();
  await db.doc('operations/credentialAccessCutover').set({ schema: 1, phase: 'ENFORCED', epoch, legacyCutoffMs: 1 });
}
export async function dispose() { await cleanup(); await db.terminate(); await deleteApp(app); }
