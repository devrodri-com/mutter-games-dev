import { auth } from '../firebase';
import { normalizeCatalogCreate } from '../../api/_lib/catalog-edit-create';
import { catalogCreateHashPayload } from '../../api/_lib/catalog-edit-fields';
import { catalogVersionAfter, canonical, isJson, isObject, parseCatalogDocument, sameJson, type CatalogEditDocument, type JsonObject } from '../domain/catalogEdit';
import { actorForEdit, assertActor, catalogPath, catalogRequest, type Actor } from './catalogTransport';

export class CatalogCreatePendingError extends Error {}
export class CatalogCreateSupersededError extends CatalogCreatePendingError {}
export type CatalogCreateDraft = { id: string; operationId: string; product: JsonObject; imageOperationIds: string[]; pending: boolean };
type Receipt = { status: 'CONFIRMED'; intent: 'create'; id: string; operationId: string; version: string; requestHash: string; product: JsonObject };
type Stored = { schema: 1; uid: string; id: string; operationId: string; product: JsonObject; imageOperationIds: string[];
  phase: 'DRAFT' | 'SENT' | 'CONFIRMED'; receipt?: Receipt };
const key = (uid: string) => `mutter-catalog-create:${uid}`;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function imageIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30 || value.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(value).size !== value.length) throw new Error('Referencias de imagen inválidas.');
  return value.map(String).sort();
}
function read(actor: Actor): Stored | null {
  assertActor(actor); const raw = localStorage.getItem(key(actor.uid)); if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new CatalogCreatePendingError('Conservamos una creación pendiente que necesita revisión.'); }
  if (!isObject(value) || value.schema !== 1 || value.uid !== actor.uid || typeof value.operationId !== 'string'
    || !uuid.test(value.operationId) || value.id !== `admin-${value.operationId}` || !isObject(value.product) || !isJson(value.product)
    || !['DRAFT', 'SENT', 'CONFIRMED'].includes(String(value.phase))) throw new CatalogCreatePendingError('El borrador conservado necesita revisión.');
  const phase = value.phase;
  if (phase !== 'DRAFT' && phase !== 'SENT' && phase !== 'CONFIRMED') throw new CatalogCreatePendingError('Fase de creación inválida.');
  const stored: Stored = { schema: 1, uid: actor.uid, id: value.id, operationId: value.operationId, product: value.product,
    imageOperationIds: imageIds(value.imageOperationIds), phase };
  if (phase === 'CONFIRMED') stored.receipt = parseReceipt(value.receipt, stored);
  return stored;
}
function assertStored(actor: Actor, previous: Stored): void {
  const current = read(actor);
  if (!current || !sameJson(current, previous)) throw new CatalogCreatePendingError('El borrador cambió en otra ventana. Volvé a abrirlo antes de continuar.');
}
function store(actor: Actor, next: Stored, previous?: Stored): void {
  assertActor(actor);
  if (previous) assertStored(actor, previous);
  else if (read(actor)) throw new CatalogCreatePendingError('Ya hay una creación pendiente.');
  localStorage.setItem(key(actor.uid), JSON.stringify(next));
}
const asDraft = (value: Stored): CatalogCreateDraft => ({ id: value.id, operationId: value.operationId,
  product: structuredClone(value.product), imageOperationIds: [...value.imageOperationIds], pending: value.phase !== 'DRAFT' });
