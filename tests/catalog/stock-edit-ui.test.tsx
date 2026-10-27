import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { parseEditRequest, requestHash } from '../../api/_lib/catalog-edit-policy';
import type { CatalogEditChanges, CatalogEditDocument, JsonObject, JsonValue } from '../../src/domain/catalogEdit';

const sdk = vi.hoisted(() => ({ user: { uid: 'john-synthetic', getIdToken: async () => 'synthetic-token' } }));
vi.mock('../../src/firebase', () => ({ auth: { get currentUser() { return sdk.user; } } }));
// Authentication is the synthetic boundary; actual editor, client, delta policy,
// operation persistence, receipt hash and exact readback remain under test.
vi.mock('../../src/utils/credentialAccess', () => ({ ensureCredentialSession: async () => ({ uid: sdk.user.uid,
  scope: 'JOHN_ADMIN_CLOSED_V1', admin: true, superadmin: false, expiresAtMs: Date.now() + 60000 }) }));
import ScopedCatalogEditor from '../../src/components/admin/ScopedCatalogEditor';
import { openCatalogEdit, saveCatalogEdit, type CatalogEditOpen } from '../../src/utils/catalogEditClient';

const options = (stock: JsonValue): JsonValue[] => [{ label: { es: 'Modelo', en: 'Model', pt: 'Legado' }, unknown: true,
  options: [{ value: 'Única', priceUSD: 125, stock, variantId: 'stable', unknown: null }] }];
const raw = (): JsonObject => ({ active: false, title: { es: 'Original', en: 'Saved title', pt: 'Legado' }, priceUSD: 125,
  description: { es: '<p>Descripción original.</p>', en: '<p>Saved description.</p>', pt: '<p>Legado.</p>' },
  stockTotal: 9, variants: options(5), images: ['https://example.invalid/image'], webCatalogVersion: 'legacy-marker',
  webReservations: { synthetic_reservation_01: { expiresAt: 1, lines: [{ slot: '0:0', identity: '["Modelo","Model","Única","stable"]', quantity: 3 }] } },
  unknown: { preserved: null } });
let root: ReturnType<typeof createRoot> | undefined;
let product: JsonObject, nextProduct: JsonObject, version: string, expectedChanges: CatalogEditChanges;
let requests: { method: string; url: string; body: unknown }[], receipt: Record<string, unknown> | null;
let saved: CatalogEditDocument | undefined, mode: 'ok' | 'lost-ack' | 'conflict';
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const patches = () => requests.filter(request => request.method === 'PATCH');
const pendingKey = () => `mutter-catalog-edit:${sdk.user.uid}:publication`;

