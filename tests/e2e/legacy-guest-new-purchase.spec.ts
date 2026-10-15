import { test, expect, type Page, type Route } from '@playwright/test';
import { admittedAdministrator, admittedBuyer, auth, clientPath, cleanup, db, dispose, epoch, identity, item,
  localOnly, seedLegacy, signIn, trackCurrent, trackUid, unchanged, type Legacy } from './legacy-guest-fixtures';
import { chooseInitialGuestPurchase, initialGuestAction, initialGuestCopy } from './initial-guest-purchase';

const action = (page: Page) => page.getByRole('button', { name: 'Empezar compra nueva', exact: true });
async function confirmedNew(page: Page, oldUid: string) {
  await expect.poll(async () => {
    const result = await identity(page);
    return Boolean(result && result.uid !== oldUid && result.sessionId && !result.admin && !result.superadmin);
  }).toBe(true);
  const result = await identity(page); if (!result?.sessionId) throw Error('Expected actual admitted new guest');
  await trackCurrent(page);
  return result;
}
async function api(page: Page, body: Record<string, unknown>) {
  const result: unknown = await page.evaluate(async ({ path, value }) => (await import(path)).api(value), { path: clientPath, value: body });
  return apiResult(result);
}
function apiResult(result: unknown) {
  if (!result || typeof result !== 'object' || !('status' in result) || typeof result.status !== 'number'
    || !('body' in result) || !result.body || typeof result.body !== 'object' || Array.isArray(result.body)) throw Error('Expected actual API response');
  return { status: result.status, body: Object.fromEntries(Object.entries(result.body)) };
}
async function choice(page: Page, uid: string) {
  const result: unknown = await page.evaluate(async ({ path, uid: value }) => (await import(path)).newPurchaseChoice(value), { path: clientPath, uid });
  return apiResult(result);
}
async function session(page: Page) {
  const result: unknown = await page.evaluate(async path => (await import(path)).accessSession(), clientPath);
  return apiResult(result);
}
async function reserveNewPurchase(page: Page, uid: string) {
  await page.goto(`/producto/${item.slug}`);
  const add = page.getByRole('button', { name: 'Agregar al carrito', exact: true }); await expect(add).toBeEnabled(); await add.click();
  await expect(page.getByText('Agregado al carrito', { exact: true })).toBeVisible();
  await expect.poll(async () => (await db.doc(`carts/${uid}`).get()).data()?.cartItems?.length).toBe(1);
  const purchase = { items: [{ id: item.id, quantity: 1 }], shipping: { pickup: true, department: '', name: 'Nueva compra ficticia',
    address: '', city: '', postalCode: '', phone: '00000000', email: 'new@example.invalid' } };
  const quote = await api(page, { action: 'quote', purchase }); expect(quote.status).toBe(200);
  if (!quote.body.quote || typeof quote.body.quote !== 'object' || !('hash' in quote.body.quote)
    || typeof quote.body.quote.hash !== 'string') throw Error('Expected actual checkout quote');
  const start = await api(page, { action: 'start', purchase, quoteHash: quote.body.quote.hash, key: crypto.randomUUID() });
  expect(start.status).toBe(200); expect(start.body.init_point).toEqual(expect.stringContaining('synthetic-browser-'));
  if (typeof start.body.id !== 'string') throw Error('Expected new order id');
  const created = (await db.doc(`orders/${start.body.id}`).get()).data();
  expect(created?.uid).toBe(uid); expect(created?.inventory?.state).toBe('reserved');
  expect((await db.doc(`products/${item.id}`).get()).data()?.stockTotal).toBe(5);
  return start.body.id;
}
async function denied(page: Page, collection: string, id: string) {
  expect(await page.evaluate(async ({ path, collection: name, id: value }) => (await import(path)).privateRead(name, value),
    { path: clientPath, collection, id })).toEqual({ status: 'DENIED', code: 'permission-denied' });
}
function deferred() {
  let release = () => {};
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { wait, release };
}
function observeSignups(page: Page) {
  let signups = 0;
  page.on('request', request => { if (request.url().includes('/accounts:signUp?') && request.method() === 'POST') signups++; });
  return () => signups;
}
let currentLegacy: Legacy | undefined;
test.afterEach(async ({ page }) => {
  if (currentLegacy) await unchanged(currentLegacy);
  currentLegacy = undefined;
  await trackCurrent(page).catch((error: unknown) => {
    // A test may have closed its page after a held transport; no Auth cleanup
    // is inferred from that. All identities seeded or observed are still owned.
    if (!page.isClosed()) throw error;
  });
  await cleanup();
});
test.afterAll(async () => { await dispose(); });

