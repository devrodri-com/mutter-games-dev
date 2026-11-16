import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Category, Product } from '../../src/data/types';
import type { CatalogSnapshot } from '../../src/hooks/useCatalogSnapshot';

const boundary = vi.hoisted(() => {
  const snapshot: CatalogSnapshot = { products: [], complete: true, pending: false, error: null, retry: vi.fn() };
  return { snapshot, categories: vi.fn<() => Promise<Category[]>>(), related: vi.fn<() => Promise<Product[]>>() };
});
vi.mock('../../src/hooks/useCatalogSnapshot', () => ({ useCatalogSnapshot: () => boundary.snapshot }));
vi.mock('../../src/firebase/categories', () => ({ fetchCategories: boundary.categories }));
vi.mock('../../src/firebase/products', () => ({ fetchProductsByCategory: boundary.related }));
vi.mock('../../src/context/CartContext', () => ({ useCart: () => ({ items: [] }) }));
vi.mock('../../src/index', () => ({ default: {} }));

import Shop from '../../src/pages/Shop';
import ProductCard from '../../src/components/ProductCard';
import RelatedProducts from '../../src/components/RelatedProducts';
import { getCatalogDisplayPrice } from '../../src/domain/shopSelection';
import { formatCartAmount } from '../../src/utils/cartPresentation';

