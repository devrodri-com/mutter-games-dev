import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { JsonObject, JsonValue } from '../../src/domain/catalogEdit';
import type { CatalogCreateDraft } from '../../src/utils/catalogCreateClient';

// These tests exercise real forms/list and callbacks. Client persistence and
// authenticated service behavior are covered by their separate boundary tests.
const boundary = vi.hoisted(() => ({ uid: 'john', read: vi.fn(), open: vi.fn(), save: vi.fn(), create: vi.fn(), reopenCreate: vi.fn(), update: vi.fn(),
  recover: vi.fn(), upload: vi.fn(), acknowledge: vi.fn(), imageDrafts: vi.fn(), draft: vi.fn() }));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ user: { uid: boundary.uid }, credentialScope: 'JOHN_ADMIN_CLOSED_V1' }) }));
vi.mock('../../src/firebase/adminCatalogRead', () => ({ readAdminCatalog: boundary.read, catalogProductForDisplay: (id: string, product: JsonObject) => ({ id, ...product }) }));
vi.mock('../../src/utils/catalogEditClient', () => ({ openCatalogEdit: boundary.open, saveCatalogEdit: boundary.save,
  reopenSupersededCatalogEdit: vi.fn(), CatalogEditPendingError: class extends Error {}, CatalogEditSupersededError: class extends Error {} }));
vi.mock('../../src/utils/catalogCreateClient', () => {
  class PendingError extends Error {}
  return { newCatalogDraft: boundary.draft, createCatalogPublication: boundary.create, reopenSupersededCatalogCreate: boundary.reopenCreate,
    updateCatalogDraft: boundary.update, CatalogCreatePendingError: PendingError, CatalogCreateSupersededError: class extends PendingError {} };
});
vi.mock('../../src/utils/catalogImageClient', () => ({ recoverCatalogImage: boundary.recover, uploadCatalogImage: boundary.upload,
  acknowledgeCatalogImage: boundary.acknowledge, listCatalogImageDrafts: boundary.imageDrafts }));

import PublicationList from '../../src/components/admin/publication-list';
import PublicationVariants from '../../src/components/admin/publication-variants';
import PublicationCreate from '../../src/components/admin/publication-create';
import ScopedCatalogEditor from '../../src/components/admin/ScopedCatalogEditor';
import PublicationImages from '../../src/components/admin/publication-images';
import { CatalogCreatePendingError, CatalogCreateSupersededError } from '../../src/utils/catalogCreateClient';
import ScopedDescriptionInput from '../../src/components/admin/ScopedDescriptionInput';
import { publicationDescriptionText, publicationDescriptionEditable } from '../../src/components/admin/publication-description';
import { inertDescription } from '../../api/_lib/catalog-edit-fields';
import { normalizeCatalogCreate } from '../../api/_lib/catalog-edit-create';

const categories = [{ id: 'cat', name: 'Consolas', subcategories: [{ id: 'sub', name: 'Retro', categoryId: 'cat' }] }];
const baseline = (price = 120): JsonObject => ({ active: false, title: { es: 'Consola original', en: 'Original console', pt: 'Preservado' },
  category: { id: 'cat', name: 'Consolas', unknown: true }, subcategory: { id: 'sub', name: 'Retro', categoryId: 'cat' },
  description: '<p style="color:red">Legado</p>', images: ['https://example.invalid/original.jpg'], priceUSD: price,
  stockTotal: 4, sku: 'ABC', variants: [{ label: { es: 'Color', en: 'Color', pt: 'Cor' }, hidden: true,
    options: [{ value: 'Rojo', priceUSD: price, stock: 4, variantId: 'immutable-id', unknown: null }] }], unknown: { untouched: true } });
let root: ReturnType<typeof createRoot> | undefined;
beforeEach(() => {
  vi.clearAllMocks(); boundary.uid = 'john'; boundary.imageDrafts.mockReturnValue([]); boundary.update.mockImplementation(() => {});
  const product = baseline();
  boundary.read.mockResolvedValue({ products: [{ id: 'original', ...product }], categories, subcategories: categories[0].subcategories, readOnly: true });
  boundary.open.mockResolvedValue({ document: { id: 'original', version: '100:1', product }, pending: false, changes: {} });
  boundary.draft.mockReturnValue({ id: 'new-id', operationId: 'new-operation', product: baseline(), imageOperationIds: [], pending: false });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ''; });