test('first arrival with SDK null waits for an explicit guest decision across reload and another tab', async ({ page, context }, testInfo) => {
  // Model a first arrival only. No marker is seeded or SDK persistence erased;
  // this is not evidence that an emulator reproduced provider invalidation.
  await localOnly(page); const signups = observeSignups(page);
  await page.goto('/carrito');
  await expect(page.getByText(initialGuestCopy, { exact: true })).toBeVisible();
  expect(await identity(page)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('mutter-observed-identity:demo-mutter-r1'))).toBeNull();
  await expect(action(page)).toHaveCount(0); expect(signups()).toBe(0);
  const other = await context.newPage(); await localOnly(other); const otherSignups = observeSignups(other);
  try {
    await other.goto('/carrito');
    for (const tab of [page, other]) {
      await tab.reload(); await expect(tab.getByText(initialGuestCopy, { exact: true })).toBeVisible();
      await expect(initialGuestAction(tab)).toBeVisible(); await expect(action(tab)).toHaveCount(0);
      expect(await identity(tab)).toBeNull();
    }
    expect(signups() + otherSignups()).toBe(0);
    await initialGuestAction(page).focus(); await expect(initialGuestAction(page)).toBeFocused();
    const box = await initialGuestAction(page).boundingBox(), viewport = page.viewportSize();
    if (!box || !viewport) throw Error('Expected visible initial guest action');
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath('first-arrival-null-explicit-decision.png'), fullPage: true });
    await chooseInitialGuestPurchase(page);
    const created = await confirmedNew(page, ''), shared = await confirmedNew(other, '');
    expect(shared.uid).toBe(created.uid); expect(signups() + otherSignups()).toBe(1);
    expect((await db.doc(`credentialAccess/${created.uid}`).get()).data()).toMatchObject({ uid: created.uid,
      status: 'NATIVE_POST_CUTOVER', roles: { admin: false, superadmin: false } });
    for (const tab of [page, other]) {
      await expect(initialGuestAction(tab)).toHaveCount(0); await expect(action(tab)).toHaveCount(0);
      await expect(tab.getByRole('heading', { name: 'Tu carrito está vacío', exact: true })).toBeVisible();
    }
  } finally { await other.close(); }
});

