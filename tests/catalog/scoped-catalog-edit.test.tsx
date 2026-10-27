import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { parseEditRequest, requestHash } from '../../api/_lib/catalog-edit-policy';
import { applyCatalogChanges, changedFields, isObject, parseChanges, type JsonObject, type CatalogEditChanges } from '../../src/domain/catalogEdit';

const sdk = vi.hoisted(() => {
  const user = { uid: 'john-synthetic', getIdToken: async () => 'synthetic-token' };
  return { currentUser: user, exchange: false, beforeToken: undefined as undefined | (() => void),
    listener: undefined as undefined | ((next: typeof user) => void) };
});
vi.mock('../../src/firebase', () => ({ auth: { get currentUser() { return sdk.currentUser; } }, db: {} }));
vi.mock('../../src/firebaseUtils', () => ({ db: {} }));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ user: sdk.currentUser, credentialScope: 'JOHN_ADMIN_CLOSED_V1' }) }));
vi.mock('firebase/auth', () => ({
  beforeAuthStateChanged: (_auth: unknown, listener: typeof sdk.listener) => { sdk.listener = listener; return () => { sdk.listener = undefined; }; },
  signInWithCustomToken: async () => {
    const next = { ...sdk.currentUser }; sdk.listener?.(next); sdk.currentUser = next; sdk.exchange = false;
    return { user: next };
  },
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocs: async (path: string) => ({ docs: [{ id: path === 'categories' ? 'cat' : 'sub', data: () => ({ name: path === 'categories' ? 'Category' : 'Sub' }) }] }),
  getDocsFromServer: async () => ({ docs: [{ id: 'publication', data: () => raw() }] }),
  doc: vi.fn(), addDoc: () => { throw Error('Forbidden direct write'); }, deleteDoc: () => { throw Error('Forbidden delete'); },
}));
import { CatalogEditPendingError, CatalogEditSupersededError, openCatalogEdit, saveCatalogEdit, reopenSupersededCatalogEdit } from '../../src/utils/catalogEditClient';
import ProductList from '../../src/components/admin/ProductList';

function raw(): JsonObject {
  return { id: 'legacy-id', version: null, active: false, title: { es: 'Original', pt: 'Legado' },
    description: null, category: { id: 'cat', name: 'Category', legacy: true },
    subcategory: { id: 'sub', name: 'Sub', categoryId: 'cat' }, images: ['https://example.invalid/image'],
    priceUSD: 100, stockTotal: 2, variants: [{ options: [{ stock: -1 }] }], webReservations: { legacy: true },
    extraUnknown: { preserved: null } };
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let product: JsonObject, version: string, receipt: Record<string, unknown> | null;
let requests: { method: string; url: string; body?: unknown }[], mode: string;
let root: ReturnType<typeof createRoot> | undefined;
let mutateReceipt: ((value: Record<string, unknown>) => Record<string, unknown>) | undefined;
let afterPatch: (() => void) | undefined;
function user(uid: string) { return { uid, getIdToken: async () => { sdk.beforeToken?.(); return 'synthetic-token'; } }; }
beforeEach(() => {
  localStorage.clear(); sdk.currentUser = user('john-synthetic'); sdk.beforeToken = undefined; sdk.exchange = false;
  product = raw(); version = '100:1'; receipt = null; requests = []; mode = 'ok'; mutateReceipt = undefined; afterPatch = undefined;
  vi.stubGlobal('crypto', webcrypto); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const method = options?.method ?? 'GET'; const body: unknown = options?.body ? JSON.parse(String(options.body)) : undefined;
    requests.push({ url, method, ...(body ? { body } : {}) });
    if (url === '/api/access/session') return response({ status: 'ACTIVE', uid: sdk.currentUser.uid, admin: true,
      superadmin: false, scope: 'JOHN_ADMIN_CLOSED_V1', expiresAtMs: Date.now() + 60000,
      ...(sdk.exchange ? { customToken: 'synthetic-custom-token' } : {}) });
    const parsedUrl = new URL(url, 'https://local.invalid');
    expect(parsedUrl.pathname).toBe('/api/catalog-edit'); expect(parsedUrl.searchParams.get('id')).toBe('publication');
    if (method === 'PATCH') {
      if (mode === 'conflict') return response({ applied: false, error: 'La publicación cambió mientras la editabas.' }, 409);
      const edit = parseEditRequest(body);
      expect(edit.changes).toEqual({ title: { es: 'Edited' } });
      receipt = { status: 'CONFIRMED', id: 'publication', operationId: edit.operationId, version: '101:1',
        baseVersion: edit.version, changes: edit.changes, requestHash: requestHash('publication', edit) };
      // The transport fixture exposes a predetermined server result; production
      // client, raw delta, receipt parser/hash and UI are the behavior under test.
      product = { ...product, title: { ...(isObject(product.title) ? product.title : {}), es: 'Edited' } }; version = '101:1';
      afterPatch?.();
      if (mode === 'lost-ack') throw Error('Synthetic connection closed after commit');
      return response(mutateReceipt ? mutateReceipt(receipt) : receipt);
    }
    if (parsedUrl.searchParams.has('operationId')) {
      return receipt ? response(mutateReceipt ? mutateReceipt(receipt) : receipt)
        : response({ status: 'NOT_CONFIRMED', id: 'publication', operationId: parsedUrl.searchParams.get('operationId'), resubmissionAuthorized: false });
    }
    if (mode === 'reread-fail' && receipt) throw Error('Synthetic unavailable re-read');
    return response({ id: 'publication', version, product, capabilities: { editExisting: true } });
  }));
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ''; localStorage.clear(); vi.unstubAllGlobals();
});
const edits: CatalogEditChanges = { title: { es: 'Edited' } };
const patches = () => requests.filter(item => item.method === 'PATCH');
const pendingKey = () => `mutter-catalog-edit:${sdk.currentUser.uid}:publication`;

