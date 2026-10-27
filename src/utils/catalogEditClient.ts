import { catalogEditHashPayload } from '../../api/_lib/catalog-edit-fields';
import { actorForEdit, assertActor, catalogPath as path, catalogRequest as request, type Actor } from './catalogTransport';
import { applyCatalogChanges, catalogVersionAfter, canonical, isObject, isJson, parseCatalogDocument, parseChanges, sameJson,
  type CatalogEditChanges, type CatalogEditDocument } from '../domain/catalogEdit';

type Receipt = { status: 'CONFIRMED'; id: string; operationId: string; version: string;
  baseVersion: string; changes: CatalogEditChanges; requestHash: string };
type Pending = { schema: 1; uid: string; document: CatalogEditDocument; operationId: string;
  changes: CatalogEditChanges; imageOperationIds?: string[]; phase: 'SENT' | 'CONFIRMED'; receipt?: Receipt };
export type CatalogEditOpen = { document: CatalogEditDocument; changes: CatalogEditChanges; pending: boolean; imageOperationIds?: string[] };
export class CatalogEditPendingError extends Error {}
export class CatalogEditSupersededError extends CatalogEditPendingError {}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function parseImageIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30 || value.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(value).size !== value.length) throw new Error('Referencias de imagen inválidas.');
  return value.map(String).sort();
}
const key = (uid: string, id: string) => `mutter-catalog-edit:${uid}:${id}`;
function readPending(uid: string, id: string): Pending | null {
  const raw = localStorage.getItem(key(uid, id)); if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Hay un guardado pendiente que necesita revisión. No se enviará otro.'); }
  if (!isObject(value) || value.schema !== 1 || value.uid !== uid || typeof value.operationId !== 'string'
    || !uuid.test(value.operationId) || !isObject(value.document) || value.document.id !== id
    || typeof value.document.version !== 'string' || !/^\d+:\d{1,9}$/.test(value.document.version)
    || !isObject(value.document.product) || !isJson(value.document.product)
    || !['SENT', 'CONFIRMED'].includes(String(value.phase))) throw new Error('El guardado pendiente necesita revisión.');
  const pending: Pending = { schema: 1, uid, operationId: value.operationId,
    document: { id, version: value.document.version, product: value.document.product },
    changes: parseChanges(value.changes), phase: value.phase === 'CONFIRMED' ? 'CONFIRMED' : 'SENT' };
  if (value.imageOperationIds !== undefined) pending.imageOperationIds = parseImageIds(value.imageOperationIds);
  if (pending.phase === 'CONFIRMED') pending.receipt = parseReceipt(value.receipt, pending);
  return pending;
}
function assertPending(actor: Actor, pending: Pending): void {
  assertActor(actor); const stored = readPending(actor.uid, pending.document.id);
  if (!stored || stored.operationId !== pending.operationId || stored.phase !== pending.phase
    || stored.document.version !== pending.document.version || !sameJson(stored.document.product, pending.document.product)
    || !sameJson(stored.imageOperationIds ?? [], pending.imageOperationIds ?? []) || !sameJson(stored.changes, pending.changes) || !sameJson(stored.receipt ?? null, pending.receipt ?? null)) {
    throw new CatalogEditPendingError('Cambió el guardado pendiente en otra ventana. Cerrá y volvé a abrir la publicación para comprobarlo.');
  }
}
function store(actor: Actor, pending: Pending, previous?: Pending): void {
  assertActor(actor);
  if (previous) assertPending(actor, previous);
  else if (readPending(actor.uid, pending.document.id)) throw new CatalogEditPendingError('Hay otro guardado pendiente. Volvé a abrir la publicación.');
  localStorage.setItem(key(actor.uid, pending.document.id), JSON.stringify(pending));
}
function parseReceipt(value: unknown, pending: Pending): Receipt {
  if (!isObject(value) || value.status !== 'CONFIRMED' || value.id !== pending.document.id
    || value.operationId !== pending.operationId || value.baseVersion !== pending.document.version
    || typeof value.version !== 'string' || !/^\d+:\d{1,9}$/.test(value.version) || value.version === value.baseVersion
    || typeof value.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.requestHash)) {
    throw new CatalogEditPendingError('La confirmación no coincide con este guardado. No se enviará otro.');
  }
  const changes = parseChanges(value.changes);
  if (!sameJson(changes, pending.changes)) throw new CatalogEditPendingError('La confirmación contiene cambios distintos. No se enviará otro.');
  return { status: 'CONFIRMED', id: value.id, operationId: value.operationId, version: value.version,
    baseVersion: value.baseVersion, changes, requestHash: value.requestHash };
}
async function validateHash(receipt: Receipt, pending: Pending): Promise<void> {
  const bytes = new TextEncoder().encode(canonical(catalogEditHashPayload(pending.document.id, {version: pending.document.version, intent: 'edit', changes: pending.changes, ...(pending.imageOperationIds?.length ? {imageOperationIds: pending.imageOperationIds} : {}) })));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const expected = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (receipt.requestHash !== expected) throw new CatalogEditPendingError('El comprobante no corresponde a estos cambios.');
}
async function readDocument(actor: Actor, id: string): Promise<CatalogEditDocument> {
  const response = await request(actor, path(id));
  if (response.status !== 200) throw new Error('No pudimos releer la publicación. Conservá los cambios y comprobá su estado.');
  return parseCatalogDocument(response.value, id);
}
export async function openCatalogEdit(id: string): Promise<CatalogEditOpen> {
  const actor = await actorForEdit();
  const current = await readDocument(actor, id), pending = readPending(actor.uid, id); assertActor(actor);
  return pending ? { document: pending.document, changes: pending.changes, pending: true, ...(pending.imageOperationIds?.length ? {imageOperationIds: pending.imageOperationIds} : {}) }
    : { document: current, changes: {}, pending: false };
}
/** An explicit user action keeps the original receipt and starts from a fresh
 * document after a confirmed save was superseded. It never resends the save. */