test('legacy offer is explicit, readable and keyboard accessible; leaving it preserves account and documents', async ({ page }, testInfo) => {
  currentLegacy = await seedLegacy(page);
  const before = await identity(page), signups = observeSignups(page);
  const preservedLocal = await page.evaluate(uid => ({ cart: localStorage.getItem(`mutter-cart:${uid}`),
    shipping: localStorage.getItem('shippingData'), checkout: localStorage.getItem(`mutter-checkout:${uid}`),
    lastOrder: localStorage.getItem('lastOrderId'), unrelated: localStorage.getItem('unrelated-owner-storage') }), currentLegacy.uid);
  await expect(page.getByText('Podés empezar una compra nueva como invitado. El carrito y el historial anteriores no se trasladan. Si tenés una consulta sobre una compra anterior, contactá a Mutter.', { exact: true })).toBeVisible();
  await action(page).focus(); await expect(action(page)).toBeFocused();
  const box = await action(page).boundingBox(), viewport = page.viewportSize();
  if (!box || !viewport) throw Error('Expected visible action');
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({ path: testInfo.outputPath('legacy-new-purchase-offer.png'), fullPage: true });
  await page.getByRole('link', { name: 'Seguir viendo la tienda', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:5277/');
  expect((await identity(page))?.uid).toBe(before?.uid); expect(signups()).toBe(0);
  await page.goto('/shop'); await expect(page.getByRole('heading', { name: 'Productos disponibles', exact: true })).toBeVisible();
  expect((await identity(page))?.uid).toBe(before?.uid); expect(signups()).toBe(0);
  await page.goto('/login'); await expect(action(page)).toBeVisible();
  await expect(page.getByLabel('Correo electrónico', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a mi carrito', exact: true }).click(); await expect(action(page)).toBeVisible();
  expect((await identity(page))?.uid).toBe(currentLegacy.uid); expect(signups()).toBe(0);
  expect(await page.evaluate(uid => ({ cart: localStorage.getItem(`mutter-cart:${uid}`), shipping: localStorage.getItem('shippingData'),
    checkout: localStorage.getItem(`mutter-checkout:${uid}`), lastOrder: localStorage.getItem('lastOrderId'),
    unrelated: localStorage.getItem('unrelated-owner-storage') }), currentLegacy.uid)).toEqual(preservedLocal);
});

test('explicit new purchase uses another UID, empty state, real reservation and authorized historical Admin reads', async ({ page, browser }, testInfo) => {
  currentLegacy = await seedLegacy(page);
  const old = currentLegacy, signups = observeSignups(page);
  await action(page).focus(); await action(page).press('Enter');
  const next = await confirmedNew(page, old.uid);
  expect(signups()).toBe(1); expect(next.provider).toBe('custom'); expect(next.email).toBeNull();
  await expect(page.getByRole('heading', { name: 'Tu carrito está vacío', exact: true })).toBeVisible();
  await expect(action(page)).toHaveCount(0);
  const local = await page.evaluate(uid => ({ shipping: JSON.parse(localStorage.getItem('shippingData') ?? '{}'),
    cart: JSON.parse(localStorage.getItem(`mutter-cart:${uid}`) ?? '{}'), checkout: localStorage.getItem(`mutter-checkout:${uid}`),
    lastOrder: localStorage.getItem('lastOrderId'), unrelated: localStorage.getItem('unrelated-owner-storage') }), next.uid);
  expect(local.cart).toMatchObject({ items: [], dirty: false }); expect(local.checkout).toBeNull();
  expect(local.lastOrder).toBeNull();
  for (const field of ['name', 'address', 'email', 'phone']) expect(local.shipping[field]).toBe('');
  expect(local.unrelated).toBe('preserve-me');
  const account = (await db.doc(`credentialAccess/${next.uid}`).get()).data();
  expect(account).toMatchObject({ uid: next.uid, status: 'NATIVE_POST_CUTOVER', roles: { admin: false, superadmin: false } });
  expect((await auth.getUser(next.uid)).customClaims?.admin).not.toBe(true);
  for (const [collection, id] of [['carts', old.uid], ['orders', old.orderId], ['clients', old.uid], ['usuarios', old.uid]]) await denied(page, collection, id);
  expect((await api(page, { action: 'admin_order', orderId: old.orderId })).status).toBe(403);
  expect(await reserveNewPurchase(page, next.uid)).not.toBe(old.orderId);
  await unchanged(old);
  const administrator = await admittedAdministrator();
  const administrative = await browser.newContext();
  try {
    const adminPage = await administrative.newPage(); await localOnly(adminPage); await adminPage.goto('/carrito');
    await signIn(adminPage, administrator.customToken); await expect.poll(async () => (await identity(adminPage))?.admin).toBe(true);
    expect(await choice(adminPage, administrator.uid)).toEqual({ status: 200, body: { newPurchase: null } });
    const detail = await api(adminPage, { action: 'admin_order', orderId: old.orderId });
    expect(detail.status).toBe(200); expect(detail.body.order).toMatchObject({ id: old.orderId, historical: true });
    const list = await api(adminPage, { action: 'admin_orders', section: 'recent', limit: 20 });
    expect(list.status).toBe(200); expect(list.body.orders).toEqual(expect.arrayContaining([expect.objectContaining({ id: old.orderId })]));
    await expect(adminPage.getByRole('button', { name: 'Empezar compra nueva', exact: true })).toHaveCount(0);
    const buyer = await admittedBuyer();
    await signIn(adminPage, buyer.customToken); await expect.poll(async () => (await identity(adminPage))?.uid).toBe(buyer.uid);
    expect(await choice(adminPage, buyer.uid)).toEqual({ status: 200, body: { newPurchase: null } });
    expect(await identity(adminPage)).toMatchObject({ uid: buyer.uid, admin: false, superadmin: false });
    await expect(action(adminPage)).toHaveCount(0);
  } finally { await administrative.close(); }
  await page.goto('/carrito'); await page.screenshot({ path: testInfo.outputPath('new-guest-cart.png'), fullPage: true });
});

test('revoked legacy token and official startup loss preserve explicit public choice across reload and tabs', async ({ page, context }, testInfo) => {
  currentLegacy = await seedLegacy(page); const old = currentLegacy;
  const signups = observeSignups(page);
  const other = await context.newPage(); await localOnly(other); const otherSignups = observeSignups(other);
  await other.goto('/carrito'); await expect(action(other)).toBeVisible();
  expect((await identity(other))?.uid).toBe(old.uid);
  const pendingLocal = await page.evaluate(uid => ({ cart: localStorage.getItem(`mutter-cart:${uid}`),
    shipping: localStorage.getItem('shippingData'), checkout: localStorage.getItem(`mutter-checkout:${uid}`),
    lastOrder: localStorage.getItem('lastOrderId') }), old.uid);
  let authorizedSelector = false;
  page.on('request', request => {
    if (request.url().includes('/api/access/new-purchase-choice') && request.headers().authorization) authorizedSelector = true;
  });
  try {
    // Cross the Admin SDK's whole-second revocation boundary. Keep the real
    // emitted SDK token: no token claims or emulator responses are patched.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.floor(Date.now() / 1000) * 1000 + 1100 - Date.now())));
    await auth.revokeRefreshTokens(old.uid);
    expect(await session(page)).toMatchObject({ status: 401, body: { code: 'INVALID_SESSION' } });
    await expect(action(page)).toBeVisible(); expect((await identity(page))?.uid).toBe(old.uid);
    const oldSessions = await db.collection('credentialSessions').where('uid', '==', old.uid).get();
    expect(oldSessions.empty).toBe(true);
    expect(await choice(page, old.uid)).toEqual({ status: 200, body: { newPurchase: { kind: 'LEGACY_ANONYMOUS', uid: old.uid, epoch } } });
    expect((await db.collection('credentialSessions').where('uid', '==', old.uid).get()).empty).toBe(true);
    expect(await session(page)).toMatchObject({ status: 401, body: { code: 'INVALID_SESSION' } });
    await denied(page, 'orders', old.orderId); expect(signups() + otherSignups()).toBe(0);
    await unchanged(old);
    await page.screenshot({ path: testInfo.outputPath('revoked-token-independent-choice.png'), fullPage: true });

    // The official startup lookup rejects this real revoked token. Unlike the
    // emulator's refresh behavior, that path does clear the SDK's persisted
    // user. Observe its actual error, not a simulated response or signOut.
    const rejectedLookup = page.waitForResponse(response => response.url().includes('/accounts:lookup?') && response.status() === 400);
    await page.reload();
    const lookup = await rejectedLookup;
    expect(await lookup.json()).toMatchObject({ error: { code: 400, message: 'TOKEN_EXPIRED' } });
    await lookup.finished();
    for (const tab of [page, other]) await expect.poll(() => identity(tab)).toBeNull();
    for (const tab of [page, other]) {
      await tab.reload(); await expect(action(tab)).toBeVisible();
      expect(await identity(tab)).toBeNull();
    }
    expect(signups() + otherSignups()).toBe(0);
    expect(await page.evaluate(uid => ({ cart: localStorage.getItem(`mutter-cart:${uid}`),
      shipping: localStorage.getItem('shippingData'), checkout: localStorage.getItem(`mutter-checkout:${uid}`),
      lastOrder: localStorage.getItem('lastOrderId') }), old.uid)).toEqual(pendingLocal);
    await denied(page, 'orders', old.orderId); await unchanged(old);
    await page.screenshot({ path: testInfo.outputPath('revoked-startup-sdk-null-awaits-explicit-choice.png'), fullPage: true });
    await action(page).click(); const next = await confirmedNew(page, old.uid), shared = await confirmedNew(other, old.uid);
    expect(shared.uid).toBe(next.uid); expect(signups() + otherSignups()).toBe(1);
    expect(authorizedSelector).toBe(false);
    await expect(page.getByRole('heading', { name: 'Tu carrito está vacío', exact: true })).toBeVisible();
    await expect(other.getByRole('heading', { name: 'Tu carrito está vacío', exact: true })).toBeVisible();
    await denied(page, 'orders', old.orderId); expect(await reserveNewPurchase(page, next.uid)).not.toBe(old.orderId);
    await unchanged(old);
  } finally { await other.close(); }
});

test('new guest persists and reenters after capability inactivity without another signup or historical return', async ({ page }) => {
  currentLegacy = await seedLegacy(page);
  const old = currentLegacy, signups = observeSignups(page);
  await action(page).click(); const first = await confirmedNew(page, old.uid);
  await page.goto(`/producto/${item.slug}`); await page.getByRole('button', { name: 'Agregar al carrito', exact: true }).click();
  await expect.poll(async () => (await db.doc(`carts/${first.uid}`).get()).data()?.cartItems?.length).toBe(1);
  const saved = (await db.doc(`carts/${first.uid}`).get()).data();
  await page.evaluate(async path => (await import(path)).persistInIndexedDb(), clientPath);
  await page.reload();
  await expect.poll(async () => (await identity(page))?.uid).toBe(first.uid);
  await expect(page.getByRole('button', { name: 'Agregar al carrito', exact: true })).toBeEnabled();
  expect((await db.doc(`carts/${first.uid}`).get()).data()).toEqual(saved); expect(signups()).toBe(1);
  await db.doc(`credentialSessions/${first.sessionId}`).update({ expiresAtMs: Date.now() - 2 * 7 * 24 * 60 * 60 * 1000 - 1 });
  await page.evaluate(async path => (await import(path)).refresh(), clientPath);
  await page.goto('/carrito'); await page.reload();
  await expect.poll(async () => (await identity(page))?.sessionId).not.toBe(first.sessionId);
  const returned = await confirmedNew(page, old.uid); expect(returned.uid).toBe(first.uid); expect(signups()).toBe(1);
  expect((await db.doc(`carts/${first.uid}`).get()).data()).toEqual(saved);
  await expect(action(page)).toHaveCount(0); await denied(page, 'orders', old.orderId);
});

test('double action and two tabs create one new identity and preserve unrelated storage', async ({ page, context }) => {
  currentLegacy = await seedLegacy(page);
  const other = await context.newPage(); await localOnly(other); await other.goto('/carrito'); await expect(action(other)).toBeVisible();
  const signups = observeSignups(page), otherSignups = observeSignups(other);
  const held = deferred(), observed = deferred(); let intercepted = false;
  await context.route('**/accounts:signUp?*', async route => {
    if (intercepted) { await route.continue(); return; }
    intercepted = true; const response = await route.fetch(); observed.release(); await held.wait; await route.fulfill({ response });
  });
  try {
    await action(page).evaluate(button => { if (!(button instanceof HTMLButtonElement)) throw Error('Expected native button'); button.click(); button.click(); }); await observed.wait;
    const second = action(other); if (await second.isEnabled()) await second.click();
    await expect(page.getByRole('button', { name: /Preparando|Comprobando|Empezando/ })).toBeDisabled();
    held.release();
    const left = await confirmedNew(page, currentLegacy.uid), right = await confirmedNew(other, currentLegacy.uid);
    expect(left.uid).toBe(right.uid); expect(signups() + otherSignups()).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('unrelated-owner-storage'))).toBe('preserve-me');
    await expect(other.getByRole('heading', { name: 'Tu carrito está vacío', exact: true })).toBeVisible();
  } finally { held.release(); await other.close(); }
});

test('offline before the explicit check preserves the old identity and reports a retryable failure', async ({ page, context }, testInfo) => {
  currentLegacy = await seedLegacy(page);
  const signups = observeSignups(page), oldUid = currentLegacy.uid;
  // Load the readonly helper before taking the page offline. Fetching a new
  // test module while offline would test its loader instead of the app state.
  expect((await identity(page))?.uid).toBe(oldUid);
  await context.setOffline(true);
  try {
    await action(page).click();
    await expect(page.getByRole('region', { name: 'Compra nueva como invitado' }).getByRole('status')
      .filter({ hasText: /No pudimos|Intentá nuevamente|La sesión anterior/ })).toBeVisible();
    await expect(action(page)).toBeEnabled();
    expect((await identity(page))?.uid).toBe(oldUid); expect(signups()).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('offline-preserves-old-identity.png'), fullPage: true });
  } finally { await context.setOffline(false); }
  await action(page).click(); const result = await confirmedNew(page, oldUid); expect(result.uid).not.toBe(oldUid); expect(signups()).toBe(1);
});