const categories: Category[] = [
  { id: 'retro', name: 'Retro', subcategories: [{ id: 'cartuchos', name: 'Cartuchos', categoryId: 'retro' }] },
  { id: 'modern', name: 'Actuales', subcategories: [{ id: 'ps5', name: 'PlayStation 5', categoryId: 'modern' }] },
];
// All records are local test data. This public title is retained from the existing cart visual sample.
const dvdTitle = '7 el numero equivocado pelicula dvd bruce willis';
const product = (index: number, changes: Partial<Product> = {}): Product => ({
  id: 'p' + index, slug: 'juego-' + index, name: 'Juego ' + index,
  title: { es: 'Juego ' + String(index).padStart(3, '0'), en: 'Game ' + index }, description: '',
  active: true, priceUSD: index + 1, images: ['/local-dvd.webp'],
  category: { id: 'retro', name: 'Retro' }, subcategory: { id: 'cartuchos', name: 'Cartuchos', categoryId: 'retro' },
  tipo: 'Juegos', ...changes,
});
function catalog(): Product[] {
  const products = Array.from({ length: 137 }, (_, index) => product(index));
  products[135] = product(135, { category: { id: 'modern', name: 'Actuales' },
    subcategory: { id: 'ps5', name: 'PlayStation 5', categoryId: 'modern' }, tipo: 'Consolas' });
  products[136] = product(136, { slug: 'pelicula-7', name: dvdTitle, title: { es: dvdTitle, en: 'Lucky Number Slevin DVD' }, priceUSD: 999,
    variants: [{ label: { es: 'Condición', en: 'Condition' }, options: [{ value: 'Nuevo', priceUSD: 250 }, { value: 'Usado', priceUSD: 150 }] }] });
  products.push(product(999, { active: false, title: { es: dvdTitle + ' oculto', en: '' } }));
  return products;
}
const i18n = createInstance();
let root: Root | null = null;
function LocationProbe() { const location = useLocation(); return <output data-location>{location.pathname + location.search}</output>; }
async function mount(children: React.ReactNode = <Shop />, url = '/shop') {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root?.render(<MemoryRouter initialEntries={[url]}><I18nextProvider i18n={i18n}>
    <HelmetProvider>{children}<LocationProbe /></HelmetProvider>
  </I18nextProvider></MemoryRouter>); });
  return host;
}
function searchInput(): HTMLInputElement {
  const input = document.querySelector('#shop-search');
  if (!(input instanceof HTMLInputElement)) throw new Error('Missing visible shop search');
  return input;
}
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(value => value.textContent?.trim() === name);
  if (!found) throw new Error('Missing button: ' + name);
  return found;
}
function cards(): HTMLAnchorElement[] { return [...document.querySelectorAll<HTMLAnchorElement>('#shop-results a')]; }
function locationParams(): URLSearchParams {
  return new URLSearchParams(document.querySelector('[data-location]')?.textContent?.split('?')[1] ?? '');
}
async function input(value: string) {
  const field = searchInput();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Missing native input setter');
  await act(async () => { setter.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  boundary.snapshot = { products: catalog(), complete: true, pending: false, error: null, retry: vi.fn() };
  boundary.categories.mockReset(); boundary.categories.mockResolvedValue(categories);
  boundary.related.mockReset(); boundary.related.mockResolvedValue([]);
  await i18n.init({ lng: 'es', fallbackLng: 'es', resources: { es: { translation: {} } }, interpolation: { escapeValue: false } });
});
afterEach(async () => { await act(async () => { root?.unmount(); }); root = null; document.body.replaceChildren(); });

test('the real shop exposes one controlled search and reaches the complete catalog beyond the first 24 cards', async () => {
  await mount();
  expect(document.querySelectorAll('#shop-search')).toHaveLength(1);
  expect(document.querySelector('label[for="shop-search"]')?.textContent?.trim()).toBeTruthy();
  expect(document.body.textContent).toContain('137 productos encontrados');
  expect(cards()).toHaveLength(24);
  await input('7 el numero');
  expect(searchInput().value).toBe('7 el numero');
  expect(locationParams().get('q')).toBe('7 el numero');
  expect(cards()).toHaveLength(1);
  expect(cards()[0]?.getAttribute('href')).toBe('/producto/pelicula-7');
  expect(cards()[0]?.textContent).toContain(dvdTitle);
  expect(cards()[0]?.textContent).toContain(formatCartAmount(150));
  expect(boundary.snapshot.retry).not.toHaveBeenCalled();
  expect(boundary.categories).toHaveBeenCalledTimes(1);
});

test('category reset preserves search, type, order and legacy filter while the global reset restores all products', async () => {
  await mount(<Shop />, '/shop?filter=NBA&q=Juego&cat=retro&sub=cartuchos&type=Juegos&sort=priceDesc');
  expect(cards()[0]?.getAttribute('href')).toBe('/producto/juego-134');
  expect(document.body.textContent).toContain('135 productos encontrados');
  await act(async () => { button('Limpiar filtros').click(); });
  const retained = locationParams();
  expect(retained.get('cat')).toBeNull(); expect(retained.get('sub')).toBeNull();
  expect(retained.get('q')).toBe('Juego'); expect(retained.get('type')).toBe('Juegos');
  expect(retained.get('sort')).toBe('priceDesc'); expect(retained.get('filter')).toBe('NBA');
  await act(async () => { button('Quitar filtros').click(); });
  expect(searchInput().value).toBe('');
  const cleared = locationParams();
  for (const key of ['q', 'cat', 'sub', 'type', 'filter']) expect(cleared.get(key)).toBeNull();
  expect(cleared.get('sort') ?? 'az').toBe('az');
  expect(document.body.textContent).toContain('137 productos encontrados');
  expect(cards()).toHaveLength(24);
});

test('initial loading keeps search available and incomplete failures never become an empty success', async () => {
  boundary.snapshot = { products: [], complete: false, pending: true, error: null, retry: vi.fn() };
  await mount();
  expect(searchInput()).toBeTruthy();
  expect(document.body.textContent).toContain('Cargando catálogo completo');
  await input('missing');
  expect(cards()).toHaveLength(0);
  expect(document.body.textContent).not.toContain('No se encontraron productos');
  boundary.snapshot = { ...boundary.snapshot, pending: false, error: 'No pudimos completar el catálogo.' };
  await input('missing again');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('No pudimos completar');
  expect(document.body.textContent).not.toContain('No se encontraron productos');
  await act(async () => { button('Reintentar carga').click(); });
  expect(boundary.snapshot.retry).toHaveBeenCalledTimes(1);
});

test('real product cards retain keyboard focus on the first newly displayed item after load more', async () => {
  await mount();
  const load = button('Cargar más productos');
  await act(async () => { load.focus(); load.click(); });
  expect(cards()).toHaveLength(48);
  expect(document.activeElement).toBe(cards()[24]);
});

test('catalog presentation keeps the complete title, full image and exact Uruguay variant price with encoded navigation', async () => {
  const value = product(1, { slug: 'Edición Pokémon / 7', title: { es: dvdTitle, en: '' }, priceUSD: 999,
    variants: [{ label: { es: 'Modelo', en: '' }, options: [{ value: 'A', priceUSD: 1234.5 }, { value: 'B', priceUSD: 2000 }] }] });
  const host = await mount(<ProductCard product={value} presentation="catalog" />);
  const link = host.querySelector('a');
  expect(link?.getAttribute('href')).toBe('/producto/' + encodeURIComponent(value.slug ?? ''));
  expect(link?.textContent).toContain(formatCartAmount(getCatalogDisplayPrice(value)));
  expect(link?.textContent).toContain('$1.234,50');
  const heading = host.querySelector('h3');
  expect(heading?.textContent).toBe(dvdTitle);
  expect(heading?.className).not.toMatch(/line-clamp|truncate/);
  expect(heading?.parentElement?.className).not.toContain('h-[48px]');
  const image = host.querySelector('img');
  expect(image?.getAttribute('alt')).toBe(dvdTitle);
  expect(image?.getAttribute('src')).toBe('/local-dvd.webp');
  expect(image?.getAttribute('loading')).toBe('lazy');
  await act(async () => { image?.dispatchEvent(new Event('error')); });
  expect(image?.getAttribute('src')).toBe('/images/placeholder.jpg');
  await act(async () => { link?.click(); });
  expect(host.querySelector('[data-location]')?.textContent).toBe('/producto/' + encodeURIComponent(value.slug ?? ''));
});

test('a catalog card without a slug preserves the product-ID fallback and correctly rounds a variant amount', async () => {
  const value = product(42, { slug: undefined, priceUSD: 999,
    variants: [{ label: { es: 'Modelo', en: '' }, options: [{ value: 'A', priceUSD: 1.999 }] }] });
  const host = await mount(<ProductCard product={value} presentation="catalog" />);
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/producto/product-p42');
  expect(host.querySelector('a')?.textContent).toContain('$2,00');
});

test('a failed catalog fallback image stops assigning src again and retains its accessible title', async () => {
  const value = product(8, { name: dvdTitle, title: { es: dvdTitle, en: '' } });
  const host = await mount(<ProductCard product={value} presentation="catalog" />);
  const image = host.querySelector('img');
  if (!(image instanceof HTMLImageElement)) throw new Error('Missing catalog image');
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver(records => { mutations.push(...records); });
  observer.observe(image, { attributes: true, attributeFilter: ['src'], attributeOldValue: true });
  try {
    await act(async () => { image.dispatchEvent(new Event('error')); });
    mutations.push(...observer.takeRecords());
    expect(image.getAttribute('src')).toBe('/images/placeholder.jpg');
    await act(async () => { image.dispatchEvent(new Event('error')); });
    mutations.push(...observer.takeRecords());
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.oldValue).toBe('/local-dvd.webp');
    expect(image.getAttribute('src')).toBe('/images/placeholder.jpg');
    expect(image.getAttribute('alt')).toBe(dvdTitle);
  } finally { observer.disconnect(); }
});

test('RelatedProducts continues to use the historical default card presentation', async () => {
  const value = product(7, { title: { es: dvdTitle, en: '' }, priceUSD: 999,
    variants: [{ label: { es: 'Modelo', en: '' }, options: [{ value: 'A', priceUSD: 1.5 }] }] });
  boundary.related.mockResolvedValue([value]);
  const host = await mount(<RelatedProducts categoryName="Retro" />);
  expect(boundary.related).toHaveBeenCalledWith('Retro', 8);
  const heading = host.querySelector('h3');
  expect(heading?.className).toContain('line-clamp-2');
  const parts = host.querySelector('.tabular-nums')?.parentElement?.querySelectorAll('span');
  expect(parts).toHaveLength(3);
  expect(parts?.[0]?.textContent?.trim()).toBe('$');
  expect(parts?.[1]?.textContent?.trim()).toBe('1');
  expect(parts?.[2]?.textContent?.trim()).toBe('50');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/producto/juego-7');
});