test('raw touched delta preserves missing, null, localized legacy, active and unknown fields', () => {
  const base = raw(); expect(changedFields(base, {})).toEqual({});
  expect(changedFields(base, { title: { es: 'Original' } })).toEqual({});
  expect(changedFields(base, edits)).toEqual(edits);
  expect(applyCatalogChanges(base, edits)).toEqual({ ...base, title: { es: 'Edited', pt: 'Legado' } });
  expect(applyCatalogChanges(base, { category: { name: 'New' } }).category).toEqual({ id: 'cat', name: 'New', legacy: true });
  expect(applyCatalogChanges({ ...base, description: { es: 'Uno', en: 'One', pt: 'Um', legacy: null } },
    { description: { es: 'Nuevo' } }).description).toEqual({ es: 'Nuevo', en: 'One', pt: 'Um', legacy: null });
  expect(Object.prototype.hasOwnProperty.call(applyCatalogChanges(base, edits), 'subtitle')).toBe(false);
  expect(() => parseChanges({ active: true })).toThrow(); expect(parseChanges({ images: [] })).toEqual({ images: [] }); // Structural JSON accepts this field; the server validates image provenance and preservation.
});
test.each(['john-synthetic', 'rodrigo-synthetic'])('%s saves once, validates exact receipt and all preserved fields', async uid => {
  sdk.currentUser = user(uid); const opened = await openCatalogEdit('publication');
  const saved = await saveCatalogEdit(opened.document, edits);
  expect(saved.product).toEqual({ ...raw(), title: { es: 'Edited', pt: 'Legado' } });
  expect(saved.version).toBe('101:1'); expect(patches()).toHaveLength(1); expect(localStorage.getItem(pendingKey())).toBeNull();
});
test('legitimate same-UID token exchange replaces User, then pins the admitted current actor', async () => {
  sdk.exchange = true; const oldUser = sdk.currentUser;
  const opened = await openCatalogEdit('publication'); expect(sdk.currentUser).not.toBe(oldUser);
  expect(opened.document.id).toBe('publication'); expect(patches()).toHaveLength(0);
});
test('lost ACK survives reopen; subsequent save is receipt GET and exact reread, never PATCH', async () => {
  const opened = await openCatalogEdit('publication'); mode = 'lost-ack';
  await expect(saveCatalogEdit(opened.document, edits)).rejects.toBeInstanceOf(CatalogEditPendingError);
  const reopened = await openCatalogEdit('publication'); expect(reopened).toEqual({ ...opened, changes: edits, pending: true });
  mode = 'ok'; const saved = await saveCatalogEdit(reopened.document, reopened.changes);
  expect(saved.version).toBe('101:1'); expect(patches()).toHaveLength(1);
  expect(requests.filter(item => item.url.includes('operationId='))).toHaveLength(1);
});
test('confirmed ACK followed by reread failure retains receipt and next check only rereads', async () => {
  const opened = await openCatalogEdit('publication'); mode = 'reread-fail';
  await expect(saveCatalogEdit(opened.document, edits)).rejects.toBeInstanceOf(CatalogEditPendingError);
  expect(JSON.parse(localStorage.getItem(pendingKey()) ?? '{}').phase).toBe('CONFIRMED');
  mode = 'ok'; await saveCatalogEdit(opened.document, edits); expect(patches()).toHaveLength(1);
  expect(requests.filter(item => item.url.includes('operationId='))).toHaveLength(0);
});
test('definitive conflict clears only rejected request and keeps original visible error', async () => {
  const opened = await openCatalogEdit('publication'); mode = 'conflict';
  await expect(saveCatalogEdit(opened.document, edits)).rejects.toThrow('cambió mientras');
  expect(localStorage.getItem(pendingKey())).toBeNull(); expect(patches()).toHaveLength(1);
});
test.each(['id', 'operationId', 'baseVersion', 'requestHash', 'changes'])(
  'mismatched receipt %s never clears pending or resends', async field => {
    const opened = await openCatalogEdit('publication');
    mutateReceipt = item => ({ ...item, [field]: field === 'changes' ? { title: { es: 'Other' } } : 'wrong' });
    await expect(saveCatalogEdit(opened.document, edits)).rejects.toBeInstanceOf(CatalogEditPendingError);
    await expect(saveCatalogEdit(opened.document, edits)).rejects.toBeInstanceOf(CatalogEditPendingError);
    expect(patches()).toHaveLength(1); expect(localStorage.getItem(pendingKey())).not.toBeNull();
  });
