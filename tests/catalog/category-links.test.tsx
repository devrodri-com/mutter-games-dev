import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Category, Product } from '../../src/data/types';
import type { CatalogSnapshot } from '../../src/hooks/useCatalogSnapshot';

const boundary = vi.hoisted(() => {
  const snapshot: CatalogSnapshot = { products: [], complete: true, pending: false, error: null, retry: vi.fn() };
  return { snapshot, categories: vi.fn<() => Promise<Category[]>>() };
});
vi.mock('../../src/hooks/useCatalogSnapshot', () => ({ useCatalogSnapshot: () => boundary.snapshot }));
vi.mock('../../src/firebase/categories', () => ({ fetchCategories: boundary.categories }));
// The unrelated navbar receives an empty cart; importing the app entry must not start providers.
vi.mock('../../src/context/CartContext', () => ({ useCart: () => ({ items: [] }) }));
vi.mock('../../src/index', () => ({ default: {} }));

import CategorySection from '../../src/components/CategorySection';
import Shop from '../../src/pages/Shop';

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid local category metadata record');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Missing local metadata string');
  return value;
}
function loadMetadata(): Category[] {
  const input: unknown = JSON.parse(readFileSync(path.resolve(process.cwd(), 'verification/category-metadata.json'), 'utf8'));
  const rawCategories = record(input).categories;
  if (!Array.isArray(rawCategories)) throw new Error('Missing local category metadata array');
  return rawCategories.map((value: unknown) => {
    const category = record(value);
    const id = text(category.id);
    const rawSubcategories = category.subcategories;
    if (!Array.isArray(rawSubcategories)) throw new Error('Missing local subcategory metadata array');
    return {
      id,
      name: typeof category.name === 'string' ? category.name : text(record(category.name).es),
      subcategories: rawSubcategories.map((value: unknown) => {
        const subcategory = record(value);
        return { id: text(subcategory.id), name: text(subcategory.name), categoryId: id };
      }),
    };
  });
}

// IDs come from the frozen public metadata, not from CategorySection or URL/selection code.
// Products are synthetic. The expected member lists below are authored independently.
const categories = loadMetadata();
function categoryNamed(name: string): Category {
  const matches = categories.filter(category => category.name === name);
  const match = matches[0];
  if (matches.length !== 1 || !match) throw new Error('Ambiguous or absent category metadata: ' + name);
  return match;
}
function subcategoryNamed(category: string, name: string) {
  const matches = categoryNamed(category).subcategories.filter(subcategory => subcategory.name === name);
  const match = matches[0];
  if (matches.length !== 1 || !match) throw new Error('Ambiguous or absent subcategory metadata: ' + name);
  return match;
}
function sample(id: string, category: string, subcategory: string, title: string, tipo: string, priceUSD: number, active = true): Product {
  const parent = categoryNamed(category);
  return {
    id, slug: id, name: title, title: { es: title, en: title }, description: '', active, priceUSD, tipo,
    images: ['/local-category-test.webp'], category: { id: parent.id, name: parent.name },
    subcategory: subcategoryNamed(category, subcategory),
  };
}
function catalog(): Product[] {
  return [
    sample('ps5', 'PLAYSTATION', 'Playstation 5', 'Mesa PlayStation 5', 'Consolas', 90),
    sample('ps1', 'PLAYSTATION', 'Playstation 1', 'Retro PlayStation 1', 'Juegos', 55),
    sample('psp', 'PLAYSTATION', 'PSP', 'Viaje PSP', 'Consolas', 70),
    sample('vita', 'PLAYSTATION', 'PS Vita', 'Viaje Vita', 'Consolas', 20),
    sample('ds', 'NINTENDO', 'Nintendo DS / 3DS', 'Viaje Nintendo DS', 'Consolas', 40),
    sample('switch', 'NINTENDO', 'Nintendo Switch', 'Viaje Switch', 'Juegos', 60),
    sample('wii', 'NINTENDO', 'Nintendo Wii', 'Salón Nintendo Wii', 'Consolas', 30),
    sample('xbox-one', 'XBOX', 'One / One S', 'Viaje Xbox One', 'Consolas', 10),
    sample('family', 'JUEGOS FAMILY GAME', 'CARTUCHOS', 'Retro Family cartucho', 'Juegos', 2),
    sample('others', 'OTROS', 'Discos y Accesorios', 'Retro otros disco', 'Accesorios', 5),
    sample('figure', 'COLECCIONABLES', 'FIGURAS DE ACCION', 'Figura colección', 'Juguetes', 15),
    sample('dvd', 'COLECCIONABLES', 'PELICULAS DVD ORIGINALES', 'Película colección', 'DVD', 12),
    sample('hidden-vita', 'PLAYSTATION', 'PS Vita', 'Viaje Vita oculto', 'Consolas', 1, false),
  ];
}
const activeMembers = ['ps5', 'ps1', 'psp', 'vita', 'ds', 'switch', 'wii', 'xbox-one', 'family', 'others', 'figure', 'dvd'];
const homeCases = [
  { name: 'PlayStation', expected: ['ps5', 'ps1', 'psp', 'vita'] },
  { name: 'Xbox', expected: ['xbox-one'] },
  { name: 'Nintendo', expected: ['ds', 'switch', 'wii'] },
  { name: 'Portátiles', expected: ['psp', 'vita', 'ds', 'switch'] },
  { name: 'Retro / Otros', expected: ['family', 'others'] },
  { name: 'Coleccionables', expected: ['figure', 'dvd'] },
];
const groupCases = [
  {
    name: 'Portátiles', facet: 'sub', search: 'Viaje', type: 'Consolas', expected: ['psp', 'ds', 'vita'],
    afterFacetClear: ['psp', 'ds', 'vita', 'xbox-one'],
    ids: [subcategoryNamed('PLAYSTATION', 'PS Vita').id, subcategoryNamed('PLAYSTATION', 'PSP').id,
      subcategoryNamed('NINTENDO', 'Nintendo DS / 3DS').id, subcategoryNamed('NINTENDO', 'Nintendo Switch').id],
  },
  {
    name: 'Retro / Otros', facet: 'cat', search: 'Retro', type: 'Juegos', expected: ['family'],
    afterFacetClear: ['ps1', 'family'],
    ids: [categoryNamed('JUEGOS FAMILY GAME').id, categoryNamed('OTROS').id],
  },
];

