/** Raw JSON is retained for preservation; display defaults never become edits. */
import { EDITABLE_FIELDS, MERGED_FIELDS, canonicalJson as canonical } from '../../api/_lib/catalog-edit-fields';
import { mergeCatalogVariants } from '../../api/_lib/catalog-edit-variants';
import { prepareCatalogStockUpdate } from '../../api/_lib/catalog-edit-stock';
export { canonical };
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type CatalogEditDocument = { id: string; version: string; product: JsonObject };
export const catalogEditFields = EDITABLE_FIELDS;
export type CatalogEditField = typeof catalogEditFields[number];
export type CatalogEditChanges = Partial<Record<CatalogEditField, JsonValue>>;
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function isJson(value: unknown): value is JsonValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (Array.isArray(value) && value.every(isJson))
    || (isObject(value) && Object.values(value).every(isJson));
}
export function sameJson(a: JsonValue, b: JsonValue): boolean { return canonical(a) === canonical(b); }
export function parseChanges(value: unknown): CatalogEditChanges {
  if (!isObject(value) || !Object.keys(value).length || Object.keys(value).some(key => !catalogEditFields.some(field => field === key))
    || !Object.values(value).every(isJson)) throw new Error('Los cambios de la publicación no son válidos.');
  const changes: CatalogEditChanges = {};
  for (const field of catalogEditFields) if (Object.prototype.hasOwnProperty.call(value, field)) {
    const item = value[field];
    if (!isJson(item)) throw new Error('El campo editado no es válido.');
    changes[field] = item;
  }
  return changes;
}
/** The server merges only these descriptive objects, preserving legacy keys. */
export function applyCatalogChanges(product: JsonObject, changes: CatalogEditChanges): JsonObject {
  const update: JsonObject = {};
  for (const field of catalogEditFields) {
    const next = changes[field]; if (next === undefined) continue;
    const previous = product[field];
    if (field === 'variants') {
      const merged = mergeCatalogVariants(previous, next);
      if (!isJson(merged)) throw new Error('Variantes inválidas.');
      update[field] = merged; continue;
    }
    update[field] = MERGED_FIELDS.some(item => item === field) && isObject(previous) && isObject(next)
      ? { ...previous, ...next } : next;
  }
  return { ...product, ...update, ...prepareCatalogStockUpdate(product, update) };
}
export function changedFields(product: JsonObject, touched: CatalogEditChanges): CatalogEditChanges {
  const changes: CatalogEditChanges = {};
  const combined = applyCatalogChanges(product, touched);
  for (const field of catalogEditFields) {
    const value = touched[field]; if (value === undefined) continue;
    const next = combined[field];
    if (!Object.prototype.hasOwnProperty.call(product, field) || !sameJson(product[field], next)) changes[field] = value;
  }
  return changes;
}
export function parseCatalogDocument(value: unknown, id: string): CatalogEditDocument {
  if (!isObject(value) || value.id !== id || typeof value.version !== 'string' || !/^\d+:\d{1,9}$/.test(value.version)
    || !isObject(value.product) || !isJson(value.product)
    || !isObject(value.capabilities) || value.capabilities.editExisting !== true) {
    throw new Error('No pudimos comprobar el detalle completo de esta publicación.');
  }
  return { id, version: value.version, product: value.product };
}

export function catalogVersionAfter(current: string, committed: string): boolean {
  if (!/^\d+:\d{1,9}$/.test(current) || !/^\d+:\d{1,9}$/.test(committed)) throw new Error('Versión de publicación inválida.');
  const [seconds, nanos] = current.split(':').map(BigInt);
  const [previousSeconds, previousNanos] = committed.split(':').map(BigInt);
  return seconds > previousSeconds || (seconds === previousSeconds && nanos > previousNanos);
}