beforeEach(() => {
  localStorage.clear(); sdk.user = { uid: 'john-synthetic', getIdToken: async () => 'synthetic-token' };
  product = raw(); nextProduct = { ...raw(), stockTotal: 8, variants: options(4) }; expectedChanges = { variants: options(4) };
  version = '100:1'; requests = []; receipt = null; saved = undefined; mode = 'ok';
  vi.stubGlobal('crypto', webcrypto); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET', body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, method, body });
    const parsed = new URL(url, 'https://local.invalid');
    expect(parsed.pathname).toBe('/api/catalog-edit'); expect(parsed.searchParams.get('id')).toBe('publication');
    if (method === 'PATCH') {
      if (mode === 'conflict') return response({ applied: false, error: 'La publicación cambió mientras la editabas.' }, 409);
      const edit = parseEditRequest(body); expect(edit.version).toBe('100:1'); expect(edit.changes).toEqual(expectedChanges);
      receipt = { status: 'CONFIRMED', id: 'publication', operationId: edit.operationId, version: '101:1',
        baseVersion: edit.version, changes: edit.changes, requestHash: requestHash('publication', edit) };
      // Independent literal expected product: do not calculate the fixture's
      // server result with the production applyCatalogChanges being checked.
      product = structuredClone(nextProduct); version = '101:1';
      if (mode === 'lost-ack') throw Error('Synthetic lost response after commit');
      return response(receipt);
    }
    if (parsed.searchParams.has('operationId')) return response(receipt);
    return response({ id: 'publication', version, product, capabilities: { editExisting: true } });
  }));
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ''; localStorage.clear(); vi.unstubAllGlobals();
});
async function mount(initial?: CatalogEditOpen) {
  const opened = initial ?? await openCatalogEdit('publication');
  if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); }
  await act(async () => root?.render(<ScopedCatalogEditor key={`${opened.document.version}:${opened.pending}`} mode="scoped" initial={opened} categories={[]}
    onSave={async (document, changes, imageIds) => { saved = await saveCatalogEdit(document, changes, imageIds); }} onReopen={async () => {}} onClose={() => {}} />));
}
function stock(name = 'Stock variante 1 opción 1'): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
  if (!input) throw Error('Missing stock input ' + name); return input;
}
function button(text: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === text);
  if (!result) throw Error('Missing button ' + text); return result;
}
async function write(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function until(check: () => void) {
  let last: unknown;
  for (let count = 0; count < 80; count++) {
    try { check(); return; } catch (error: unknown) { last = error; }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  throw last;
}

test.each(['john-synthetic', 'rodrigo-synthetic'])('%s saves and reopens real option stock client with historical total offset and full preservation', async uid => {
  sdk.user = { uid, getIdToken: async () => 'synthetic-token' }; await mount();
  expect(document.body.textContent).not.toContain('en inglés');
  expect(document.querySelectorAll('[role="textbox"][aria-label="Descripción"]')).toHaveLength(1);
  expect(document.body.textContent).toContain('Reservadas: 3. Disponibles de esta opción: 2.');
  expect(document.body.textContent).toContain('El total registrado difiere de la suma de las opciones. Esa diferencia se conserva al guardar.');
  expect(document.querySelector('output[aria-label="Stock total"]')?.textContent).toBe('9');
  expect(document.querySelector('input[aria-label="Stock total"]')).toBeNull();
  await write(stock(), '4'); expect(document.querySelector('output[aria-label="Stock total"]')?.textContent).toBe('8');
  await act(async () => button('Guardar cambios').click()); await until(() => expect(saved).toBeDefined());
  expect(saved?.product).toEqual({ ...raw(), stockTotal: 8, variants: options(4) }); expect(patches()).toHaveLength(1);
  expect(localStorage.getItem(pendingKey())).toBeNull(); await mount();
  expect(stock().value).toBe('4'); expect(document.querySelector('output[aria-label="Stock total"]')?.textContent).toBe('8');
  expect(document.body.textContent).toContain('Inactiva'); expect(document.body.textContent).toContain('Las compras siguen cerradas.');
});

test('base physical quantity is editable and round trips without adding variants or changing active state', async () => {
  product = { active: true, stockTotal: 5, unknown: { keep: true }, webReservations: { synthetic_reservation_01: { expiresAt: 1,
    lines: [{ slot: 'base', identity: 'base', quantity: 2 }] } } };
  nextProduct = { ...product, stockTotal: 3 }; expectedChanges = { stockTotal: 3 }; await mount();
  expect(document.body.textContent).toContain('Reservadas: 2. Disponibles: 3.'); await write(stock('Stock total'), '3');
  await act(async () => button('Guardar cambios').click()); await until(() => expect(saved).toBeDefined());
  expect(saved?.product).toEqual(nextProduct); expect(patches()).toHaveLength(1); expect(document.body.textContent).toContain('Activa');
});

test.each(['2', '-1', '1.5', ''])('editor rejects option stock %j before saving, keeping the original publication', async value => {
  await mount(); await write(stock(), value); await act(async () => button('Guardar cambios').click());
  expect(patches()).toHaveLength(0); expect(saved).toBeUndefined(); expect(product).toEqual(raw());
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
});

test('lost ACK freezes quantity; explicit check reads the same receipt and exact derived total without another PATCH', async () => {
  await mount(); await write(stock(), '4'); mode = 'lost-ack';
  await act(async () => button('Guardar cambios').click()); await until(() => expect(button('Comprobar guardado')).toBeTruthy());
  expect(stock().disabled).toBe(true); expect(patches()).toHaveLength(1); expect(localStorage.getItem(pendingKey())).not.toBeNull();
  mode = 'ok'; await act(async () => button('Comprobar guardado').click()); await until(() => expect(saved).toBeDefined());
  expect(patches()).toHaveLength(1); expect(requests.filter(item => item.url.includes('operationId='))).toHaveLength(1);
  expect(saved?.product.stockTotal).toBe(8); expect(localStorage.getItem(pendingKey())).toBeNull();
});

test('a readback that silently normalized the legacy total cannot be accepted as saved', async () => {
  nextProduct = { ...raw(), stockTotal: 4, variants: options(4) }; await mount(); await write(stock(), '4');
  await act(async () => button('Guardar cambios').click()); await until(() => expect(document.body.textContent).toContain('relectura no coincide'));
  expect(saved).toBeUndefined(); expect(stock().disabled).toBe(true); expect(patches()).toHaveLength(1);
  expect(localStorage.getItem(pendingKey())).not.toBeNull();
});

test('untouched malformed legacy stock is visible and remains byte-identical on a descriptive save', async () => {
  product = { ...raw(), stockTotal: 'legacy-total', variants: options(-1), webReservations: { legacy: true } };
  nextProduct = { ...product, title: { es: 'Edited', en: 'Saved title', pt: 'Legado' } }; expectedChanges = { title: { es: 'Edited' } }; await mount();
  expect(stock().value).toBe('-1'); expect(stock().getAttribute('aria-invalid')).toBe('true');
  expect(document.body.textContent).toContain('Cantidad no válida: -1');
  expect(document.body.textContent).not.toContain('El total registrado difiere');
  const title = [...document.querySelectorAll('label')].find(item => item.textContent === 'Título')?.querySelector('input');
  if (!title) throw Error('Missing title'); await write(title, 'Edited');
  await act(async () => button('Guardar cambios').click()); await until(() => expect(saved).toBeDefined());
  expect(saved?.product).toEqual(nextProduct); expect(patches()).toHaveLength(1);
});

test('a real consistent option total shows no historical-difference warning', async () => {
  product = { ...raw(), stockTotal: 5 }; await mount();
  expect(document.body.textContent).not.toContain('El total registrado difiere');
});
