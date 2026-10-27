import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { revalidateEditor, type Editor } from './catalog-edit-authorization.js';
import { object, operationId, productId } from './catalog-edit-policy.js';
import { actorKey, imageKeys, mediaError, mediaPath, parseMediaPlan, providerBase, providerRead, signedImage, validateImage, type MediaPlan } from './catalog-media-policy.js';

type StoredPlan = MediaPlan & { uid: string; folder: string; expire: number; status: 'ISSUED' | 'CONFIRMED'; url?: string; fileId?: string };
function stored(value: unknown, editor: Editor, id: string, target: string): StoredPlan {
  if (!object(value) || value.schema !== 1 || value.uid !== editor.uid || value.operationId !== id || value.productId !== target
    || value.folder !== `/mutter/admin/${actorKey(editor.uid)}` || typeof value.fileName !== 'string'
    || !value.fileName.startsWith(`mutter-${id}.`) || typeof value.size !== 'number' || typeof value.mime !== 'string'
    || typeof value.expire !== 'number' || !Number.isSafeInteger(value.expire)
    || !['ISSUED', 'CONFIRMED'].includes(String(value.status))) mediaError('No se encontró la carga de esta cuenta y publicación.', 409);
  if (value.status === 'CONFIRMED' && (typeof value.url !== 'string' || typeof value.fileId !== 'string')) mediaError('El comprobante de imagen está incompleto.', 503);
  return { uid: editor.uid, operationId: id, productId: target, folder: value.folder, fileName: value.fileName,
    size: value.size, mime: value.mime, expire: value.expire, status: value.status === 'CONFIRMED' ? 'CONFIRMED' : 'ISSUED',
    ...(typeof value.url === 'string' ? { url: value.url } : {}), ...(typeof value.fileId === 'string' ? { fileId: value.fileId } : {}) };
}
function confirmed(plan: StoredPlan) {
  return { status: 'CONFIRMED', imageOperationId: plan.operationId, productId: plan.productId, url: plan.url };
}
export async function prepareMedia(auth: Auth, db: Firestore, editor: Editor, input: unknown) {
  const plan = parseMediaPlan(input), ref = db.doc(mediaPath(editor.uid, plan.operationId));
  imageKeys(); providerBase(); // Configuration is checked before reserving anything.
  const result = await db.runTransaction(async tx => {
    await revalidateEditor(auth, db, editor, tx);
    const previous = await tx.get(ref), product = await tx.get(db.doc(`products/${plan.productId}`));
    if (!product.exists && !/^admin-[a-f0-9-]{36}$/.test(plan.productId)) mediaError('La publicación no existe.', 404);
    if (previous.exists) {
      const current = stored(previous.data(), editor, plan.operationId, plan.productId);
      if (current.fileName !== plan.fileName || current.size !== plan.size || current.mime !== plan.mime) mediaError('La carga anterior tiene otros datos.', 409);
      return current;
    }
    const current: StoredPlan = { ...plan, uid: editor.uid, folder: `/mutter/admin/${actorKey(editor.uid)}`,
      expire: Math.floor(Date.now() / 1000) + 600, status: 'ISSUED' };
    tx.create(ref, { schema: 1, ...current, issuedAt: FieldValue.serverTimestamp(), associatedProductId: null });
    return current;
  }, { maxAttempts: 1 });
  await revalidateEditor(auth, db, editor);
  if (result.status === 'CONFIRMED') return confirmed(result);
  if (result.expire <= Date.now() / 1000) mediaError('La carga anterior venció. No se reenviará.', 409);
  return signedImage(result, editor.uid, result.expire);
}
export async function observeMedia(auth: Auth, db: Firestore, editor: Editor, rawId: unknown, rawProduct: unknown) {
  const id = operationId(rawId), target = productId(rawProduct);
  await revalidateEditor(auth, db, editor);
  const snapshot = await db.doc(mediaPath(editor.uid, id)).get();
  if (!snapshot.exists) return { status: 'NOT_FOUND', imageOperationId: id, productId: target };
  const plan = stored(snapshot.data(), editor, id, target);
  if (plan.status === 'CONFIRMED') return confirmed(plan);
  const query = new URLSearchParams({ path: plan.folder, searchQuery: `name="${plan.fileName}"`, type: 'file', limit: '2' });
  const found = await providerRead(`/v1/files?${query}`);
  if (!Array.isArray(found) || found.length > 1) mediaError('No pudimos identificar una única imagen para esta carga.', 409);
  await revalidateEditor(auth, db, editor);
  if (!found.length) return { status: 'ISSUED', imageOperationId: id, productId: target, expire: plan.expire };
  const image = validateImage(found[0], plan);
  return { status: 'UPLOADED', imageOperationId: id, productId: target, ...image };
}
export async function confirmMedia(auth: Auth, db: Firestore, editor: Editor, input: unknown) {
  if (!object(input) || Object.keys(input).sort().join(',') !== 'fileId,intent,operationId,productId' || input.intent !== 'confirm'
    || typeof input.fileId !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(input.fileId)) mediaError('Confirmación de imagen inválida.');
  const id = operationId(input.operationId), target = productId(input.productId), fileId = input.fileId;
  const ref = db.doc(mediaPath(editor.uid, id));
  await revalidateEditor(auth, db, editor);
  const plan = stored((await ref.get()).data(), editor, id, target);
  if (plan.status === 'CONFIRMED') {
    if (plan.fileId !== fileId) mediaError('La operación corresponde a otra imagen.', 409);
    return confirmed(plan);
  }
  const image = validateImage(await providerRead(`/v1/files/${encodeURIComponent(fileId)}/details`), plan);
  if (image.fileId !== fileId) mediaError('La imagen no coincide.', 409);
  await db.runTransaction(async tx => {
    await revalidateEditor(auth, db, editor, tx);
    const current = stored((await tx.get(ref)).data(), editor, id, target);
    if (current.fileName !== plan.fileName || current.size !== plan.size || current.mime !== plan.mime
      || current.status === 'CONFIRMED' && (current.fileId !== fileId || current.url !== image.url)) mediaError('La carga cambió mientras se comprobaba.', 409);
    if (current.status === 'ISSUED') tx.update(ref, { status: 'CONFIRMED', ...image, confirmedAt: FieldValue.serverTimestamp() });
  }, { maxAttempts: 1 });
  return confirmed(stored((await ref.get()).data(), editor, id, target));
}