test('a partial admission reuses the SDK-confirmed new UID on retry and never migrates the historical cart', async ({ page }) => {
  currentLegacy = await seedLegacy(page); const old = currentLegacy, signups = observeSignups(page);
  let failed = 0;
  await page.route('**/api/access/session', async route => {
    const response = await route.fetch();
    if (response.status() === 200) { failed++; await route.abort('failed'); return; }
    await route.fulfill({ response });
  });
  await action(page).click();
  await expect(page.getByRole('region', { name: 'Compra nueva como invitado' }).getByRole('status')
    .filter({ hasText: /No pudimos|Intentá nuevamente|La sesión anterior/ })).toBeVisible();
  await expect(action(page)).toBeEnabled();
  const partial = await identity(page); if (!partial || partial.uid === old.uid) throw Error('Expected SDK-confirmed distinct identity');
  await trackCurrent(page); expect(signups()).toBe(1); expect(failed).toBeGreaterThan(0);
  expect((await api(page, { action: 'quote', purchase: { items: [{ id: item.id, quantity: 1 }],
    shipping: { pickup: true, department: '', name: 'Compra parcial ficticia', address: '', city: '', postalCode: '',
      phone: '00000000', email: 'partial@example.invalid' } } })).status).toBe(403);
  await page.unroute('**/api/access/session');
  await action(page).click();
  const resumed = await confirmedNew(page, old.uid); expect(resumed.uid).toBe(partial.uid); expect(signups()).toBe(1);
  await expect(page.getByRole('heading', { name: 'Tu carrito está vacío', exact: true })).toBeVisible();
  await denied(page, 'carts', old.uid);
});

