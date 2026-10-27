import { inertDescription } from './catalog-edit-fields.js';
import { mergeCatalogVariants } from './catalog-edit-variants.js';
import { assertCatalogClassificationPair } from './catalog-edit-classification.js';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(message = 'Revisá los datos de la nueva publicación.'): never { throw new Error(message); }
function text(value: unknown, maximum = 100000): string {
  if (typeof value !== 'string' || value.length > maximum) fail();
  return value;
}
function localized(value: unknown, required: boolean): unknown {
  if (typeof value === 'string') {
    if (required && !value.trim()) fail('El título es obligatorio.');
    return text(value, required ? 2000 : 100000);
  }
  if (!record(value) || !Object.keys(value).length || Object.keys(value).some(key => !['es', 'en'].includes(key))) fail();
  for (const part of Object.values(value)) text(part, required ? 2000 : 100000);
  if (required && !Object.values(value).some(part => typeof part === 'string' && part.trim())) fail('El título es obligatorio.');
  return structuredClone(value);
}
export function validCatalogImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash && url.href === value; }
  catch { return false; }
}
export function catalogCreationKeys(title: unknown, operationId: string): { slug: string; sortKey: string } {
  const label = typeof title === 'string' ? title : record(title)
    ? typeof title.es === 'string' && title.es.trim() ? title.es : text(title.en) : fail();
  const normalized = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const stem = normalized.trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'publicacion';
  return { slug: `${stem}-${operationId}`, sortKey: normalized.replace(/\s+/g, '').replace(/[^a-z0-9]/g, '') };
}
/** Deterministic browser/server contract for a new document: routing keys and
 * totals follow its supplied options. No existing publication is normalized. */
export function normalizeCatalogCreate(input: unknown, operationId: string): Record<string, unknown> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(operationId) || !record(input)) fail();
  const allowed = ['title', 'description', 'category', 'subcategory', 'tipo', 'subtitle', 'defaultDescriptionType',
    'extraDescriptionTop', 'extraDescriptionBottom', 'descriptionPosition', 'sku', 'customName', 'customNumber',
    'allowCustomization', 'images', 'variants', 'priceUSD', 'stockTotal', 'active', 'slug', 'sortKey'];
  if (Object.keys(input).some(key => !allowed.includes(key))) fail('La publicación contiene un campo no permitido.');
  const product = structuredClone(input);
  product.title = localized(product.title, true);
  if (product.description !== undefined) {
    product.description = localized(product.description, false);
    const parts = typeof product.description === 'string' ? [product.description]
      : record(product.description) ? Object.values(product.description) : [];
    if (parts.some(part => typeof part !== 'string' || !inertDescription(part))) fail('La descripción admite texto y formato básico seguro.');
  }
  for (const key of ['category', 'subcategory']) {
    const classification = product[key];
    if (!record(classification) || Object.keys(classification).some(field => !['id', 'name', 'categoryId'].includes(field)))
      fail('Elegí la categoría y subcategoría.');
    for (const part of Object.values(classification)) text(part, 2000);
  }
  assertCatalogClassificationPair(product.category, product.subcategory);
  if (typeof product.active !== 'boolean') fail('Elegí el estado inicial de la publicación.');
  if (!Array.isArray(product.images) || !product.images.length || product.images.length > 30
    || product.images.some(image => !validCatalogImageUrl(image)) || new Set(product.images).size !== product.images.length) fail('Agregá imágenes confirmadas para esta publicación.');
  if (product.variants !== undefined) product.variants = mergeCatalogVariants(undefined, product.variants, true);
  if (product.priceUSD !== undefined && (typeof product.priceUSD !== 'number' || !Number.isFinite(product.priceUSD) || product.priceUSD < 0)) fail('Precio inválido.');
  if (product.priceUSD === undefined && (!Array.isArray(product.variants) || !product.variants.length)) fail('Agregá un precio o las variantes de la publicación.');
  if (product.stockTotal !== undefined && (typeof product.stockTotal !== 'number' || !Number.isSafeInteger(product.stockTotal) || product.stockTotal < 0)) fail('Cantidad inválida.');
  if (Array.isArray(product.variants) && product.variants.length) {
    const options: Record<string, unknown>[] = [];
    for (const variant of product.variants) {
      if (!record(variant) || !Array.isArray(variant.options)) fail();
      for (const option of variant.options) { if (!record(option)) fail(); options.push(option); }
    }
    const prices: number[] = [], quantities: number[] = [];
    for (const option of options) {
      if (typeof option.priceUSD !== 'number' || typeof option.stock !== 'number') fail();
      prices.push(option.priceUSD); quantities.push(option.stock);
    }
    product.priceUSD = Math.min(...prices);
    product.stockTotal = quantities.reduce((sum, quantity) => sum + quantity, 0);
    if (!Number.isSafeInteger(product.stockTotal)) fail('La cantidad total no es válida.');
  } else if (product.stockTotal === undefined) product.stockTotal = 0;
  if (product.allowCustomization !== undefined && typeof product.allowCustomization !== 'boolean') fail();
  if (product.descriptionPosition !== undefined && product.descriptionPosition !== 'top' && product.descriptionPosition !== 'bottom') fail();
  for (const key of ['tipo', 'subtitle', 'defaultDescriptionType', 'extraDescriptionTop', 'extraDescriptionBottom', 'sku', 'customName', 'customNumber'])
    if (product[key] !== undefined) text(product[key]);
  const routing = catalogCreationKeys(product.title, operationId);
  if (product.slug !== undefined && product.slug !== routing.slug || product.sortKey !== undefined && product.sortKey !== routing.sortKey) fail('La ruta de la nueva publicación no corresponde a esta operación.');
  return { ...product, ...routing };
}
