import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const authState = vi.hoisted(() => ({ user: { uid: 'synthetic-admin', getIdToken: async () => 'synthetic-token', getIdTokenResult: async () => ({ claims: { admin: true } }) } }));
vi.mock('../../src/firebase', () => ({ auth: { get currentUser() { return authState.user; } }, db: {} }));
vi.mock('../../src/firebaseUtils', () => ({ auth: { get currentUser() { return authState.user; } }, db: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: typeof authState.user) => void) => { callback(authState.user); return () => {}; } }));
// The retired direct-read boundary is retained only so this regression runs red
// against the original component: it receives the same payment/reservation facts.
vi.mock('firebase/firestore', () => ({
  collection: () => 'orders', query: () => 'orders', where: () => {}, orderBy: () => {}, limit: () => {},
  doc: () => {}, getDoc: () => {}, getDocs: () => {},
  onSnapshot: (_query: unknown, next: (snapshot: unknown) => void) => {
    next({ docs: [
      { id: 'paid', data: () => ({ status: 'En proceso', paymentStatus: 'approved', inventory: { state: 'committed' }, total: 4990, items: [], createdAt: 1000, shipping: { name: 'Paid', email: 'paid@example.invalid' } }) },
      { id: 'held', data: () => ({ status: 'En proceso', paymentStatus: 'pending', inventory: { state: 'reserved', expiresAt: 2000 }, total: 1290, items: [], createdAt: 1000, shipping: { name: 'Held', email: 'held@example.invalid' } }) },
    ] }); return () => {};
  },
}));
import OrderAdmin from '../../src/components/admin/OrderAdmin';
let root: ReturnType<typeof createRoot> | undefined;
const summary = (id: string, paymentStatus: string, inventoryState: string, attention: string | null = null) => ({
  id, historical: false, customer: { name: id, email: `${id}@example.invalid`, phone: '123' },
  createdAt: 1000, total: 100, currency: 'UYU', paymentStatus, inventoryState, reservedUntil: 2000,
  releasedAt: null, committedAt: null, lastVerifiedAt: 1000, nextCheckAt: null, attention,
  delivery: 'pickup',
});
const paid = summary('paid', 'approved', 'committed');
const held = summary('held', 'pending', 'reserved');
const missing = summary('missing', 'approved', 'released', 'approved_without_stock');
const duplicate = summary('duplicate', 'approved', 'committed', 'duplicate_approved_payment');
const review = summary('review', 'in_review', 'reserved', 'provider_verification_unavailable');
const released = { ...summary('released', 'expired', 'released'), releasedAt: 3000 };
const historical = { ...summary('old', 'historical_unverified', 'historical'), historical: true };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function mount() {
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  await act(async () => { root?.render(<OrderAdmin />); await new Promise(resolve => setTimeout(resolve, 20)); });
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals(); });

test('R1-5 distinguishes server payment and reservation states; no local approval or delete controls', async () => {
  const fetchMock = vi.fn(async () => response({ orders: [paid, held, missing, duplicate, historical, review, released], nextCursor: null }));
  vi.stubGlobal('fetch', fetchMock);
  await mount();
  expect(document.body.textContent).toContain('Pagada y stock descontado');
  expect(document.body.textContent).toContain('Reservada');
  expect(document.body.textContent).toContain('Pago aprobado sin unidad');
  expect(document.body.textContent).toContain('Pago duplicado');
  expect(document.body.textContent).toContain('Histórica no verificada');
  expect(document.body.textContent).toContain('En revisión');
  expect(document.body.textContent).toContain('Reserva liberada');
  expect(document.body.textContent).toContain('UYU');
  expect(document.querySelector('select')).toBeNull();
  expect([...document.querySelectorAll('button')].some(button => /Eliminar|Confirmar pago/.test(button.textContent ?? ''))).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('R1-5 permission denied is visible and not a successful empty history', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ code: 'FORBIDDEN', error: 'No tenés permisos para consultar pedidos.' }, 403)));
  await mount();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('No tenés permisos');
  expect(document.body.textContent).not.toContain('No hay pedidos');
});

test('R1-5 pagination failure retains current page and shows the error', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ orders: [paid], nextCursor: 'paid' }))
    .mockResolvedValueOnce(response({ code: 'UNAVAILABLE', error: 'No pudimos leer los pedidos.' }, 503));
  vi.stubGlobal('fetch', fetchMock);
  await mount();
  const next = [...document.querySelectorAll('button')].find(button => button.textContent === 'Cargar más pedidos');
  expect(next).toBeTruthy();
  await act(async () => { next?.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('No pudimos leer');
  expect(document.body.textContent).toContain('Pagada y stock descontado');
});

test('R1-5 detail reads current server facts, keeps reservation guidance and supports keyboard dismissal', async () => {
  const detail = { ...review, nextCheckAt: 6000, paymentDeadline: 2000, paymentId: null, lastVerificationFailedAt: 4000,
    shipping: { address: 'Dirección sintética', address2: '', city: 'Montevideo', department: 'Montevideo', postalCode: '' },
    shippingCost: 0, items: [{ title: 'Consola', variant: 'Color-Negro', quantity: 1, unitPrice: 100 }], itemsTruncated: false,
    reconciliation: { state: 'review', lastProgressAt: 4000, lastError: 'provider_verification_unavailable', coverageUntil: 8000 } };
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ orders: [review], nextCursor: null })).mockResolvedValueOnce(response({ order: detail }));
  vi.stubGlobal('fetch', fetchMock);
  await mount();
  const open = [...document.querySelectorAll('button')].find(button => button.textContent === 'Ver detalle');
  expect(open).toBeTruthy();
  open?.focus();
  await act(async () => { open?.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain('Próxima comprobación:');
  expect(dialog?.textContent).toContain('Las unidades de esta reserva siguen comprometidas');
  expect(dialog?.textContent).toContain('No se pudo consultar al proveedor');
  expect(dialog?.textContent).toContain('Consola');
  expect(dialog?.textContent).toContain('UYU 100.00');
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ body: JSON.stringify({ action: 'admin_order', orderId: 'review' }) });
  expect(document.activeElement?.textContent).toBe('Cerrar');
  await act(async () => { dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); });
  expect(document.activeElement?.textContent).toBe('Imprimir etiqueta');
  await act(async () => { dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(open);
});

test('R1-5 malformed detail stays an explicit error with retry, without fabricated stock or totals', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ orders: [paid], nextCursor: null })).mockResolvedValueOnce(response({ order: { id: 'paid' } }));
  vi.stubGlobal('fetch', fetchMock);
  await mount();
  const open = [...document.querySelectorAll('button')].find(button => button.textContent === 'Ver detalle');
  await act(async () => { open?.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.querySelector('[role="alert"]')?.textContent).toContain('Respuesta de pedidos inválida');
  expect(dialog?.textContent).toContain('Reintentar detalle');
  expect(dialog?.textContent).not.toContain('Total registrado:');
});