async function mount(element: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(element));
}
async function eventually(check: () => void) {
  let last: unknown;
  for (let count = 0; count < 60; count++) {
    try { check(); return; } catch (error: unknown) { last = error; }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  throw last;
}
function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button: ${label}`); return result;
}
function input(label: string): HTMLInputElement {
  const result = [...document.querySelectorAll('label')].find(item => [...item.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim() === label)?.querySelector('input');
  if (!result) throw new Error(`Missing input: ${label}`); return result;
}
async function write(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function select(label: string): HTMLButtonElement {
  const field = [...document.querySelectorAll('.mutter-select')].find(item => item.querySelector('.mutter-select__label')?.textContent?.trim() === label);
  const result = field?.querySelector<HTMLButtonElement>('button');
  if (!result) throw new Error(`Missing selection control: ${label}`);
  return result;
}
async function choose(label: string, optionLabel: string) {
  await act(async () => select(label).dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerType: 'mouse', bubbles: true })));
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.trim() === optionLabel);
  if (!option) throw new Error(`Missing option: ${optionLabel}`);
  await act(async () => option.click());
}

test.each(['john', 'rodrigo'])('%s can open the complete publication through its title and sees the same create action', async uid => {
  boundary.uid = uid; await mount(<PublicationList />);
  await eventually(() => expect(button('Consola original')).toBeTruthy());
  expect(button('Crear publicación').disabled).toBe(false); expect(button('Abrir y editar')).toBeTruthy();
  expect(document.body.textContent).toContain('Inactiva'); expect(document.body.textContent).toContain('Stock: 4');
  expect(document.querySelectorAll('ul img')).toHaveLength(1);
  await act(async () => button('Consola original').click());
  await eventually(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  expect(boundary.open).toHaveBeenCalledWith('original'); expect(input('SKU').value).toBe('ABC');
  expect(input('Precio general').value).toBe('120'); expect(input('Precio').value).toBe('120');
  expect(input('Precio general').disabled).toBe(true);
  expect(document.querySelector('[aria-label="Descripción guardada"]')?.textContent).toBe('Legado');
  expect(document.querySelector('textarea[aria-label="Descripción"]')).toBeNull();
  for (const label of ['Activar', 'Desactivar', 'Eliminar', 'Pedidos', 'Clientes']) expect(document.body.textContent).not.toContain(label);
});

test.each(['john', 'rodrigo'])('%s sees a stored 250 as pesos and preserves the exact amount when saving another field', async uid => {
  boundary.uid = uid;
  const product = baseline(250), before = structuredClone(product);
  boundary.read.mockResolvedValue({ products: [{ id: 'original', ...product }], categories, subcategories: categories[0].subcategories, readOnly: true });
  boundary.open.mockResolvedValue({ document: { id: 'original', version: '100:1', product }, pending: false, changes: {} });
  boundary.save.mockResolvedValue({ id: 'original', version: '101:1', product: { ...before, sku: 'UPDATED-SKU' } });
  await mount(<PublicationList />);
  await eventually(() => expect(button('Consola original')).toBeTruthy());
  expect(document.querySelector('ul')?.textContent).toMatch(/\$\s*250,00/);
  expect(document.body.textContent).not.toMatch(/US\$|USD/);
  await act(async () => button('Consola original').click());
  expect(input('Precio general').value).toBe('250'); expect(input('Precio').value).toBe('250');
  await write(input('SKU'), 'UPDATED-SKU'); await act(async () => button('Guardar cambios').click());
  expect(boundary.save).toHaveBeenCalledWith({ id: 'original', version: '100:1', product: before }, { sku: 'UPDATED-SKU' }, []);
  expect(product).toEqual(before);
  expect(document.querySelector('ul')?.textContent).toMatch(/\$\s*250,00/);
  expect(document.body.textContent).toContain('Cambios guardados y comprobados.');
});

test('editing one field sends only its touched delta; original state, raw description and unknown fields remain untouched', async () => {
  const product = baseline(), before = structuredClone(product), save = vi.fn(async () => {});
  await mount(<ScopedCatalogEditor mode="scoped" initial={{ document: { id: 'original', version: '100:1', product }, changes: {}, pending: false }} categories={categories} onSave={save} onReopen={async () => {}} onClose={() => {}} />);
  await write(input('SKU'), 'EDITED'); await act(async () => button('Guardar cambios').click());
  expect(save).toHaveBeenCalledWith({ id: 'original', version: '100:1', product: before }, { sku: 'EDITED' }, []);
  expect(product).toEqual(before); expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  expect(document.body.textContent).toContain('Inactiva');
});

test('editing the Spanish title shows no English controls and preserves saved languages without sending them', async () => {
  const product = baseline(), save = vi.fn(async () => {});
  await mount(<ScopedCatalogEditor mode="scoped" initial={{ document: { id: 'original', version: '100:1', product }, changes: {}, pending: false }} categories={categories} onSave={save} onReopen={async () => {}} onClose={() => {}} />);
  expect(document.body.textContent).not.toContain('en inglés');
  expect(document.querySelectorAll('[role="textbox"][aria-label="Descripción"]')).toHaveLength(0); // Legacy description is retained until explicitly opened.
  await write(input('Título'), 'Nuevo');
  await act(async () => button('Guardar cambios').click());
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ product }), { title: { es: 'Nuevo' } }, []);
  expect(product.title).toEqual({ es: 'Consola original', en: 'Original console', pt: 'Preservado' });
});

test('changing category with a repeated child ID requires a coherent explicit subcategory selection before saving', async () => {
  const repeated = [...categories, { id: 'different', name: 'Accesorios', subcategories: [{ id: 'sub', name: 'Modernos', categoryId: 'different' }] }];
  const product = baseline(), before = structuredClone(product), save = vi.fn(async () => {});
  await mount(<ScopedCatalogEditor mode="scoped" initial={{ document: { id: 'original', version: '100:1', product }, changes: {}, pending: false }} categories={repeated} onSave={save} onReopen={async () => {}} onClose={() => {}} />);
  expect(select('Subcategoría').textContent?.trim()).toBe('Retro');
  await choose('Categoría', 'Accesorios');
  expect(select('Subcategoría').textContent?.trim()).toMatch(/Elegir subcategoría|Subcategoría actual conservada/);
  expect(select('Subcategoría').textContent?.trim()).toBe('Elegir subcategoría');
  await act(async () => select('Subcategoría').dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerType: 'mouse', bubbles: true })));
  expect([...document.querySelectorAll('[role="option"]')].some(option => option.textContent?.trim() === 'Modernos')).toBe(true);
  await act(async () => document.querySelector<HTMLElement>('[role="listbox"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await act(async () => button('Guardar cambios').click());
  expect(save).not.toHaveBeenCalled(); expect(document.querySelector('[role="alert"]')?.textContent).toContain('Elegí una subcategoría');
  await choose('Subcategoría', 'Modernos');
  await act(async () => button('Guardar cambios').click());
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith({ id: 'original', version: '100:1', product: before }, {
    category: { id: 'different', name: 'Accesorios' }, subcategory: { id: 'sub', name: 'Modernos', categoryId: 'different' },
  }, []);
  expect(product).toEqual(before); expect(document.body.textContent).toContain('Inactiva');
});

test('creating with a repeated child ID does not send until its parent matches the selected category', async () => {
  const repeated = [...categories, { id: 'different', name: 'Accesorios', subcategories: [{ id: 'sub', name: 'Modernos', categoryId: 'different' }] }];
  const product: JsonObject = { title: { es: 'Nueva' }, description: '', active: false,
    category: { id: 'cat', name: 'Consolas' }, subcategory: { id: 'sub', name: 'Retro', categoryId: 'cat' },
    images: ['https://example.invalid/confirmed.jpg'], variants: [{ label: { es: 'Modelo' }, options: [{ value: 'Única', priceUSD: 20, stock: 0 }] }] };
  const draft: CatalogCreateDraft = { id: 'new-id', operationId: 'new-operation', product, imageOperationIds: [], pending: false };
  const created = vi.fn(); boundary.create.mockResolvedValue({ id: draft.id, version: '101:1', product });
  expect(normalizeCatalogCreate(product, '12345678-1234-4123-8123-123456789012').title).toEqual({ es: 'Nueva' });
  await mount(<PublicationCreate draft={draft} categories={repeated} onCreated={created} onClose={() => {}} />);
  expect(input('Título').value).toBe('Nueva'); expect(document.body.textContent).not.toContain('en inglés');
  expect(document.querySelector('[role="textbox"][aria-label="Descripción"]')).not.toBeNull();
  await choose('Categoría', 'Accesorios');
  expect(select('Subcategoría').textContent?.trim()).toMatch(/Elegir subcategoría|Subcategoría actual conservada/);
  await act(async () => button('Crear publicación').click());
  expect(boundary.create).not.toHaveBeenCalled(); expect(created).not.toHaveBeenCalled();
  await choose('Subcategoría', 'Modernos');
  await act(async () => button('Crear publicación').click());
  expect(boundary.create).toHaveBeenCalledTimes(1);
  expect(boundary.create).toHaveBeenCalledWith(draft, { ...product,
    category: { id: 'different', name: 'Accesorios' }, subcategory: { id: 'sub', name: 'Modernos', categoryId: 'different' },
  }, []);
  expect(product.category).toEqual({ id: 'cat', name: 'Consolas' }); expect(product.active).toBe(false);
});

test.each([null, 'sub', { id: 'sub', name: 'Legada', categoryId: 'old-parent', unknown: true }])('an unrelated SKU edit preserves legacy classification %j without normalization', async subcategory => {
  const product: JsonObject = { ...baseline(), category: 'cat', subcategory }, before = structuredClone(product), save = vi.fn(async () => {});
  await mount(<ScopedCatalogEditor mode="scoped" initial={{ document: { id: 'original', version: '100:1', product }, changes: {}, pending: false }} categories={categories} onSave={save} onReopen={async () => {}} onClose={() => {}} />);
  await write(input('SKU'), 'EDITED'); await act(async () => button('Guardar cambios').click());
  expect(save).toHaveBeenCalledWith({ id: 'original', version: '100:1', product: before }, { sku: 'EDITED' }, []);
  expect(product).toEqual(before);
});

test('an explicit subcategory selection makes a legacy string category coherent without changing unrelated fields', async () => {
  const product: JsonObject = { ...baseline(), category: 'cat', subcategory: 'sub' }, before = structuredClone(product), save = vi.fn(async () => {});
  await mount(<ScopedCatalogEditor mode="scoped" initial={{ document: { id: 'original', version: '100:1', product }, changes: {}, pending: false }} categories={categories} onSave={save} onReopen={async () => {}} onClose={() => {}} />);
  expect(select('Subcategoría').textContent?.trim()).toMatch(/Elegir subcategoría|Subcategoría actual conservada/);
  await choose('Subcategoría', 'Retro'); await act(async () => button('Guardar cambios').click());
  expect(save).toHaveBeenCalledWith({ id: 'original', version: '100:1', product: before }, {
    category: { id: 'cat', name: 'Consolas' }, subcategory: { id: 'sub', name: 'Retro', categoryId: 'cat' },
  }, []);
  expect(product).toEqual(before);
});

test('reopening a pending edit retains original image receipts for its observation-only save', async () => {
  const product = baseline(), save = vi.fn(async () => {});
  const changes = { images: ['https://example.invalid/original.jpg', 'https://example.invalid/added.jpg'] };
  await mount(<ScopedCatalogEditor mode="scoped" initial={{ document: { id: 'original', version: '100:1', product }, changes, pending: true, imageOperationIds: ['image-operation'] }} categories={categories} onSave={save} onReopen={async () => {}} onClose={() => {}} />);
  await act(async () => button('Comprobar guardado').click());
  expect(save).toHaveBeenCalledWith({ id: 'original', version: '100:1', product }, changes, ['image-operation']);
  expect(boundary.upload).not.toHaveBeenCalled();
});

test('Spanish variant name, price and stock remain editable while saved languages and unknown fields survive', async () => {
  const original: JsonValue = [{ label: { es: '', en: 'Color', pt: 'Cor' }, hidden: true,
    options: [{ value: 'Rojo', priceUSD: 120, stock: 4, variantId: 'immutable-id', unknown: null }] }];
  let observed: JsonValue | undefined;
  function Form() { const [value, setValue] = useState(original); return <PublicationVariants value={value} creating={false} disabled={false} onChange={next => { observed = next; setValue(next); }} />; }
  await mount(<Form />); expect(document.body.textContent).not.toContain('en inglés');
  expect(input('Nombre de variante').value).toBe(''); // Saved English never fills a Spanish input.
  await write(input('Nombre de variante'), 'Tono'); await write(input('Precio'), '150');
  expect(observed).toEqual([{ label: { es: 'Tono', en: 'Color', pt: 'Cor' }, hidden: true,
    options: [{ value: 'Rojo', priceUSD: 150, stock: 4, variantId: 'immutable-id', unknown: null }] }]);
  const stock = document.querySelector<HTMLInputElement>('input[aria-label="Stock variante 1 opción 1"]');
  expect(stock).not.toBeNull(); if (!stock) throw new Error('Missing editable stock');
  await write(stock, '6');
  expect(observed).toEqual([{ label: { es: 'Tono', en: 'Color', pt: 'Cor' }, hidden: true,
    options: [{ value: 'Rojo', priceUSD: 150, stock: 6, variantId: 'immutable-id', unknown: null }] }]);
  await act(async () => button('Agregar opción').click());
  expect(observed).toEqual([{ label: { es: 'Tono', en: 'Color', pt: 'Cor' }, hidden: true,
    options: [{ value: 'Rojo', priceUSD: 150, stock: 6, variantId: 'immutable-id', unknown: null }, { value: '', priceUSD: 0, stock: 0 }] }]);
});

test('creation preserves the draft and an uncertain create offers an observation instead of editing or automatic resubmission', async () => {
  const draft: CatalogCreateDraft = { id: 'new-id', operationId: 'new-operation', product: baseline(), imageOperationIds: [], pending: false };
  boundary.create.mockRejectedValue(new CatalogCreatePendingError('Resultado incierto'));
  await mount(<PublicationCreate draft={draft} categories={categories} onCreated={() => {}} onClose={() => {}} />);
  expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  await write(input('SKU'), 'NEW'); expect(boundary.update).toHaveBeenLastCalledWith(draft, { ...baseline(), sku: 'NEW' }, []);
  await act(async () => button('Crear publicación').click());
  await eventually(() => expect(button('Comprobar creación')).toBeTruthy());
  expect(boundary.create).toHaveBeenCalledTimes(1); expect(input('SKU').closest('fieldset')?.disabled).toBe(true);
  expect(document.body.textContent).toContain('no crearemos otra publicación');
});

test('an added option remains editable while incomplete, and cannot be saved until complete', async () => {
  const product = baseline(), save = vi.fn(async () => {});
  await mount(<ScopedCatalogEditor mode="scoped" initial={{ document: { id: 'original', version: '100:1', product }, changes: {}, pending: false }} categories={categories} onSave={save} onReopen={async () => {}} onClose={() => {}} />);
  await act(async () => button('Agregar opción').click());
  expect(input('Opción 2').value).toBe('');
  await act(async () => button('Guardar cambios').click());
  expect(save).not.toHaveBeenCalled(); expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await write(input('Opción 2'), 'Azul');
  await act(async () => button('Guardar cambios').click());
  expect(save).toHaveBeenCalledWith({ id: 'original', version: '100:1', product }, { variants: [{ label: { es: 'Color', en: 'Color', pt: 'Cor' }, hidden: true,
    options: [{ value: 'Rojo', priceUSD: 120, stock: 4, variantId: 'immutable-id', unknown: null }, { value: 'Azul', priceUSD: 0, stock: 0 }] }] }, []);
});

test('initial stock on a new publication stays in the persisted draft', async () => {
  const draft: CatalogCreateDraft = { id: 'new-id', operationId: 'new-operation', product: baseline(), imageOperationIds: [], pending: false };
  await mount(<PublicationCreate draft={draft} categories={categories} onCreated={() => {}} onClose={() => {}} />);
  await write(input('Stock'), '3');
  expect(boundary.update).toHaveBeenLastCalledWith(draft, { ...baseline(), variants: [{ label: { es: 'Color', en: 'Color', pt: 'Cor' }, hidden: true,
    options: [{ value: 'Rojo', priceUSD: 120, stock: 3, variantId: 'immutable-id', unknown: null }] }] }, []);
});

test('explicit image recovery incorporates the confirmed URL and receipt without uploading again', async () => {
  const image = { url: 'https://example.invalid/recovered.jpg', imageOperationId: 'operation' };
  boundary.recover.mockResolvedValue(image); const changed = vi.fn(), operation = vi.fn();
  await mount(<PublicationImages productId="original" value={['https://example.invalid/original.jpg']} disabled={false} onChange={changed} onOperation={operation} onBusy={() => {}} />);
  await act(async () => button('Comprobar carga pendiente').click());
  expect(boundary.upload).not.toHaveBeenCalled(); expect(boundary.recover).toHaveBeenCalledWith('original');
  expect(changed).toHaveBeenCalledWith(['https://example.invalid/original.jpg', image.url]); expect(operation).toHaveBeenCalledWith('operation');
  expect(boundary.acknowledge).toHaveBeenCalledWith('original', 'operation');
});

test('a creation followed by another edit offers the current version explicitly without submitting again', async () => {
  const draft: CatalogCreateDraft = { id: 'new-id', operationId: 'new-operation', product: baseline(), imageOperationIds: [], pending: false };
  const current = { id: 'new-id', version: '103:1', product: { ...baseline(), sku: 'OTHER-ADMIN' } }, created = vi.fn();
  boundary.create.mockRejectedValue(new CatalogCreateSupersededError('Otra edición confirmada'));
  boundary.reopenCreate.mockResolvedValue(current);
  await mount(<PublicationCreate draft={draft} categories={categories} onCreated={created} onClose={() => {}} />);
  await act(async () => button('Crear publicación').click());
  expect(boundary.reopenCreate).not.toHaveBeenCalled(); expect(created).not.toHaveBeenCalled();
  expect(input('SKU').closest('fieldset')?.disabled).toBe(true);
  await act(async () => button('Abrir versión actual').click());
  expect(boundary.create).toHaveBeenCalledTimes(1); expect(boundary.reopenCreate).toHaveBeenCalledWith(draft);
  expect(created).toHaveBeenCalledWith(current, true);
});

test('an unknown historical image shape cannot be replaced by an upload', async () => {
  await mount(<PublicationImages productId="original" value={{ original: 'preserved' }} disabled={false} onChange={() => {}} onOperation={() => {}} onBusy={() => {}} />);
  expect(document.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
  expect(button('Comprobar carga pendiente').disabled).toBe(true);
  expect(boundary.upload).not.toHaveBeenCalled();
});

test('unsafe legacy image URL is not turned into an executable link', async () => {
  await mount(<PublicationImages productId="original" value={['javascript:alert(1)']} disabled={false} onChange={() => {}} onOperation={() => {}} onBusy={() => {}} />);
  expect(document.querySelector('a')).toBeNull(); expect(document.body.textContent).toContain('formato anterior conservada');
});

test('legacy description is displayed as safe text; merely opening its editor never changes saved bytes', async () => {
  const html = '<p style="color:red">Texto &amp; datos</p><img src="https://secret.invalid" onerror="alert(1)"><script>alert(1)</script><p>&lt;b&gt;Literal&lt;/b&gt;</p>';
  const changed = vi.fn(); await mount(<ScopedDescriptionInput initial={html} value={html} label="Descripción" disabled={false} onChange={changed} />);
  expect(document.querySelector('[aria-label="Descripción guardada"]')?.textContent).toBe('Texto & datos\n<b>Literal</b>');
  expect(document.querySelectorAll('script,img,a')).toHaveLength(0);
  await act(async () => button('Editar descripción').click());
  expect(document.querySelector('[contenteditable="true"]')).not.toBeNull(); expect(changed).not.toHaveBeenCalled();
  for (const caption of ['Negrita', 'Cursiva', 'Subrayado']) expect(button(caption)).toBeTruthy();
  for (const caption of ['Bold', 'Italic', 'Underline']) expect(document.body.textContent).not.toContain(caption);
  expect(inertDescription(publicationDescriptionEditable(html))).toBe(true);
  expect(publicationDescriptionText('<script src=x>SECRET</script>Texto')).toBe('Texto');
});

test('branded filters still search the complete catalog beyond the visible page and preserve state filtering', async () => {
  const products = Array.from({ length: 31 }, (_, index) => ({ id: `p-${index}`, ...baseline(), active: index === 30,
    title: { es: index === 30 ? 'Hallazgo fuera de la primera página' : `Consola ${index}`, en: '' } }));
  boundary.read.mockResolvedValue({ products, categories, subcategories: categories[0].subcategories, readOnly: true });
  await mount(<PublicationList />);
  await eventually(() => expect(document.querySelectorAll('ul > li')).toHaveLength(30));
  await choose('Filtrar por estado', 'Activas');
  expect(document.querySelectorAll('ul > li')).toHaveLength(1);
  expect(button('Hallazgo fuera de la primera página')).toBeTruthy();
  await choose('Filtrar por estado', 'Todos los estados');
  const search = document.querySelector<HTMLInputElement>('input[placeholder="Buscar por título…"]');
  if (!search) throw new Error('Missing catalog search');
  await write(search, 'Hallazgo');
  expect(document.querySelectorAll('ul > li')).toHaveLength(1);
  expect(button('Hallazgo fuera de la primera página')).toBeTruthy();
  await choose('Filtrar por categoría', 'Consolas');
  expect(button('Hallazgo fuera de la primera página')).toBeTruthy();
  expect(boundary.read).toHaveBeenCalledTimes(1);
  expect(boundary.save).not.toHaveBeenCalled(); expect(boundary.create).not.toHaveBeenCalled();
});

test('all five branded field selections remain disabled while an earlier save awaits verification', async () => {
  const product = baseline(), save = vi.fn(async () => {});
  await mount(<ScopedCatalogEditor mode="scoped" initial={{ document: { id: 'original', version: '100:1', product }, changes: { sku: 'PENDING' }, pending: true }} categories={categories} onSave={save} onReopen={async () => {}} onClose={() => {}} />);
  for (const label of ['Categoría', 'Subcategoría', 'Tipo', 'Descripción predeterminada', 'Posición de descripción']) {
    expect(select(label).disabled).toBe(true);
    await act(async () => select(label).dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerType: 'mouse', bubbles: true })));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  }
  expect(product).toEqual(baseline()); expect(save).not.toHaveBeenCalled();
});


test('choosing the already selected category preserves legacy classification during an unrelated save', async () => {
  const product: JsonObject = { ...baseline(), category: 'cat', subcategory: 'sub' }, before = structuredClone(product), save = vi.fn(async () => {});
  await mount(<ScopedCatalogEditor mode="scoped" initial={{ document: { id: 'original', version: '100:1', product }, changes: {}, pending: false }} categories={categories} onSave={save} onReopen={async () => {}} onClose={() => {}} />);
  await choose('Categoría', 'Consolas');
  await write(input('SKU'), 'KEEP-CLASSIFICATION');
  await act(async () => button('Guardar cambios').click());
  expect(save).toHaveBeenCalledWith({ id: 'original', version: '100:1', product: before }, { sku: 'KEEP-CLASSIFICATION' }, []);
  expect(product).toEqual(before);
});

test('choosing the unchanged filter keeps the current catalog page', async () => {
  const products = Array.from({ length: 31 }, (_, index) => ({ id: `p-${index}`, ...baseline(), title: { es: `Publicación ${index + 1}`, en: '' } }));
  boundary.read.mockResolvedValue({ products, categories, subcategories: categories[0].subcategories, readOnly: true });
  await mount(<PublicationList />);
  await eventually(() => expect(document.querySelectorAll('ul > li')).toHaveLength(30));
  await act(async () => button('Siguiente').click());
  expect(button('Publicación 31')).toBeTruthy();
  await choose('Filtrar por estado', 'Todos los estados');
  expect(button('Publicación 31')).toBeTruthy();
  expect(document.querySelectorAll('ul > li')).toHaveLength(1);
  expect(document.body.textContent).toContain('Página 2 de 2');
});