test('readback with changed state at the claimed commit cannot complete', async () => {
  const opened = await openCatalogEdit('publication'); afterPatch = () => { product.active = true; };
  await expect(saveCatalogEdit(opened.document, edits)).rejects.toThrow('relectura no coincide');
  expect(localStorage.getItem(pendingKey())).not.toBeNull(); expect(patches()).toHaveLength(1);
});
test('receipt not confirmed never authorizes resending', async () => {
  const opened = await openCatalogEdit('publication'); mode = 'lost-ack';
  await expect(saveCatalogEdit(opened.document, edits)).rejects.toBeInstanceOf(CatalogEditPendingError);
  receipt = null; mode = 'ok';
  await expect(saveCatalogEdit(opened.document, edits)).rejects.toBeInstanceOf(CatalogEditPendingError);
  expect(patches()).toHaveLength(1); expect(localStorage.getItem(pendingKey())).not.toBeNull();
});
test.each(['john-synthetic', 'rodrigo-synthetic'])('%s explicitly reopens a later edit without overwriting or losing receipt', async uid => {
  sdk.currentUser = user(uid); const opened = await openCatalogEdit('publication');
  afterPatch = () => { product = { ...product, subtitle: 'Later edit by other account' }; version = '102:2'; };
  await expect(saveCatalogEdit(opened.document, edits)).rejects.toBeInstanceOf(CatalogEditSupersededError);
  const reopened = await reopenSupersededCatalogEdit('publication');
  expect(reopened.document.version).toBe('102:2'); expect(reopened.document.product.subtitle).toBe('Later edit by other account');
  expect(reopened.pending).toBe(false); expect(localStorage.getItem(pendingKey())).toBeNull();
  expect(Object.keys(localStorage).filter(item => item.includes(':history:'))).toHaveLength(1); expect(patches()).toHaveLength(1);
});
test('account changes after token await prevent dispatch and retain safe pending state', async () => {
  const opened = await openCatalogEdit('publication'); let tokenCount = 0;
  sdk.beforeToken = () => { tokenCount++; if (tokenCount === 2) sdk.currentUser = user('another-user'); };
  await expect(saveCatalogEdit(opened.document, edits)).rejects.toBeInstanceOf(CatalogEditPendingError);
  expect(patches()).toHaveLength(0); expect(localStorage.getItem('mutter-catalog-edit:john-synthetic:publication')).not.toBeNull();
});
test('account changes after PATCH prevent reread under a different actor', async () => {
  const opened = await openCatalogEdit('publication'); afterPatch = () => { sdk.currentUser = user('another-user'); };
  await expect(saveCatalogEdit(opened.document, edits)).rejects.toBeInstanceOf(CatalogEditPendingError);
  expect(patches()).toHaveLength(1); expect(requests.at(-1)?.method).toBe('PATCH');
});
test('another window changing the durable operation before dispatch prevents PATCH', async () => {
  const opened = await openCatalogEdit('publication'); let tokenCount = 0;
  sdk.beforeToken = () => {
    tokenCount++;
    if (tokenCount === 2) {
      const stored = JSON.parse(localStorage.getItem(pendingKey()) ?? '{}');
      localStorage.setItem(pendingKey(), JSON.stringify({ ...stored, operationId: '12345678-1234-4123-8123-123456789012' }));
    }
  };
  await expect(saveCatalogEdit(opened.document, edits)).rejects.toThrow('otra ventana'); expect(patches()).toHaveLength(0);
  expect(localStorage.getItem(pendingKey())).toContain('12345678-1234-4123-8123-123456789012');
});

