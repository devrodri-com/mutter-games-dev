import { auth } from '../firebase';
import { archiveChangeSet, catalogArchiveHashPayload, type ArchiveChanges, type ArchiveIntent } from '../../api/_lib/catalog-archive-fields';
import { canonical, catalogVersionAfter, isJson, isObject, parseCatalogDocument, sameJson, type CatalogEditDocument } from '../domain/catalogEdit';
import { actorForEdit, assertActor, catalogPath, catalogRequest, type Actor } from './catalogTransport';

export type { ArchiveIntent };
export type ArchivePrepared = { uid: string; intent: ArchiveIntent; document: CatalogEditDocument };
type Receipt = { status: 'CONFIRMED'; kind: 'CATALOG_ARCHIVE_V1'; id: string; operationId: string; intent: ArchiveIntent;
  version: string; baseVersion: string; changes: ArchiveChanges; requestHash: string };
type Journal = ArchivePrepared & { schema: 1; operationId: string; changes: ArchiveChanges; phase: 'SENT' | 'CONFIRMED'; receipt?: Receipt };
export type ArchiveOutcome = { id: string; intent: ArchiveIntent; message: string } & (
  { status: 'success'; document: CatalogEditDocument; superseded: boolean; journalRetained?: boolean }
  | { status: 'known_failure' | 'uncertain' | 'not_sent' });
