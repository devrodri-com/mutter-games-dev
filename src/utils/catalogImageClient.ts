import { auth } from '../firebase';
import { isObject, sameJson } from '../domain/catalogEdit';
import { actorForEdit, assertActor, catalogRequest, type Actor } from './catalogTransport';

export type CatalogImage = { url: string; imageOperationId: string };
type PendingImage = { schema: 1; uid: string; productId: string; operationId: string;
  fileName: string; size: number; mime: string; phase: 'PREPARING' | 'UPLOADING' | 'CONFIRMING' | 'CONFIRMED'; fileId?: string; image?: CatalogImage };
export class CatalogImagePendingError extends Error {}
const key = (uid: string, id: string) => `mutter-catalog-image:${uid}:${id}`;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function imageValue(value: unknown, pending: PendingImage): CatalogImage {
  if (!isObject(value) || value.status !== 'CONFIRMED' || value.imageOperationId !== pending.operationId
    || value.productId !== pending.productId || typeof value.url !== 'string') throw new CatalogImagePendingError('La confirmación de la imagen no coincide.');
  const url = new URL(value.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new CatalogImagePendingError('La dirección de la imagen no es válida.');
  return { url: url.href, imageOperationId: pending.operationId };
}
function read(actor: Actor, id: string): PendingImage | null {
  assertActor(actor);
  const raw = localStorage.getItem(key(actor.uid, id)); if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new CatalogImagePendingError('Conservamos una carga pendiente que necesita revisión.'); }
  if (!isObject(value) || value.schema !== 1 || value.uid !== actor.uid || value.productId !== id
    || typeof value.operationId !== 'string' || !uuid.test(value.operationId) || typeof value.fileName !== 'string'
    || typeof value.size !== 'number' || typeof value.mime !== 'string'
    || !['PREPARING', 'UPLOADING', 'CONFIRMING', 'CONFIRMED'].includes(String(value.phase))) throw new CatalogImagePendingError('La carga pendiente no es válida. No se repetirá.');
  const phase = value.phase;
  if (phase !== 'PREPARING' && phase !== 'UPLOADING' && phase !== 'CONFIRMING' && phase !== 'CONFIRMED') throw new CatalogImagePendingError('Fase inválida.');
  const pending: PendingImage = { schema: 1, uid: actor.uid, productId: id, operationId: value.operationId,
    fileName: value.fileName, size: value.size, mime: value.mime, phase };
  if (typeof value.fileId === 'string') pending.fileId = value.fileId;
  if (phase === 'CONFIRMED') pending.image = imageValue({ status: 'CONFIRMED', productId: id, ...(isObject(value.image) ? value.image : {}) }, pending);
  return pending;
}
function assertPending(actor: Actor, pending: PendingImage): void {
  const current = read(actor, pending.productId);
  if (!current || !sameJson(current, pending)) throw new CatalogImagePendingError('La carga cambió en otra ventana. Volvé a abrir la publicación.');
}
function persist(actor: Actor, next: PendingImage, previous?: PendingImage): void {
  assertActor(actor);
  if (previous) assertPending(actor, previous);
  else if (read(actor, next.productId)) throw new CatalogImagePendingError('Hay una carga pendiente. Comprobala antes de enviar otra.');
  localStorage.setItem(key(actor.uid, next.productId), JSON.stringify(next));
}
function finish(actor: Actor, pending: PendingImage, result: unknown): CatalogImage {
  const image = imageValue(result, pending);
  persist(actor, { ...pending, phase: 'CONFIRMED', image }, pending);
  return image;
}
function pendingServerError(value: unknown, fallback: string): CatalogImagePendingError {
  // Only this handler's controlled, user-facing media error is displayed. Never
  // echo a provider response, an unknown internal error or unrelated fields.
  const message = isObject(value) && value.code === 'CATALOG_MEDIA_ERROR'
    && typeof value.error === 'string' && value.error.length > 0 && value.error.length <= 300 ? value.error : fallback;
  return new CatalogImagePendingError(`${message} Conservamos la carga pendiente; no se enviará otro archivo.`);
}
/** Confirmed uploads remain available after a form is closed or a browser restarts. */
export function listCatalogImageDrafts(productId: string): CatalogImage[] {
  const actor = auth.currentUser;
  if (!actor) return [];
  const prefix = `${key(actor.uid, productId)}:history:`, images: CatalogImage[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const storageKey = localStorage.key(index);
    if (!storageKey?.startsWith(prefix)) continue;
    const raw = localStorage.getItem(storageKey);
    if (!raw) continue;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new CatalogImagePendingError('Una imagen conservada necesita revisión.'); }
    if (isObject(value) && value.uid === actor.uid && value.productId === productId && value.phase === 'CONFIRMED'
      && isObject(value.image) && typeof value.image.url === 'string' && typeof value.image.imageOperationId === 'string'
      && uuid.test(value.image.imageOperationId) && value.image.imageOperationId === value.operationId) {
      const url = new URL(value.image.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new CatalogImagePendingError('La imagen conservada no es válida.');
      images.push({ url: url.href, imageOperationId: value.image.imageOperationId });
    }
  }
  return images;
}
/** Called only after the form has durably retained this image and its receipt. */
export function acknowledgeCatalogImage(productId: string, imageOperationId: string): void {
  const actor = auth.currentUser;
  if (!actor) throw new Error('Ingresá para conservar la imagen.');
  const pending = read(actor, productId);
  if (!pending || pending.phase !== 'CONFIRMED' || pending.operationId !== imageOperationId) throw new Error('La imagen todavía no está confirmada.');
  localStorage.setItem(`${key(actor.uid, productId)}:history:${imageOperationId}`, JSON.stringify(pending));
  assertPending(actor, pending); localStorage.removeItem(key(actor.uid, productId));
}
async function confirm(actor: Actor, pending: PendingImage, fileId: string): Promise<CatalogImage> {
  if (!/^[a-zA-Z0-9_-]{1,150}$/.test(fileId)) throw new CatalogImagePendingError('No se pudo identificar la imagen.');
  const sent: PendingImage = { ...pending, phase: 'CONFIRMING', fileId };
  persist(actor, sent, pending);
  const response = await catalogRequest(actor, '/api/catalog-media', 'POST', JSON.stringify({ intent: 'confirm',
    operationId: sent.operationId, productId: sent.productId, fileId }), () => assertPending(actor, sent));
  if (response.status !== 200) throw pendingServerError(response.value, 'La confirmación de la imagen está pendiente. Comprobá la carga.');
  return finish(actor, sent, response.value);
}
export async function recoverCatalogImage(productId: string): Promise<CatalogImage | null> {
  const actor = await actorForEdit(), pending = read(actor, productId);
  if (!pending) return null;
  if (pending.phase === 'CONFIRMED' && pending.image) return pending.image;
  const query = new URLSearchParams({ productId, operationId: pending.operationId });
  const response = await catalogRequest(actor, `/api/catalog-media?${query}`, 'GET', undefined, () => assertPending(actor, pending));
  if (response.status === 200 && isObject(response.value)) {
    if (response.value.status === 'CONFIRMED') return finish(actor, pending, response.value);
    if (response.value.status === 'UPLOADED' && (pending.phase === 'UPLOADING' || pending.phase === 'CONFIRMING')) {
      if (response.value.imageOperationId !== pending.operationId || response.value.productId !== pending.productId
        || typeof response.value.fileId !== 'string' || pending.phase === 'CONFIRMING' && response.value.fileId !== pending.fileId)
        throw new CatalogImagePendingError('La imagen comprobada no coincide con la carga pendiente. No se confirmará otra imagen.');
      return confirm(actor, pending, response.value.fileId);
    }
  }
  throw pendingServerError(response.value, 'La carga anterior sigue sin confirmar.');
}
export async function uploadCatalogImage(file: File, productId: string): Promise<CatalogImage> {
  const actor = await actorForEdit();
  if (read(actor, productId)) throw new CatalogImagePendingError('Comprobá primero la carga anterior. No se enviará otro archivo.');
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  const expectedMime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'png' || extension === 'webp' ? `image/${extension}` : '';
  if (!expectedMime || file.type !== expectedMime || file.size < 1 || file.size > 5000000) throw new Error('Usá JPG, PNG o WEBP de hasta 5 MB, con el formato y la extensión correspondientes.');
  const pending: PendingImage = { schema: 1, uid: actor.uid, productId, operationId: crypto.randomUUID(),
    fileName: file.name, size: file.size, mime: file.type, phase: 'PREPARING' };
  persist(actor, pending);
  try {
    const prepared = await catalogRequest(actor, '/api/catalog-media', 'POST', JSON.stringify({ intent: 'prepare',
      operationId: pending.operationId, productId, fileName: file.name, size: file.size, mime: file.type }), () => assertPending(actor, pending));
    if (prepared.status >= 400 && prepared.status < 500 && isObject(prepared.value) && prepared.value.applied === false) {
      assertPending(actor, pending);
      localStorage.setItem(`${key(actor.uid, productId)}:history:${pending.operationId}`, JSON.stringify({ ...pending, rejected: prepared.value }));
      localStorage.removeItem(key(actor.uid, productId));
      throw new Error(typeof prepared.value.error === 'string' ? prepared.value.error : 'La imagen no se pudo preparar.');
    }
    const value = prepared.value;
    if (prepared.status !== 200 || !isObject(value) || value.status !== 'ISSUED' || value.imageOperationId !== pending.operationId
      || value.productId !== productId || typeof value.token !== 'string' || !isObject(value.fields)
      || Object.values(value.fields).some(field => typeof field !== 'string') || value.fields.overwriteFile !== 'false'
      || value.fields.useUniqueFileName !== 'false' || typeof value.expire !== 'number' || value.expire * 1000 <= Date.now()) throw new CatalogImagePendingError('La preparación de la imagen no está confirmada.');
    const body = new FormData();
    for (const [name, field] of Object.entries(value.fields)) { if (typeof field !== 'string') throw new Error('Campo de carga inválido.'); body.append(name, field); }
    body.append('token', value.token); body.append('file', file);
    const uploading: PendingImage = { ...pending, phase: 'UPLOADING' }; persist(actor, uploading, pending);
    assertPending(actor, uploading);
    const response = await fetch('https://upload.imagekit.io/api/v2/files/upload', { method: 'POST', redirect: 'error', body });
    assertActor(actor); const result: unknown = await response.json(); assertActor(actor);
    if (!response.ok || !isObject(result) || typeof result.fileId !== 'string') throw new CatalogImagePendingError('No se confirmó la carga. No vuelvas a enviar el archivo; usá «Comprobar carga».');
    return await confirm(actor, uploading, result.fileId);
  } catch (error: unknown) {
    if (read(actor, productId)) throw new CatalogImagePendingError(error instanceof Error ? error.message : 'La carga está pendiente.');
    throw error;
  }
}
