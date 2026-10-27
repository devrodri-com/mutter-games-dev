import { test, expect, type Page } from '@playwright/test';
import { MIN_RECHECK_MS } from '../../api/_lib/reconciliation-policy';
import { origin, record, installLocalTransport, identity, signOutCurrent, resetProvider, providerState, approveWithoutReturn,
  createProduct, cart, order, assertInventory, assertNoProfile, closePurchases, assertNoOrderAndUnchangedPublication, makeDue, reconcileWithoutBrowser, dispose,
  type Identity, type Preference, type ProductFixture, type Traffic } from './guest-checkout-fixtures';

const shipping = { name: 'Invitado Sintético', address: 'Calle de Prueba 123', apartment: 'Apartamento 4B',
  city: 'Montevideo', department: 'Montevideo', postalCode: '11900', phone: '099000000', email: 'guest-checkout@example.invalid' };
let fixture: ProductFixture;
let traffic: Traffic;
test.beforeEach(async ({ page, context }) => {
  traffic = await installLocalTransport(context);
  expect([390, 1440]).toContain(page.viewportSize()?.width);
});
test.afterAll(dispose);
async function setup(request: Parameters<typeof resetProvider>[0], dropStartResponse = false) {
  await resetProvider(request, dropStartResponse);
  fixture = await createProduct();
  traffic.dropStartExpected = dropStartResponse;
}