async function waitFor(check: () => void) {
  let failure: unknown;
  for (let i = 0; i < 100; i++) {
    try { check(); return; } catch (error: unknown) { failure = error; }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  throw failure;
}
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(element => element.textContent?.trim() === label);
  if (!found) throw Error('Missing button ' + label); return found;
}
function titleInput(): HTMLInputElement {
  const label = [...document.querySelectorAll('label')].find(element => element.textContent === 'Título');
  const input = label?.querySelector('input'); if (!input) throw Error('Missing title input'); return input;
}
async function mountEditor(uid: string, editTitle = true) {
  sdk.currentUser = user(uid); const element = document.createElement('div'); document.body.append(element); root = createRoot(element);
  await act(async () => root?.render(<MemoryRouter><ProductList /></MemoryRouter>));
  await waitFor(() => expect(button('Abrir y editar')).toBeTruthy());
  for (const forbidden of ['Crear producto', 'Activar', 'Desactivar', 'Eliminar']) expect(document.body.textContent).not.toContain(forbidden);
  expect(button('Crear publicación').disabled).toBe(false);
  await act(async () => button('Abrir y editar').click());
  await waitFor(() => expect(titleInput()).toBeTruthy());
  if (editTitle) await act(async () => {
    const input = titleInput(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Edited');
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
test.each([false, true])('missing or empty Spanish title uses a generic dialog heading and preserves other languages on real save (%s)', async presentEmpty => {
  const languages: JsonObject = { en: 'HIDDEN_ENGLISH_SENTINEL', pt: 'Legado', ...(presentEmpty ? { es: '' } : {}) };
  product = { ...raw(), title: languages }; const before = structuredClone(product);
  await mountEditor('john-synthetic', false);
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.querySelector('h2')?.textContent).toBe('Editar publicación');
  expect(dialog?.textContent).not.toContain('HIDDEN_ENGLISH_SENTINEL'); expect(titleInput().value).toBe('');
  await act(async () => {
    const input = titleInput(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Edited');
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => button('Guardar cambios').click());
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(patches()).toHaveLength(1); expect(product).toEqual({ ...before, title: { ...languages, es: 'Edited' } });
  expect(localStorage.getItem(pendingKey())).toBeNull(); expect(before.title).toEqual(languages);
});
test.each(['john-synthetic', 'rodrigo-synthetic'])('%s actual list/modal saves only touched title and preserves inactive publication', async uid => {
  await mountEditor(uid); await act(async () => button('Guardar cambios').click());
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(document.body.textContent).toContain('Edited'); expect(document.body.textContent).toContain('Inactiva');
  expect(patches()).toHaveLength(1); expect(product.description).toBeNull(); expect(product.title).toEqual({ es: 'Edited', pt: 'Legado' });
});
test('legacy HTML stays byte-identical while another field is edited, and no color tool is offered', async () => {
  const legacy = '<p style="color: red">Original <a href="https://example.invalid">link</a></p>';
  product.description = legacy;
  await mountEditor('john-synthetic');
  expect(document.querySelector('[aria-label="Descripción guardada"]')?.textContent).toBe('Original link');
  expect(document.querySelector('textarea[aria-label="Descripción"]')).toBeNull();
  expect(document.body.textContent).toContain('formato original'); expect(document.querySelector('input[type="color"]')).toBeNull();
  await act(async () => button('Guardar cambios').click());
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull()); expect(product.description).toBe(legacy);
});
test('actual editor retains draft after conflict and freezes pending loss-ACK for check only', async () => {
  await mountEditor('john-synthetic'); mode = 'conflict'; await act(async () => button('Guardar cambios').click());
  await waitFor(() => expect(document.body.textContent).toContain('cambió mientras'));
  expect(titleInput().value).toBe('Edited'); expect(titleInput().disabled).toBe(false);
  mode = 'lost-ack'; await act(async () => button('Guardar cambios').click());
  await waitFor(() => expect(button('Comprobar guardado')).toBeTruthy());
  expect(titleInput().closest('fieldset')?.disabled).toBe(true);
  mode = 'ok'; await act(async () => button('Comprobar guardado').click());
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull()); expect(patches()).toHaveLength(2);
});