export type ArchivePending = { pending: boolean; foreign: boolean; invalid: boolean; intent?: ArchiveIntent };
export const ARCHIVE_JOURNAL_EVENT = 'mutter-catalog-archive-change';
const prefix = 'mutter-catalog-archive:';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const version = /^\d+:\d{1,9}$/;
const storageKey = (id: string) => { catalogPath(id); return prefix + encodeURIComponent(id); };
const changed = () => window.dispatchEvent(new Event(ARCHIVE_JOURNAL_EVENT));
function parseReceipt(value: unknown, pending: Journal): Receipt {
  if (!isObject(value) || value.status !== 'CONFIRMED' || value.kind !== 'CATALOG_ARCHIVE_V1'
    || value.id !== pending.document.id || value.operationId !== pending.operationId || value.intent !== pending.intent
    || value.baseVersion !== pending.document.version || typeof value.version !== 'string' || !version.test(value.version)
    || !catalogVersionAfter(value.version, value.baseVersion) || typeof value.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.requestHash)
    || !isObject(value.changes) || !isJson(value.changes) || !sameJson(value.changes, pending.changes)) {
    throw new Error('El comprobante no coincide con esta operación. Consultá su resultado antes de continuar.');
  }
  return { status: 'CONFIRMED', kind: 'CATALOG_ARCHIVE_V1', id: value.id, operationId: value.operationId,
    intent: pending.intent, version: value.version, baseVersion: value.baseVersion, changes: pending.changes, requestHash: value.requestHash };
}
function read(id: string): { value: Journal; bytes: string } | null {
  const bytes = localStorage.getItem(storageKey(id)); if (bytes === null) return null;
  let value: unknown;
  try { value = JSON.parse(bytes); } catch { throw new Error('La operación guardada necesita revisión. No se enviará otra.'); }
  if (!isObject(value) || value.schema !== 1 || typeof value.uid !== 'string' || !value.uid
    || (value.intent !== 'withdraw' && value.intent !== 'restore') || typeof value.operationId !== 'string' || !uuid.test(value.operationId)
    || !isObject(value.document) || value.document.id !== id || typeof value.document.version !== 'string' || !version.test(value.document.version)
    || !isObject(value.document.product) || !isJson(value.document.product) || (value.phase !== 'SENT' && value.phase !== 'CONFIRMED')
    || !isObject(value.changes) || !isJson(value.changes)) throw new Error('La operación guardada necesita revisión.');
  const document = { id, version: value.document.version, product: value.document.product };
  const changes = archiveChangeSet(document.product, value.intent);
  if (!sameJson(changes, value.changes)) throw new Error('Los cambios guardados necesitan revisión.');
  const pending: Journal = { schema: 1, uid: value.uid, intent: value.intent, operationId: value.operationId,
    document, changes, phase: value.phase };
  if (pending.phase === 'CONFIRMED') pending.receipt = parseReceipt(value.receipt, pending);
  return { value: pending, bytes };
}
export function catalogArchivePending(id: string): ArchivePending {
  try {
    const pending = read(id);
    return pending ? { pending: true, foreign: pending.value.uid !== auth.currentUser?.uid, invalid: false, intent: pending.value.intent }
      : { pending: false, foreign: false, invalid: false };
  } catch { return { pending: true, foreign: false, invalid: true }; }
}
export function catalogArchivePendingIds(): string[] {
  const ids: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const name = localStorage.key(index);
    if (!name?.startsWith(prefix) || name.includes(':history:')) continue;
    const suffix = name.slice(prefix.length);
    try { const id = decodeURIComponent(suffix); if (storageKey(id) === name) ids.push(id); }
    catch { throw new Error('Hay una referencia de operación guardada que necesita revisión.'); }
  }
  return ids;
}
function fence(actor: Actor, pending: Journal, guard: () => void): string {
  assertActor(actor); guard();
  const current = read(pending.document.id);
  if (!current || current.value.uid !== actor.uid || !sameJson(current.value, pending)) throw new Error('La operación cambió en otra ventana. Consultá su resultado.');
  return current.bytes;
}
function save(actor: Actor, pending: Journal, guard: () => void, previous?: Journal): void {
  assertActor(actor); guard();
  if (previous) fence(actor, previous, guard);
  else if (localStorage.getItem(storageKey(pending.document.id)) !== null) throw new Error('Ya hay una operación pendiente para esta publicación.');
  localStorage.setItem(storageKey(pending.document.id), JSON.stringify(pending)); changed();
}
function finish(actor: Actor, pending: Journal, result: object, guard: () => void): void {
  const current = fence(actor, pending, guard);
  localStorage.setItem(storageKey(pending.document.id) + ':history:' + pending.operationId, JSON.stringify({ ...pending, ...result }));
  assertActor(actor); guard();
  if (localStorage.getItem(storageKey(pending.document.id)) !== current) throw new Error('La operación cambió mientras se comprobaba.');
  localStorage.removeItem(storageKey(pending.document.id)); changed();
}
const outcome = (id: string, intent: ArchiveIntent, status: 'known_failure' | 'uncertain' | 'not_sent', message: string): ArchiveOutcome => ({ id, intent, status, message });
async function verifyHash(receipt: Receipt, pending: Journal): Promise<void> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(catalogArchiveHashPayload(pending.document.id,
    { version: pending.document.version, intent: pending.intent }, pending.changes))));
  if (receipt.requestHash !== Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')) throw new Error('No pudimos comprobar el contenido de la operación.');
}
async function currentDocument(actor: Actor, id: string, guard: () => void): Promise<CatalogEditDocument> {
  const response = await catalogRequest(actor, catalogPath(id), 'GET', undefined, guard);
  assertActor(actor); guard();
  if (response.status !== 200) throw new Error('No se pudo consultar la publicación.');
  return parseCatalogDocument(response.value, id);
}
export async function prepareCatalogArchive(id: string, intent: ArchiveIntent, guard: () => void = () => {}): Promise<ArchivePrepared> {
  const actor = await actorForEdit(); guard();
  if (catalogArchivePending(id).pending) throw new Error('Hay una operación pendiente. Usá Consultar resultado.');
  const document = await currentDocument(actor, id, guard); archiveChangeSet(document.product, intent);
  return { uid: actor.uid, document: structuredClone(document), intent };
}
async function validatedReceipt(actor: Actor, pending: Journal, value: unknown, guard: () => void): Promise<Receipt> {
  const receipt = parseReceipt(value, pending); await verifyHash(receipt, pending); fence(actor, pending, guard);
  return receipt;
}
async function receiptDocument(actor: Actor, pending: Journal, receipt: Receipt, guard: () => void): Promise<Extract<ArchiveOutcome, { status: 'success' }>> {
  const current = await currentDocument(actor, pending.document.id, () => { fence(actor, pending, guard); });
  fence(actor, pending, guard);
  const superseded = catalogVersionAfter(current.version, receipt.version);
  if (!superseded && (current.version !== receipt.version || !sameJson(current.product, { ...pending.document.product, ...pending.changes }))) {
    throw new Error('El comprobante existe, pero falta comprobar la publicación. Consultá su resultado; no se repetirá la operación.');
  }
  return { id: current.id, intent: pending.intent, status: 'success', document: current, superseded,
    message: superseded ? 'Operación confirmada. Se muestra el estado actual de una edición posterior.' : pending.intent === 'withdraw' ? 'Publicación retirada.' : 'Publicación restaurada como inactiva.' };
}
async function acceptReceipt(actor: Actor, pending: Journal, value: unknown, guard: () => void): Promise<ArchiveOutcome> {
  const receipt = await validatedReceipt(actor, pending, value, guard);
  const confirmed: Journal = { ...pending, phase: 'CONFIRMED', receipt }; save(actor, confirmed, guard, pending);
  const result = await receiptDocument(actor, confirmed, receipt, guard);
  finish(actor, confirmed, { result: 'CONFIRMED', ...(result.superseded ? { supersededByVersion: result.document.version } : {}) }, guard);
  return result;
}
/** Same-origin Web Locks fence the durable per-ID journal; server version/TX remains final authority. */
export async function submitCatalogArchive(prepared: ArchivePrepared, guard: () => void = () => {}): Promise<ArchiveOutcome> {
  const { id } = prepared.document, intent = prepared.intent;
  try {
    const actor = await actorForEdit(); guard();
    if (actor.uid !== prepared.uid) throw new Error('Cambió la cuenta. Volvé a comprobar la selección.');
    if (!navigator.locks?.request) return outcome(id, intent, 'not_sent', 'Este navegador no permite iniciar la operación con seguridad. Podés consultar resultados pendientes.');
    const admitted = actor;
    return await navigator.locks.request('mutter-catalog-archive:' + id, { ifAvailable: true }, async lock => {
      if (!lock) return outcome(id, intent, 'not_sent', 'La publicación se está atendiendo en otra pestaña. No se envió.');
      let sent = false, pending: Journal | undefined;
      try {
        assertActor(admitted); guard();
        const existing = catalogArchivePending(id);
        if (existing.pending) return outcome(id, intent, existing.foreign ? 'not_sent' : 'uncertain', existing.foreign
          ? 'Hay una operación iniciada con otra cuenta. Volvé a esa cuenta para consultarla.' : 'Hay una operación pendiente. Consultá su resultado.');
        pending = { ...structuredClone(prepared), schema: 1, operationId: crypto.randomUUID(), changes: archiveChangeSet(prepared.document.product, intent), phase: 'SENT' };
        save(admitted, pending, guard); const reserved = pending;
        const response = await catalogRequest(admitted, catalogPath(id), 'PATCH', JSON.stringify({ version: reserved.document.version,
          intent, operationId: reserved.operationId }), () => { fence(admitted, reserved, guard); sent = true; });
        fence(admitted, reserved, guard);
        if (response.status >= 400 && response.status < 500 && isObject(response.value) && response.value.applied === false) {
          finish(admitted, reserved, { result: 'KNOWN_FAILURE', status: response.status }, guard);
          return outcome(id, intent, 'known_failure', 'La publicación cambió o no permite esta acción. No se aplicó; volvé a comprobarla.');
        }
        if (response.status !== 200 && response.status !== 201) throw new Error('No pudimos confirmar el resultado. Consultalo antes de continuar.');
        return await acceptReceipt(admitted, reserved, response.value, guard);
      } catch (failure: unknown) {
        if (pending && !sent) {
          try { finish(admitted, pending, { result: 'NOT_SENT' }, guard); }
          catch { return outcome(id, intent, 'uncertain', 'Conservamos la operación para comprobarla con la cuenta original. No se reenviará.'); }
        }
        return outcome(id, intent, sent || catalogArchivePending(id).pending ? 'uncertain' : 'not_sent',
          failure instanceof Error ? failure.message : 'No se pudo comprobar la operación.');
      }
    });
  } catch (failure: unknown) {
    return outcome(id, intent, catalogArchivePending(id).pending ? 'uncertain' : 'not_sent',
      failure instanceof Error ? failure.message : 'No se pudo comprobar la operación.');
  }
}
export async function consultCatalogArchive(id: string, guard: () => void = () => {}): Promise<ArchiveOutcome> {
  let intent: ArchiveIntent = 'withdraw';
  try {
    const actor = await actorForEdit(); guard(); const saved = read(id);
    if (!saved) return outcome(id, intent, 'not_sent', 'No hay una operación pendiente para consultar.');
    intent = saved.value.intent;
    if (saved.value.uid !== actor.uid) return outcome(id, intent, 'not_sent', 'Volvé a la cuenta que inició la operación para consultar su resultado.');
    const pending = saved.value;
    const queryReceipt = async () => {
      const response = await catalogRequest(actor, catalogPath(id, pending.operationId), 'GET', undefined, () => { fence(actor, pending, guard); });
      fence(actor, pending, guard);
      if (response.status !== 200) throw new Error('El resultado sigue sin confirmar. La operación se conserva y no se reenviará.');
      return response.value;
    };
    const readOnly = async (reason: string): Promise<ArchiveOutcome> => {
      const receipt = await validatedReceipt(actor, pending, await queryReceipt(), guard);
      const result = await receiptDocument(actor, pending, receipt, guard);
      return { ...result, journalRetained: true, message: result.message + ' ' + reason + ' El registro local se conserva; no se reenviará.' };
    };
    if (!navigator.locks?.request) return await readOnly('Este navegador permite comprobar el resultado, pero no cerrar el registro con seguridad.');
    return await navigator.locks.request('mutter-catalog-archive:' + id, { ifAvailable: true }, async lock => {
      if (!lock) return readOnly('Otra pestaña está atendiendo esta publicación.');
      return await acceptReceipt(actor, pending, await queryReceipt(), guard);
    });
  } catch (failure: unknown) {
    return outcome(id, intent, 'uncertain', failure instanceof Error ? failure.message : 'La operación sigue pendiente de comprobación.');
  }
}