const i18n = createInstance();
let root: Root | null = null;
let navigate: NavigateFunction | undefined;
function LocationProbe() {
  const location = useLocation();
  navigate = useNavigate();
  return <output data-location>{location.pathname + location.search}</output>;
}
async function mount(url = '/') {
  const host = document.createElement('div');
  document.body.append(host);
  const mountedRoot = createRoot(host);
  root = mountedRoot;
  await act(async () => {
    mountedRoot.render(<MemoryRouter initialEntries={[url]}><I18nextProvider i18n={i18n}><HelmetProvider>
      <Routes><Route path="/" element={<CategorySection />} /><Route path="/shop" element={<Shop />} /></Routes>
      <LocationProbe />
    </HelmetProvider></I18nextProvider></MemoryRouter>);
  });
}
async function unmount() {
  if (root) {
    const mountedRoot = root;
    root = null;
    await act(async () => { mountedRoot.unmount(); });
  }
  navigate = undefined;
  document.body.replaceChildren();
}
function currentLocation(): string {
  const value = document.querySelector('[data-location]')?.textContent;
  if (!value) throw new Error('Missing real router location');
  return value;
}
function params(): URLSearchParams {
  return new URL(currentLocation(), 'https://fixture.invalid').searchParams;
}
async function go(destination: string | number) {
  const routerNavigate = navigate;
  if (!routerNavigate) throw new Error('Missing real router navigation');
  await act(async () => { if (typeof destination === 'number') routerNavigate(destination); else routerNavigate(destination); });
}
function resultIds(): string[] {
  return [...document.querySelectorAll<HTMLAnchorElement>('#shop-results a')].map(link => {
    const href = link.getAttribute('href');
    if (!href?.startsWith('/producto/')) throw new Error('Missing real product link');
    return decodeURIComponent(href.slice('/producto/'.length));
  });
}
function expectMembers(expected: readonly string[]) {
  expect(resultIds().sort()).toEqual([...expected].sort());
  expect(document.body.textContent).toContain(`${expected.length} productos encontrados`);
}
function button(label: string, selector = 'button'): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(value => value.textContent?.trim() === label);
  if (!found) throw new Error('Missing real control: ' + label);
  return found;
}
async function clickHome(name: string) {
  const link = [...document.querySelectorAll<HTMLAnchorElement>('#catalogo a')].find(value => value.getAttribute('aria-label') === `Ver categoría ${name}`);
  if (!link) throw new Error('Missing real Home Link: ' + name);
  await act(async () => { link.click(); });
  expect(currentLocation().split('?')[0]).toBe('/shop');
}
async function search(value: string) {
  const input = document.querySelector('#shop-search');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!(input instanceof HTMLInputElement) || !setter) throw new Error('Missing real search input');
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function sortPriceDescending() {
  const toggle = document.querySelector('button[aria-label="Ordenar productos"]');
  if (!(toggle instanceof HTMLButtonElement)) throw new Error('Missing real sort control');
  // This installed Listbox opens on pointerdown or keyboard, not a synthetic click.
  await act(async () => {
    toggle.focus();
    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  });
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const listbox = document.querySelector('[role="listbox"]');
  if (!(listbox instanceof HTMLElement)) throw new Error('Missing real opened sort listbox');
  const options = [...listbox.querySelectorAll<HTMLElement>('[role="option"]')];
  const index = options.findIndex(option => option.textContent?.trim() === 'Precio: Mayor a Menor');
  const target = options[index];
  if (index < 0 || !target) throw new Error('Missing real descending-price option');
  const press = async (key: string) => {
    await act(async () => { listbox.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
  };
  await press('Home');
  for (let position = 0; position < index; position++) await press('ArrowDown');
  expect(listbox.getAttribute('aria-activedescendant')).toBe(target.id);
  await press('Enter');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.textContent?.trim()).toBe('Precio: Mayor a Menor');
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  boundary.snapshot = { products: catalog(), complete: true, pending: false, error: null, retry: vi.fn() };
  boundary.categories.mockReset();
  boundary.categories.mockResolvedValue(categories);
  await i18n.init({ lng: 'es', fallbackLng: 'es', resources: { es: { translation: {} } }, interpolation: { escapeValue: false } });
});
afterEach(unmount);