export function newCatalogDraft(): CatalogCreateDraft {
  const actor = auth.currentUser;
  if (!actor) throw new Error('Ingresá para crear una publicación.');
  const previous = read(actor); if (previous) return asDraft(previous);
  const operationId = crypto.randomUUID();
  const draft: Stored = { schema: 1, uid: actor.uid, id: `admin-${operationId}`, operationId, phase: 'DRAFT', imageOperationIds: [],
    product: { title: { es: '', en: '' }, description: '', category: { id: '', name: '' }, subcategory: { id: '', name: '' },
      tipo: '', images: [], active: false, variants: [{ label: { es: 'Modelo', en: '' }, options: [{ value: 'Única', priceUSD: 0, stock: 0 }] }],
      sku: '', allowCustomization: false, customName: '', customNumber: '' } };
  store(actor, draft); return asDraft(draft);
}
export function updateCatalogDraft(draft: CatalogCreateDraft, product: JsonObject, images: string[]): void {
  const actor = auth.currentUser;
  if (!actor) throw new Error('Ingresá para conservar el borrador.');
  const previous = read(actor);
  if (!previous || previous.id !== draft.id || previous.operationId !== draft.operationId) throw new CatalogCreatePendingError('No se encontró este borrador.');
  if (previous.phase !== 'DRAFT') throw new CatalogCreatePendingError('Primero comprobá el resultado de la creación anterior.');
  if (!isJson(product)) throw new Error('El borrador no es válido.');
  store(actor, { ...previous, product: structuredClone(product), imageOperationIds: imageIds(images) }, previous);
}
function normalized(stored: Stored): JsonObject {
  const product = normalizeCatalogCreate(stored.product, stored.operationId);
  if (!isJson(product)) throw new Error('La publicación no es válida.');
  return product;
}
function parseReceipt(value: unknown, pending: Stored): Receipt {
  if (!isObject(value) || value.status !== 'CONFIRMED' || value.intent !== 'create' || value.id !== pending.id
    || value.operationId !== pending.operationId || typeof value.version !== 'string' || !/^\d+:\d{1,9}$/.test(value.version)
    || typeof value.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.requestHash)
    || !isObject(value.product) || !isJson(value.product) || !sameJson(value.product, normalized(pending))) throw new CatalogCreatePendingError('El comprobante no coincide con esta publicación. No se repetirá la creación.');
  return { status: 'CONFIRMED', intent: 'create', id: value.id, operationId: value.operationId,
    version: value.version, requestHash: value.requestHash, product: value.product };
}
async function verifyHash(receipt: Receipt, pending: Stored): Promise<void> {
  const bytes = new TextEncoder().encode(canonical(catalogCreateHashPayload(pending.id, { intent: 'create', product: pending.product,
    ...(pending.imageOperationIds.length ? { imageOperationIds: pending.imageOperationIds } : {}) })));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  const digest = Array.from(new Uint8Array(result), n => n.toString(16).padStart(2, '0')).join('');
  if (digest !== receipt.requestHash) throw new CatalogCreatePendingError('No se pudo comprobar el contenido de la creación.');
}
export async function createCatalogPublication(draft: CatalogCreateDraft, product: JsonObject, images: string[]): Promise<CatalogEditDocument> {
  const actor = await actorForEdit(); let pending = read(actor);
  if (!pending || pending.id !== draft.id || pending.operationId !== draft.operationId) throw new CatalogCreatePendingError('El borrador cambió. Volvé a abrirlo.');
  const ids = imageIds(images);
  if (pending.phase === 'DRAFT') {
    updateCatalogDraft(draft, product, ids); pending = read(actor);
    if (!pending) throw new CatalogCreatePendingError('No se conservó el borrador.');
    normalized(pending); // Invalid new publications are rejected before reserving a send.
  } else if (!sameJson(pending.product, product) || !sameJson(pending.imageOperationIds, ids)) throw new CatalogCreatePendingError('Primero comprobá la creación enviada, sin modificar su contenido.');
  const newlySent = pending.phase === 'DRAFT';
  if (newlySent) { const sent: Stored = { ...pending, phase: 'SENT' }; store(actor, sent, pending); pending = sent; }
  try {
    if (pending.phase === 'SENT') {
      const reserved = pending;
      const response = newlySent
        ? await catalogRequest(actor, catalogPath(pending.id), 'POST', JSON.stringify({ intent: 'create', operationId: pending.operationId,
          product: pending.product, ...(ids.length ? { imageOperationIds: ids } : {}) }), () => assertStored(actor, reserved))
        : await catalogRequest(actor, catalogPath(pending.id, pending.operationId), 'GET', undefined, () => assertStored(actor, reserved));
      if (newlySent && response.status >= 400 && response.status < 500 && isObject(response.value) && response.value.applied === false) {
        assertStored(actor, pending);
        localStorage.setItem(`${key(actor.uid)}:history:${pending.operationId}`, JSON.stringify({ ...pending, rejected: response.value }));
        store(actor, { ...pending, phase: 'DRAFT' }, pending);
        throw new Error(typeof response.value.error === 'string' ? response.value.error : 'No se creó la publicación.');
      }
      if (response.status !== 200 && response.status !== 201) throw new CatalogCreatePendingError('La creación sigue sin confirmar. El próximo intento sólo comprobará su resultado.');
      const receipt = parseReceipt(response.value, pending); await verifyHash(receipt, pending); assertActor(actor);
      const confirmed: Stored = { ...pending, phase: 'CONFIRMED', receipt }; store(actor, confirmed, pending); pending = confirmed;
    }
    const receipt = parseReceipt(pending.receipt, pending); await verifyHash(receipt, pending);
    const observed = await catalogRequest(actor, catalogPath(pending.id));
    if (observed.status !== 200) throw new CatalogCreatePendingError('Se recibió el comprobante, pero falta releer la publicación. No se repetirá su creación.');
    const current = parseCatalogDocument(observed.value, pending.id);
    if (catalogVersionAfter(current.version, receipt.version)) throw new CatalogCreateSupersededError('La publicación se creó y luego recibió otra edición. Abrí su versión actual; no se creará otra.');
    if (current.version !== receipt.version || !sameJson(current.product, receipt.product)) throw new CatalogCreatePendingError('La publicación ya existe, pero cambió durante la comprobación. No se volverá a crear ni sobrescribir.');
    assertStored(actor, pending);
    localStorage.setItem(`${key(actor.uid)}:history:${pending.operationId}`, JSON.stringify(pending));
    localStorage.removeItem(key(actor.uid)); return current;
  } catch (error: unknown) {
    if (error instanceof CatalogCreatePendingError) throw error;
    if (read(actor)?.phase !== 'DRAFT') throw new CatalogCreatePendingError('No terminó la comprobación. Conservamos el intento y no volveremos a enviarlo.');
    throw error;
  }
}

/** An explicit user action resolves a confirmed creation followed by another
 * legitimate edit; the original receipt remains archived and no POST is sent. */
export async function reopenSupersededCatalogCreate(draft: CatalogCreateDraft): Promise<CatalogEditDocument> {
  const actor = await actorForEdit(), pending = read(actor);
  if (!pending || pending.phase !== 'CONFIRMED' || pending.id !== draft.id || pending.operationId !== draft.operationId) throw new CatalogCreatePendingError('Primero comprobá la creación pendiente.');
  const receipt = parseReceipt(pending.receipt, pending); await verifyHash(receipt, pending); assertActor(actor);
  const observed = await catalogRequest(actor, catalogPath(pending.id));
  if (observed.status !== 200) throw new CatalogCreatePendingError('No se pudo abrir la versión actual.');
  const current = parseCatalogDocument(observed.value, pending.id);
  if (!catalogVersionAfter(current.version, receipt.version)) throw new CatalogCreatePendingError('No se comprobó una edición posterior.');
  assertStored(actor, pending);
  localStorage.setItem(`${key(actor.uid)}:history:${pending.operationId}`, JSON.stringify({ ...pending, supersededByVersion: current.version }));
  localStorage.removeItem(key(actor.uid)); return current;
}
