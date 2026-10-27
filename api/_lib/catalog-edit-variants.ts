import { canonicalJson } from './catalog-edit-fields.js';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(): never { throw new Error('Conservá las opciones e identificadores; el stock debe ser un entero igual o mayor que cero.'); }
const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
function text(value: unknown, maximum = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail();
  return value;
}
function price(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail();
  return value;
}
function mergeLabel(previous: unknown, incoming: unknown): unknown {
  if (equal(previous ?? null, incoming)) return previous;
  if (!record(incoming) || !Object.keys(incoming).length) fail();
  const old = record(previous) ? previous : {};
  const next = { ...old };
  for (const [key, value] of Object.entries(incoming)) {
    if (Object.hasOwn(old, key) && equal(old[key], value)) continue;
    if (!['es', 'en'].includes(key) || typeof value !== 'string' || value.length > 2000) fail();
    next[key] = value;
  }
  if (![next.es, next.en].some(value => typeof value === 'string' && value.trim())) fail();
  return next;
}
function mergeOption(previous: unknown, incoming: unknown, creating: boolean): Record<string, unknown> {
  if (!record(incoming) || previous !== undefined && !record(previous)) fail();
  const old = record(previous) ? previous : {}, next = { ...old };
  for (const [key, value] of Object.entries(incoming)) {
    if (Object.hasOwn(old, key) && equal(old[key], value)) continue;
    if (key === 'value') next[key] = text(value);
    else if (key === 'priceUSD') next[key] = price(value);
    else if (key === 'stock' && typeof value === 'number'
      && Number.isSafeInteger(value) && value >= 0) next[key] = value;
    else fail();
  }
  if (previous === undefined) { text(next.value); price(next.priceUSD); if (creating && next.stock === undefined) next.stock = 0; }
  return next;
}
/** Indexes are stable identities. Missing fields merge, omitted entries never delete.
 * Unknown fields are preserved; explicit stock changes are admitted against
 * authoritative reservations by prepareCatalogStockUpdate in the transaction. */
export function mergeCatalogVariants(previous: unknown, incoming: unknown, creating = false): Record<string, unknown>[] {
  if (!Array.isArray(incoming) || incoming.length > 100) fail();
  const before = previous === undefined ? [] : previous;
  if (!Array.isArray(before) || incoming.length < before.length) fail();
  return incoming.map((raw, index) => {
    const oldRaw: unknown = before[index];
    if (!record(raw) || oldRaw !== undefined && !record(oldRaw)) fail();
    const old = record(oldRaw) ? oldRaw : {}, next = { ...old };
    for (const [key, value] of Object.entries(raw)) {
      if (Object.hasOwn(old, key) && equal(old[key], value)) continue;
      if (key === 'label') next.label = mergeLabel(old.label, value);
      else if (key === 'options') {
        if (!Array.isArray(value) || !value.length || value.length > 100) fail();
        const oldOptions = old.options === undefined ? [] : old.options;
        if (!Array.isArray(oldOptions) || value.length < oldOptions.length) fail();
        next.options = value.map((option, position) => mergeOption(oldOptions[position], option, creating));
      } else fail();
    }
    if (oldRaw === undefined) {
      next.label = mergeLabel(undefined, next.label);
      if (!Array.isArray(next.options) || !next.options.length) fail();
    }
    return next;
  });
}
/** Pending reservations bind option positions and labels. Price edits remain safe
 * even when legacy reservation metadata cannot be interpreted. */
export function assertVariantReservationIdentity(current: Record<string, unknown>, next: unknown): void {
  if (current.webReservations === undefined || record(current.webReservations) && !Object.keys(current.webReservations).length) return;
  const identities = (value: unknown): unknown => Array.isArray(value) ? value.map(raw => {
    if (!record(raw)) return raw;
    return { label: raw.label ?? null, options: Array.isArray(raw.options) ? raw.options.map(option => {
      if (!record(option)) return option;
      const identity = { ...option };
      delete identity.priceUSD;
      delete identity.stock;
      return identity;
    }) : raw.options ?? null };
  }) : value ?? null;
  if (!equal(identities(current.variants), identities(next)))
    throw new Error('Esta publicación tiene reservas pendientes. Conservá los nombres y opciones; podés editar precios y stock respetando las unidades reservadas.');
}