test.each(homeCases)('real Home $name Link reaches exactly its independently classified Shop subset', async ({ name, expected }) => {
  await mount();
  expect(document.querySelectorAll('#catalogo a')).toHaveLength(6);
  await clickHome(name);
  expectMembers(expected);
  expect(params().has('category')).toBe(false);
  expect(boundary.categories).toHaveBeenCalledTimes(1);
  expect(boundary.snapshot.retry).not.toHaveBeenCalled();
});

test('repeated IDs are OR within each facet and category/subcategory facets intersect', async () => {
  const query = new URLSearchParams();
  query.append('cat', categoryNamed('PLAYSTATION').id);
  query.append('cat', categoryNamed('NINTENDO').id);
  query.append('sub', subcategoryNamed('PLAYSTATION', 'PSP').id);
  query.append('sub', subcategoryNamed('NINTENDO', 'Nintendo DS / 3DS').id);
  await mount('/shop?' + query);
  expectMembers(['psp', 'ds']);
  expect(params().getAll('cat')).toHaveLength(2);
  expect(params().getAll('sub')).toHaveLength(2);
  await go('/shop?cat=' + categoryNamed('PLAYSTATION').id + '&sub=' + subcategoryNamed('NINTENDO', 'Nintendo DS / 3DS').id);
  expectMembers([]);
});

test.each(groupCases)('$name retains every group ID through search/type/sort and supports facet/global clear', async group => {
  await mount();
  await clickHome(group.name);
  await go(currentLocation() + '&filter=NBA');
  await search(group.search);
  await act(async () => { button(group.type, '.shop-type-options button').click(); });
  await sortPriceDescending();
  expect(resultIds()).toEqual(group.expected);
  expect(params().getAll(group.facet)).toEqual(group.ids);
  expect(params().get('q')).toBe(group.search);
  expect(params().get('type')).toBe(group.type);
  expect(params().get('sort')).toBe('priceDesc');
  expect(params().get('filter')).toBe('NBA');
  const filteredGroupLocation = currentLocation();
  await act(async () => { button('Limpiar filtros', '.shop-sidebar button').click(); });
  expect(resultIds()).toEqual(group.afterFacetClear);
  expect(params().getAll('cat')).toEqual([]);
  expect(params().getAll('sub')).toEqual([]);
  expect(params().get('q')).toBe(group.search);
  expect(params().get('type')).toBe(group.type);
  expect(params().get('sort')).toBe('priceDesc');
  expect(params().get('filter')).toBe('NBA');
  await go(filteredGroupLocation);
  expect(resultIds()).toEqual(group.expected);
  await act(async () => { button('Quitar filtros').click(); });
  expectMembers(activeMembers);
  for (const key of ['cat', 'sub', 'q', 'type', 'filter']) expect(params().has(key)).toBe(false);
  expect(params().get('sort') ?? 'az').toBe('az');
});