test('a delayed old public choice response cannot replace an independently signed-in registered administrator', async ({ page }) => {
  currentLegacy = await seedLegacy(page); const registered = await admittedAdministrator(), signups = observeSignups(page);
  const held = deferred(), observed = deferred(); let first = true;
  await page.route('**/api/access/new-purchase-choice', async route => {
    const response = await route.fetch();
    if (!first) { await route.fulfill({ response }); return; }
    first = false; observed.release(); await held.wait; await route.fulfill({ response });
  });
  try {
    const returned = page.waitForResponse(response => response.url().includes('/api/access/new-purchase-choice') && response.status() === 200);
    await action(page).click(); await observed.wait;
    await signIn(page, registered.customToken); held.release();
    await (await returned).finished(); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await expect.poll(async () => (await identity(page))?.uid).toBe(registered.uid);
    await expect.poll(async () => (await identity(page))?.admin).toBe(true);
    await expect(action(page)).toHaveCount(0); expect(signups()).toBe(0);
    expect((await api(page, { action: 'admin_order', orderId: currentLegacy.orderId })).status).toBe(200);
  } finally { held.release(); }
});

test('a delayed official anonymous signup response cannot overwrite a later registered login', async ({ page }) => {
  currentLegacy = await seedLegacy(page); const registered = await admittedAdministrator();
  await page.evaluate(async path => (await import(path)).watchAnonymousAbort(), clientPath);
  const held = deferred(), observed = deferred(); let first = true;
  const signupRoute = async (route: Route) => {
    if (!first) { await route.continue(); return; }
    first = false; const response = await route.fetch(); observed.release(); await held.wait; await route.fulfill({ response });
  };
  await page.route('**/accounts:signUp?*', signupRoute);
  try {
    const returned = page.waitForResponse(response => response.url().includes('/accounts:signUp?'));
    await action(page).click(); await observed.wait;
    await signIn(page, registered.customToken); held.release();
    await (await returned).finished();
    const rejected: unknown = await page.evaluate(async path => (await import(path)).waitAnonymousAbort(), clientPath);
    if (!rejected || typeof rejected !== 'object' || !('rejectedUid' in rejected) || typeof rejected.rejectedUid !== 'string') throw Error('Expected actual SDK middleware abort');
    trackUid(rejected.rejectedUid); expect(rejected.rejectedUid).not.toBe(registered.uid);
    await expect.poll(async () => (await identity(page))?.uid).toBe(registered.uid);
    await expect.poll(async () => (await identity(page))?.admin).toBe(true);
    await expect(action(page)).toHaveCount(0);
    expect((await api(page, { action: 'admin_order', orderId: currentLegacy.orderId })).status).toBe(200);
  } finally { held.release(); await page.evaluate(async path => (await import(path)).stopAnonymousAbort(), clientPath); }
});