export async function reopenSupersededCatalogEdit(id: string): Promise<CatalogEditOpen> {
  const actor = await actorForEdit(), pending = readPending(actor.uid, id);
  if (!pending || pending.phase !== 'CONFIRMED') throw new Error('Primero comprobá el guardado pendiente.');
  const receipt = parseReceipt(pending.receipt, pending); await validateHash(receipt, pending); assertActor(actor);
  const current = await readDocument(actor, id);
  if (!catalogVersionAfter(current.version, receipt.version)) throw new Error('Todavía no se comprobó una edición posterior.');
  assertPending(actor, pending);
  localStorage.setItem(`${key(actor.uid, id)}:history:${pending.operationId}`, JSON.stringify({ ...pending,
    supersededByVersion: current.version }));
  localStorage.removeItem(key(actor.uid, id));
  return { document: current, changes: {}, pending: false };
}
export async function saveCatalogEdit(document: CatalogEditDocument, input: CatalogEditChanges, imageIds: string[] = []): Promise<CatalogEditDocument> {
  const actor = await actorForEdit(), storageKey = key(actor.uid, document.id);
  let pending = readPending(actor.uid, document.id);
  const changes = parseChanges(input), imageOperationIds = parseImageIds(imageIds);
  if (pending && (!sameJson(pending.imageOperationIds ?? [], imageOperationIds) || !sameJson(pending.changes, changes) || pending.document.version !== document.version
    || !sameJson(pending.document.product, document.product))) {
    throw new CatalogEditPendingError('Hay un guardado anterior pendiente. Comprobalo antes de cambiar otros campos.');
  }
  let newlySent = false;
  if (!pending) {
    pending = { schema: 1, uid: actor.uid, document, changes, ...(imageOperationIds.length ? {imageOperationIds} : {}), operationId: crypto.randomUUID(), phase: 'SENT' };
    store(actor, pending); newlySent = true;
  }
  try {
    if (pending.phase === 'SENT') {
      const reserved = pending;
      const response = newlySent
        ? await request(actor, path(document.id), 'PATCH', JSON.stringify({ intent: 'edit', version: document.version,
          operationId: pending.operationId, changes, ...(imageOperationIds.length ? {imageOperationIds} : {}) }), () => assertPending(actor, reserved))
        : await request(actor, path(document.id, pending.operationId), 'GET', undefined, () => assertPending(actor, reserved));
      if (newlySent && response.status >= 400 && response.status < 500 && isObject(response.value) && response.value.applied === false) {
        assertPending(actor, pending); localStorage.removeItem(storageKey);
        throw new Error(typeof response.value.error === 'string' ? response.value.error : 'No se aplicó el cambio.');
      }
      if (response.status !== 200) throw new CatalogEditPendingError('El guardado sigue sin confirmar. Comprobá su estado; no se enviará otra vez.');
      const receipt = parseReceipt(response.value, pending); await validateHash(receipt, pending); assertActor(actor);
      const confirmed: Pending = { ...pending, phase: 'CONFIRMED', receipt }; store(actor, confirmed, pending); pending = confirmed;
    }
    const receipt = parseReceipt(pending.receipt, pending); await validateHash(receipt, pending); assertActor(actor);
    const current = await readDocument(actor, document.id);
    if (catalogVersionAfter(current.version, receipt.version)) {
      throw new CatalogEditSupersededError('Se confirmó el guardado; después hubo otra edición. Abrí la versión actual para revisarla.');
    }
    if (current.version !== receipt.version || !sameJson(current.product, applyCatalogChanges(document.product, changes))) {
      throw new CatalogEditPendingError('El guardado tiene comprobante, pero la relectura no coincide. No se repetirá ni se sobrescribirá otro cambio.');
    }
    assertPending(actor, pending); localStorage.removeItem(storageKey); return current;
  } catch (error: unknown) {
    if (error instanceof CatalogEditPendingError) throw error;
    if (localStorage.getItem(storageKey)) throw new CatalogEditPendingError(error instanceof CatalogEditPendingError ? error.message
      : 'No pudimos completar la comprobación del guardado. Conservamos los cambios; el próximo intento sólo consultará su estado.');
    throw error;
  }
}
