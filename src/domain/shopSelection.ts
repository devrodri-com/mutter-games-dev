import type { Product } from '../data/types';

export type ShopSort = '' | 'az' | 'za' | 'priceAsc' | 'priceDesc';
export type ShopLanguage = 'es' | 'en';
export type ShopIdSelection = string | readonly string[];
export interface ShopCriteria {
  search: string;
  category: ShopIdSelection;
  subcategory: ShopIdSelection;
  type: string;
  sort: ShopSort;
}
export const SHOP_PAGE_SIZE = 24;
export const normalizeShopText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim().replace(/\s+/g, ' ');
export function readShopSort(value: string | null): ShopSort {
  return value === '' || value === 'az' || value === 'za' || value === 'priceAsc' || value === 'priceDesc' ? value : 'az';
}
export function readShopCriteria(search: string): ShopCriteria {
  const p = new URLSearchParams(search);
  const readIds = (key: string): ShopIdSelection => {
    const ids = [...new Set(p.getAll(key).filter(Boolean))];
    return ids.length > 1 ? ids : ids[0] ?? '';
  };
  return { search: p.get('q') ?? '', category: readIds('cat'), subcategory: readIds('sub'), type: p.get('type') || 'Todos', sort: readShopSort(p.get('sort')) };
}
export function shopCriteriaParams(c: ShopCriteria, legacyFilter: string): URLSearchParams {
  const p = new URLSearchParams();
  if (legacyFilter) p.set('filter', legacyFilter);
  if (c.search) p.set('q', c.search);
  const appendIds = (key: string, selection: ShopIdSelection) => {
    for (const id of typeof selection === 'string' ? [selection] : selection) if (id) p.append(key, id);
  };
  appendIds('cat', c.category);
  appendIds('sub', c.subcategory);
  if (c.type && c.type !== 'Todos') p.set('type', c.type);
  if (c.sort) p.set('sort', c.sort);
  return p;
}
// One display-price rule shared by cards and catalog sorting. Checkout stays authoritative.
export function getCatalogDisplayPrice(product: Product): number {
  if (product.variants?.length) {
    const prices = product.variants.flatMap(v => v.options.map(o => Number(o.priceUSD)).filter(p => !Number.isNaN(p)));
    return prices.length ? Math.min(...prices) : product.priceUSD ?? 0;
  }
  return product.priceUSD ?? 0;
}
export function selectShopProducts(products: readonly Product[], criteria: ShopCriteria, language: ShopLanguage): Product[] {
  const search = normalizeShopText(criteria.search);
  const type = normalizeShopText(criteria.type);
  const collator = new Intl.Collator(language, { sensitivity: 'base', numeric: true });
  const title = (p: Product) => p.title[language] || p.name || p.title.es || p.title.en;
  // Repeated IDs are alternatives within a facet; category and subcategory still intersect.
  const matchesId = (selection: ShopIdSelection, id: string) => typeof selection === 'string' ? !selection || selection === id : selection.length === 0 || selection.includes(id);
  return products.filter(p => {
    if (p.active !== true || !matchesId(criteria.category, p.category.id) || !matchesId(criteria.subcategory, p.subcategory.id)) return false;
    if (criteria.type && criteria.type !== 'Todos' && normalizeShopText(p.tipo ?? '') !== type) return false;
    return !search || [p.title.es, p.title.en, p.name].some(text => normalizeShopText(text).includes(search));
  }).sort((a, b) => {
    let order = 0;
    if (criteria.sort === 'priceAsc' || criteria.sort === 'priceDesc') {
      const ap = getCatalogDisplayPrice(a), bp = getCatalogDisplayPrice(b);
      if (Number.isFinite(ap) !== Number.isFinite(bp)) return Number.isFinite(ap) ? -1 : 1;
      if (Number.isFinite(ap) && Number.isFinite(bp)) order = criteria.sort === 'priceAsc' ? ap - bp : bp - ap;
    } else order = collator.compare(title(a), title(b)) * (criteria.sort === 'za' ? -1 : 1);
    return order || collator.compare(title(a), title(b)) || a.id.localeCompare(b.id);
  });
}