async function admittedIdentity(page: Page): Promise<Identity> {
  await expect.poll(async () => (await identity(page))?.scope).toBe('BUYER_POST_CUTOVER_V1');
  const value = await identity(page);
  if (!value) throw new Error('Expected real UI-admitted guest');
  expect(value).toMatchObject({ provider: 'custom', admin: false, superadmin: false });
  return value;
}
async function addThree(page: Page): Promise<string> {
  await page.goto(`${origin}/producto/${fixture.product.slug}`);
  await expect(page.getByRole('heading', { name: fixture.product.title.es, exact: true })).toBeVisible();
  expect(await identity(page)).toBeNull();
  expect(traffic.signups).toBe(0);
  await expect(page.getByRole('button', { name: 'Agregar al carrito', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Empezar compra como invitado', exact: true }).click();
  const guest = await admittedIdentity(page);
  expect(traffic.signups).toBe(1);
  await expect(page.getByRole('button', { name: 'Agregar al carrito', exact: true })).toBeEnabled();
  // The quantity control's visible label is real UI; no cart cache is injected.
  const quantity = page.locator('label').filter({ hasText: /^Cantidad$/ }).locator('..');
  await quantity.getByRole('button').nth(1).click();
  await quantity.getByRole('button').nth(1).click();
  await expect(quantity.getByText('3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar al carrito', exact: true }).click();
  await expect.poll(() => cart(guest.uid)).toMatchObject([{ id: fixture.id, quantity: 3 }]);
  await page.goto(`${origin}/carrito`);
  await expect(page.getByRole('heading', { name: 'Tu carrito', exact: true })).toBeVisible();
  await expect(page.getByText(fixture.product.title.es, { exact: true })).toBeVisible();
  return guest.uid;
}
function addressInput(page: Page) {
  return page.locator('label').filter({ hasText: /^Dirección$/ }).locator('..').getByRole('textbox');
}
async function fillShipping(page: Page) {
  await page.getByPlaceholder('Nombre completo', { exact: true }).fill(shipping.name);
  await addressInput(page).fill(shipping.address);
  await page.getByPlaceholder(/Apartamento, piso/).fill(shipping.apartment);
  await page.getByPlaceholder('Correo electrónico', { exact: true }).fill(shipping.email);
  await page.getByPlaceholder('Teléfono', { exact: true }).fill(shipping.phone);
  await page.getByPlaceholder('Ciudad o Barrio', { exact: true }).fill(shipping.city);
  await page.getByRole('button', { name: 'Seleccioná un departamento', exact: true }).click();
  await page.getByRole('option', { name: shipping.department, exact: true }).click();
  await page.getByPlaceholder('Código postal', { exact: true }).fill(shipping.postalCode);
  await expect(page.locator('input[value="Uruguay"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /registrar|crear cuenta/i })).toHaveCount(0);
}
async function shippingSurvivesReload(page: Page, uid: string) {
  // Observe the production persistence write before closing this render.
  await expect.poll(() => page.evaluate(() => {
    const value: unknown = JSON.parse(localStorage.getItem('shippingData') ?? '{}');
    return value && typeof value === 'object' && 'address2' in value ? value.address2 : null;
  })).toBe(shipping.apartment);
  await page.reload();
  expect((await admittedIdentity(page)).uid).toBe(uid);
  await expect(page.getByPlaceholder('Nombre completo', { exact: true })).toHaveValue(shipping.name);
  await expect(addressInput(page)).toHaveValue(shipping.address);
  await expect(page.getByPlaceholder(/Apartamento, piso/)).toHaveValue(shipping.apartment);
  await expect(page.getByPlaceholder('Correo electrónico', { exact: true })).toHaveValue(shipping.email);
  await expect(page.getByPlaceholder('Teléfono', { exact: true })).toHaveValue(shipping.phone);
  await expect(page.getByPlaceholder('Ciudad o Barrio', { exact: true })).toHaveValue(shipping.city);
  await expect(page.getByRole('button', { name: shipping.department, exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Código postal', { exact: true })).toHaveValue(shipping.postalCode);
}
async function review(page: Page) {
  await page.getByRole('button', { name: 'Revisar compra', exact: true }).click();
  await expect(page.getByText(/Total verificado:.*UYU/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar y pagar', exact: true })).toBeEnabled();
}
async function providerPreference(page: Page, request: Parameters<typeof providerState>[0]): Promise<Preference> {
  await expect(page).toHaveURL(/^https:\/\/www\.mercadopago\.com\.uy\/checkout\/synthetic-[1-9][0-9]*$/);
  await expect(page.getByRole('button', { name: 'Pagar prueba', exact: true })).toBeVisible();
  const state = await providerState(request);
  expect(state.posts).toBe(1);
  expect(state.preferences).toHaveLength(1);
  return state.preferences[0];
}
async function assertApproved(page: Page, preference: Preference, uid: string) {
  await expect(page.getByRole('heading', { name: '¡Pago confirmado!', exact: true })).toBeVisible();
  expect((await admittedIdentity(page)).uid).toBe(uid);
  const data = await assertInventory(fixture, preference.orderId, uid, 'committed');
  expect(data.paymentStatus).toBe('approved');
  const shippingRecord = data.shipping;
  expect(shippingRecord).toMatchObject({ country: 'UY', city: shipping.city, email: shipping.email,
    address: `${shipping.address}, ${shipping.apartment}` });
  await assertNoProfile(uid, shipping.email);
}
async function approvedReturn(page: Page, preference: Preference, uid: string) {
  await page.getByRole('button', { name: 'Pagar prueba', exact: true }).click();
  await assertApproved(page, preference, uid);
}

test('explicit guest pays for three units, keeps UY apartment after reload and commits stock exactly once', async ({ page, request }, testInfo) => {
  await setup(request);
  const uid = await addThree(page);
  await fillShipping(page);
  await shippingSurvivesReload(page, uid);
  await page.screenshot({ path: testInfo.outputPath('guest-cart-uy.png'), fullPage: true });
  await review(page);
  await page.getByRole('button', { name: 'Confirmar y pagar', exact: true }).click();
  const preference = await providerPreference(page, request);
  await assertInventory(fixture, preference.orderId, uid, 'reserved');
  await approvedReturn(page, preference, uid);
  await page.screenshot({ path: testInfo.outputPath('guest-payment-confirmed.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: '¡Pago confirmado!', exact: true })).toBeVisible();
  expect((await admittedIdentity(page)).uid).toBe(uid);
  await assertInventory(fixture, preference.orderId, uid, 'committed');
  expect((await providerState(request)).posts).toBe(1);
  expect(traffic.actions.filter(row => row.action === 'start')).toHaveLength(1);
});

test('return without an SDK user shows a settled message and never claims or submits payment confirmation', async ({ page, request }) => {
  await setup(request);
  const uid = await addThree(page);
  await fillShipping(page); await review(page);
  await page.getByRole('button', { name: 'Confirmar y pagar', exact: true }).click();
  const preference = await providerPreference(page, request);
  await approveWithoutReturn(request, preference);
  await page.goto(`${origin}/carrito`);
  expect((await admittedIdentity(page)).uid).toBe(uid);
  await signOutCurrent(page);
  const confirmations = traffic.actions.filter(row => row.action === 'verify' || row.action === 'status').length;
  const target = new URL(preference.returnUrl); target.searchParams.set('payment_id', preference.paymentId);
  await page.goto(target.href);
  await expect(page.getByRole('alert')).toContainText(/sesión|ingres|cuenta|verific/i);
  await expect(page.getByRole('heading', { name: 'Verificando tu pago…', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '¡Pago confirmado!', exact: true })).toHaveCount(0);
  expect(await identity(page)).toBeNull();
  expect(traffic.actions.filter(row => row.action === 'verify' || row.action === 'status')).toHaveLength(confirmations);
  await assertInventory(fixture, preference.orderId, uid, 'reserved');
  await assertNoProfile(uid, shipping.email);
});

test('approved payment reconciles without any browser return or client stock write', async ({ page, request }) => {
  await setup(request);
  const uid = await addThree(page);
  await fillShipping(page); await review(page);
  await page.getByRole('button', { name: 'Confirmar y pagar', exact: true }).click();
  const preference = await providerPreference(page, request);
  await assertInventory(fixture, preference.orderId, uid, 'reserved');
  expect(traffic.actions.some(row => row.action === 'verify')).toBe(false);
  await approveWithoutReturn(request, preference);
  await page.close();
  const before = (await providerState(request)).dispatchCounts['GET /api/internal/web-stock-reconcile'] ?? 0;
  await makeDue(preference.orderId);
  expect(await reconcileWithoutBrowser(request)).toMatchObject({ failed: 0 });
  await assertInventory(fixture, preference.orderId, uid, 'committed');
  await reconcileWithoutBrowser(request);
  await assertInventory(fixture, preference.orderId, uid, 'committed');
  await assertNoProfile(uid, shipping.email);
  const state = await providerState(request);
  expect(state.posts).toBe(1); expect(state.reads).toBeGreaterThan(0);
  expect(state.dispatchCounts['GET /api/internal/web-stock-reconcile'] - before).toBe(2);
});

test('closed purchase control rejects an actual start before any provider preference POST', async ({ page, request }) => {
  await setup(request);
  const uid = await addThree(page);
  await fillShipping(page); await review(page);
  await closePurchases();
  const denied = page.waitForResponse(response => response.url() === `${origin}/api/create-mp-preference`
    && response.request().method() === 'POST' && record(response.request().postDataJSON()).action === 'start');
  await page.getByRole('button', { name: 'Confirmar y pagar', exact: true }).click();
  const response = await denied;
  expect(response.status()).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'CUTOVER_CLOSED' });
  await expect(page.getByText(/temporalmente cerrada/)).toBeVisible();
  expect(await providerState(request)).toMatchObject({ preferences: [], posts: 0 });
  expect(traffic.actions.filter(row => row.action === 'start')).toHaveLength(1);
  await assertNoProfile(uid, shipping.email);
  await assertNoOrderAndUnchangedPublication(fixture, uid);
});

test('lost start response recovers the same owned preference without issuing another provider POST', async ({ page, request }) => {
  test.setTimeout(120_000);
  await setup(request, true);
  const uid = await addThree(page);
  await fillShipping(page); await review(page);
  await page.getByRole('button', { name: 'Confirmar y pagar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/intento.*verificación/i);
  expect(traffic.dropStartObserved).toBe(true);
  const lost = await providerState(request);
  expect(lost.posts).toBe(1); expect(lost.preferences).toHaveLength(1);
  const preference = lost.preferences[0];
  await assertInventory(fixture, preference.orderId, uid, 'reserved');
  await page.getByRole('button', { name: 'Confirmar y pagar', exact: true }).click();
  expect(await providerPreference(page, request)).toEqual(preference);
  await page.getByRole('button', { name: 'Pagar prueba', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu pago aún no está confirmado', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('La compra sigue en verificación. Conservamos su estado; no vuelvas a pagar.');
  await assertInventory(fixture, preference.orderId, uid, 'reserved');
  expect((await providerState(request)).posts).toBe(1);
  const lastAttemptAt = record((await order(preference.orderId)).reconciliation).lastAttemptAt;
  if (typeof lastAttemptAt !== 'number' || !Number.isSafeInteger(lastAttemptAt) || lastAttemptAt <= 0) {
    throw new Error('Expected real reconciliation attempt timestamp');
  }
  const deadline = lastAttemptAt + MIN_RECHECK_MS;
  expect(deadline).toBeGreaterThan(Date.now());
  // Observe real elapsed time only. Do not poll a server or alter clocks/records.
  await expect.poll(() => Date.now(), { timeout: 70_000, intervals: [1_000] }).toBeGreaterThanOrEqual(deadline);
  await page.getByRole('button', { name: 'Volver a verificar', exact: true }).click();
  await assertApproved(page, preference, uid);
  expect((await providerState(request)).posts).toBe(1);
  const starts = traffic.actions.filter(row => row.action === 'start');
  expect(starts).toHaveLength(1);
  expect(traffic.actions.filter(row => row.action === 'status')).toMatchObject([{ key: starts[0].key }]);
  expect((await order(preference.orderId)).uid).toBe(uid);
});