test('real Sidebar category/subcategory controls replace grouped IDs and facet clear restores the whole catalog', async () => {
  await mount();
  await clickHome('Portátiles');
  await act(async () => { button('PLAYSTATION', '.shop-sidebar button').click(); });
  expectMembers(['ps5', 'ps1', 'psp', 'vita']);
  expect(params().getAll('cat')).toEqual([categoryNamed('PLAYSTATION').id]);
  expect(params().getAll('sub')).toEqual([]);
  await act(async () => { button('PSP', '.shop-sidebar button').click(); });
  expectMembers(['psp']);
  expect(params().getAll('cat')).toEqual([]);
  expect(params().getAll('sub')).toEqual([subcategoryNamed('PLAYSTATION', 'PSP').id]);
  await act(async () => { button('Limpiar filtros', '.shop-sidebar button').click(); });
  expectMembers(activeMembers);
  expect(params().getAll('cat')).toEqual([]);
  expect(params().getAll('sub')).toEqual([]);
});

test('grouped Home destination survives another Shop navigation, browser back and refresh from the actual resulting URL', async () => {
  await mount();
  await clickHome('Portátiles');
  const portableLocation = currentLocation();
  await go('/shop?cat=' + categoryNamed('XBOX').id);
  expectMembers(['xbox-one']);
  await go(-1);
  expect(currentLocation()).toBe(portableLocation);
  expectMembers(['psp', 'vita', 'ds', 'switch']);
  const refreshLocation = currentLocation();
  await unmount();
  await mount(refreshLocation);
  expect(currentLocation()).toBe(refreshLocation);
  expectMembers(['psp', 'vita', 'ds', 'switch']);
  expect(params().getAll('sub')).toHaveLength(4);
});

test('legacy scalar category/subcategory IDs and existing search/type/order remain compatible', async () => {
  const query = new URLSearchParams({ cat: categoryNamed('PLAYSTATION').id,
    sub: subcategoryNamed('PLAYSTATION', 'PSP').id, q: 'viaje', type: 'Consolas', sort: 'priceDesc' });
  await mount('/shop?' + query);
  expectMembers(['psp']);
  expect(params().getAll('cat')).toEqual([categoryNamed('PLAYSTATION').id]);
  expect(params().getAll('sub')).toEqual([subcategoryNamed('PLAYSTATION', 'PSP').id]);
  await search('VIAJE PSP');
  expectMembers(['psp']);
  expect(params().get('type')).toBe('Consolas');
  expect(params().get('sort')).toBe('priceDesc');
});

test.each([
  { name: 'empty categories', query: 'cat=&cat=', expected: activeMembers, cats: [], subs: [] },
  { name: 'empty subcategories', query: 'sub=&sub=', expected: activeMembers, cats: [], subs: [] },
  { name: 'duplicate category ID', query: 'cat=' + categoryNamed('PLAYSTATION').id + '&cat=' + categoryNamed('PLAYSTATION').id,
    expected: ['ps5', 'ps1', 'psp', 'vita'], cats: [categoryNamed('PLAYSTATION').id], subs: [] },
  { name: 'unknown category', query: 'cat=unknown-category-id', expected: [], cats: ['unknown-category-id'], subs: [] },
  { name: 'unknown subcategory', query: 'sub=unknown-subcategory-id', expected: [], cats: [], subs: ['unknown-subcategory-id'] },
])('$name is normalized or remains an explicit empty result without expanding to all products', async value => {
  await mount('/shop?' + value.query);
  expectMembers(value.expected);
  expect(params().getAll('cat')).toEqual(value.cats);
  expect(params().getAll('sub')).toEqual(value.subs);
});