test('a registered login in another tab survives the first tab delayed anonymous response', async ({ page, context }) => {
  currentLegacy = await seedLegacy(page); const registered = await admittedAdministrator();
  const other = await context.newPage(); await localOnly(other); await other.goto('/login'); await expect(action(other)).toBeVisible();
  await page.evaluate(async path => (await import(path)).watchAnonymousAbort(), clientPath);
  const held = deferred(), observed = deferred(); let first = true;
  await context.route('**/accounts:signUp?*', async route => {
    if (!first) { await route.continue(); return; }
    first = false; const response = await route.fetch(); observed.release(); await held.wait; await route.fulfill({ response });
  });
  try {
    const returned = page.waitForResponse(response => response.url().includes('/accounts:signUp?'));
    await action(page).click(); await observed.wait;
    await signIn(other, registered.customToken);
    await expect.poll(async () => (await identity(other))?.uid).toBe(registered.uid);
    await expect.poll(async () => (await identity(page))?.uid).toBe(registered.uid);
    await expect.poll(async () => (await identity(page))?.admin).toBe(true);
    held.release(); await (await returned).finished();
    const rejected: unknown = await page.evaluate(async path => (await import(path)).waitAnonymousAbort(), clientPath);
    if (!rejected || typeof rejected !== 'object' || !('rejectedUid' in rejected) || typeof rejected.rejectedUid !== 'string') throw Error('Expected actual cross-tab SDK middleware abort');
    trackUid(rejected.rejectedUid); expect(rejected.rejectedUid).not.toBe(registered.uid); expect(rejected.rejectedUid).not.toBe(currentLegacy.uid);
    for (const tab of [page, other]) {
      expect(await identity(tab)).toMatchObject({ uid: registered.uid, admin: true, superadmin: false, email: registered.email });
      await expect(action(tab)).toHaveCount(0);
      expect((await api(tab, { action: 'admin_order', orderId: currentLegacy.orderId })).status).toBe(200);
    }
  } finally {
    held.release(); await page.evaluate(async path => (await import(path)).stopAnonymousAbort(), clientPath); await other.close();
  }
});
