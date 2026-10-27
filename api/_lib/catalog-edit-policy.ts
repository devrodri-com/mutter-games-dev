import { createHash } from 'node:crypto';
import type { DocumentSnapshot, Timestamp } from 'firebase-admin/firestore';
import { EDITABLE_FIELDS, MERGED_FIELDS, inertDescription, canonicalJson as canonical, catalogEditHashPayload } from './catalog-edit-fields.js';
import { assertVariantReservationIdentity, mergeCatalogVariants } from './catalog-edit-variants.js';
import { assertCatalogClassificationPair } from './catalog-edit-classification.js';
import { prepareCatalogStockUpdate } from './catalog-edit-stock.js';
export { EDITABLE_FIELDS, MERGED_FIELDS } from './catalog-edit-fields.js';

export class CatalogEditError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function invalid(message = 'Revisá los datos de la edición.'): never {
  throw new CatalogEditError(400, 'INVALID_CATALOG_EDIT', message);
}
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export type EditRequest = { version: string; intent: 'edit'; operationId: string; changes: Record<string, unknown>; imageOperationIds?: string[] };
export function productId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 200) invalid('Publicación inválida.');
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 47 || code < 32 || code === 127) invalid('Publicación inválida.');
  }
  return value;
}
export function operationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) invalid('Identificador de guardado inválido.');
  return value;
}
function text(value: unknown, maximum = 100000): value is string {
  return typeof value === 'string' && value.length <= maximum;
}
export function imageOperations(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30) invalid('Recibos de imagen inválidos.');
  const ids = value.map(operationId);
  if (new Set(ids).size !== ids.length) invalid('Recibos de imagen duplicados.');
  return ids.sort();
}
export function parseEditRequest(value: unknown): EditRequest {
  const body: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!object(body) || Object.keys(body).some(key => !['changes', 'intent', 'operationId', 'version', 'imageOperationIds'].includes(key))
    || body.intent !== 'edit' || typeof body.version !== 'string' || !/^\d+:\d{1,9}$/.test(body.version)
    || !object(body.changes) || !Object.keys(body.changes).length) invalid();
  const id = operationId(body.operationId);
  for (const [field, value] of Object.entries(body.changes)) {
    if (!EDITABLE_FIELDS.some(allowed => field === allowed)) invalid('Ese campo no se puede cambiar en esta edición.');
    if (field === 'title' || field === 'description') {
      const maximum = field === 'title' ? 2000 : 100000;
      if (typeof value === 'string') { if (!text(value, maximum) || (field === 'title' && !value.trim())) invalid('Texto inválido.'); }
      else if (!object(value) || !Object.keys(value).length || Object.keys(value).some(key => !['es', 'en'].includes(key))
        || Object.values(value).some(part => !text(part, maximum))) invalid('Texto inválido.');
      if (field === 'description') {
        const parts = typeof value === 'string' ? [value] : Object.values(value);
        if (parts.some(part => typeof part !== 'string' || !inertDescription(part)))
          invalid('La descripción admite texto y formato básico sin enlaces, colores ni atributos. Los demás cambios pueden guardarse conservando la descripción original.');
      }
    } else if (field === 'category' || field === 'subcategory') {
      if (!object(value) || !Object.keys(value).length
        || Object.keys(value).some(key => !['id', 'name', 'categoryId'].includes(key))
        || Object.values(value).some(part => !text(part, 2000))) invalid('Clasificación inválida.');
    } else if (field === 'images') {
      if (!Array.isArray(value) || !value.length || value.length > 30 || value.some(url => !text(url, 2048))) invalid('Imágenes inválidas.');
    } else if (field === 'variants') {
      // Values are checked against the actual stored variants in the transaction.
      // A legacy invalid value that the user did not touch must not block a price edit.
      if (!Array.isArray(value) || value.length > 100 || value.some(part => !object(part))) invalid('Variantes inválidas.');
    } else if (field === 'stockTotal') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid('El stock debe ser un entero igual o mayor que cero.');
    } else if (field === 'priceUSD') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid('Precio inválido.');
    } else if (field === 'allowCustomization') {
      if (typeof value !== 'boolean') invalid('Personalización inválida.');
    } else if (field === 'descriptionPosition') {
      if (value !== 'top' && value !== 'bottom') invalid('Posición inválida.');
    } else if (!text(value)) invalid('Texto inválido.');
  }
  return { version: body.version, intent: 'edit', operationId: id, changes: structuredClone(body.changes),
    ...(body.imageOperationIds === undefined ? {} : { imageOperationIds: imageOperations(body.imageOperationIds) }) };
}
export function timestampVersion(time: Timestamp | undefined): string {
  if (!time) throw new CatalogEditError(503, 'CATALOG_VERSION_UNAVAILABLE', 'No pudimos comprobar la versión guardada.');
  return `${time.seconds}:${time.nanoseconds}`;
}
export function productVersion(snapshot: DocumentSnapshot): string {
  if (!snapshot.exists) throw new CatalogEditError(404, 'PRODUCT_NOT_FOUND', 'La publicación no existe.');
  // Firestore commit time is authoritative; legacy fields called version or
  // webCatalogVersion remain ordinary preserved document contents.
  return timestampVersion(snapshot.updateTime);
}
type CatalogUpdateValue = string | number | boolean | Record<string, unknown> | unknown[];
export function editUpdate(snapshot: DocumentSnapshot, request: EditRequest): Record<string, CatalogUpdateValue> {
  if (productVersion(snapshot) !== request.version) throw new CatalogEditError(409, 'PRODUCT_VERSION_CONFLICT',
    'La publicación cambió mientras la editabas. Conservá tu texto y volvé a abrirla antes de guardar.');
  const current = snapshot.data();
  if (!current) throw new CatalogEditError(404, 'PRODUCT_NOT_FOUND', 'La publicación no existe.');
  const update: Record<string, CatalogUpdateValue> = {};
  for (const [key, value] of Object.entries(request.changes)) {
    if (key === 'variants') {
      try { update.variants = mergeCatalogVariants(current.variants, value); assertVariantReservationIdentity(current, update.variants); }
      catch (error: unknown) { invalid(error instanceof Error ? error.message : 'Variantes inválidas.'); }
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' && !object(value) && !Array.isArray(value)) invalid();
    if ((key === 'title' || key === 'description') && object(current[key]) && typeof value === 'string')
      invalid('Conservá los idiomas existentes y enviá sólo el texto del idioma editado.');
    update[key] = MERGED_FIELDS.some(field => field === key) && object(value)
      ? { ...(object(current[key]) ? current[key] : {}), ...value } : value;
  }
  if ('title' in update) {
    const title = update.title;
    if (typeof title === 'string' ? !title.trim() : !object(title)
      || ![title.es, title.en].some(value => typeof value === 'string' && value.trim())) invalid('Título requerido.');
  }
  if ('category' in update || 'subcategory' in update) {
    try {
      assertCatalogClassificationPair('category' in update ? update.category : current.category,
        'subcategory' in update ? update.subcategory : current.subcategory);
    } catch (error: unknown) { invalid(error instanceof Error ? error.message : 'Clasificación inválida.'); }
  }
  try { Object.assign(update, prepareCatalogStockUpdate(current, update)); }
  catch (error: unknown) { invalid(error instanceof Error ? error.message : 'Stock inválido.'); }
  // No whole-document replacement, inventory normalization or implicit metadata
  // changes. Firestore updateTime and the separate receipt identify this commit.
  return update;
}
export { canonicalJson as canonical } from './catalog-edit-fields.js';
export function requestHash(id: string, request: EditRequest): string {
  return createHash('sha256').update(canonical(catalogEditHashPayload(id, request))).digest('hex');
}
export function receiptPath(uid: string, id: string): string {
  return `adminProductOperations/${createHash('sha256').update(uid).digest('hex')}-${operationId(id)}`;
}
