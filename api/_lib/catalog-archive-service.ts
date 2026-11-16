import { FieldValue, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { JOHN_ADMIN_SCOPE } from './credential-access-state.js';
import { revalidateEditor, type Editor } from './catalog-edit-authorization.js';
import { CatalogEditError, object, receiptPath, timestampVersion } from './catalog-edit-policy.js';
import { archiveRequestHash, archiveUpdate, parseArchiveChanges, parseArchiveRequest, type ArchiveRequest } from './catalog-archive-policy.js';
import type { ArchiveChanges, ArchiveIntent } from './catalog-archive-fields.js';

export type ConfirmedArchive = { status: 'CONFIRMED'; kind: 'CATALOG_ARCHIVE_V1'; id: string; operationId: string;
  intent: ArchiveIntent; version: string; baseVersion: string; changes: ArchiveChanges; requestHash: string };
export function confirmedArchive(snapshot: DocumentSnapshot, editor: Editor, id: string, operationId: string): ConfirmedArchive {
  const value: unknown = snapshot.data();
  if (!object(value) || value.schema !== 1 || value.kind !== 'CATALOG_ARCHIVE_V1' || value.status !== 'CONFIRMED'
    || value.uid !== editor.uid || value.id !== id || value.operationId !== operationId || value.scope !== JOHN_ADMIN_SCOPE
    || !object(value.request)) throw new CatalogEditError(409, 'ARCHIVE_RECEIPT_TARGET_MISMATCH', 'El comprobante pertenece a otra acción o publicación.');
  const request = parseArchiveRequest({ ...value.request, operationId });
  const changes = parseArchiveChanges(value.changes, request.intent), hash = archiveRequestHash(id, request, changes);
  if (value.requestHash !== hash) throw new CatalogEditError(503, 'ARCHIVE_RECEIPT_INVALID', 'No pudimos comprobar el resultado de la acción.');
  return { status: 'CONFIRMED', kind: 'CATALOG_ARCHIVE_V1', id, operationId, intent: request.intent,
    version: timestampVersion(snapshot.createTime), baseVersion: request.version, changes, requestHash: hash };
}
async function readArchiveReceipt(db: Firestore, editor: Editor, id: string, operationId: string) {
  const snapshot = await db.doc(receiptPath(editor.uid, operationId)).get();
  return snapshot.exists ? confirmedArchive(snapshot, editor, id, operationId) : null;
}
export async function saveArchive(auth: Auth, db: Firestore, editor: Editor, id: string, request: ArchiveRequest): Promise<ConfirmedArchive> {
  const operation = db.doc(receiptPath(editor.uid, request.operationId)), ref = db.doc('products/' + id);
  try {
    await db.runTransaction(async tx => {
      await revalidateEditor(auth, db, editor, tx);
      const [previous, product] = await Promise.all([tx.get(operation), tx.get(ref)]);
      if (previous.exists) {
        const receipt = confirmedArchive(previous, editor, id, request.operationId);
        if (receipt.baseVersion !== request.version || receipt.intent !== request.intent) throw new CatalogEditError(409,
          'ARCHIVE_OPERATION_CONFLICT', 'Ese identificador ya corresponde a otra acción. No se repitió.');
        return;
      }
      const changes = archiveUpdate(product, request);
      tx.update(ref, changes);
      tx.create(operation, { schema: 1, kind: 'CATALOG_ARCHIVE_V1', uid: editor.uid, scope: JOHN_ADMIN_SCOPE, id,
        operationId: request.operationId, request: { intent: request.intent, version: request.version }, changes,
        requestHash: archiveRequestHash(id, request, changes), status: 'CONFIRMED', confirmedAt: FieldValue.serverTimestamp() });
    }, { maxAttempts: 1 });
  } catch (error: unknown) {
    if (object(error) && error.code === 10) {
      const receipt = await readArchiveReceipt(db, editor, id, request.operationId);
      if (receipt && receipt.baseVersion === request.version && receipt.intent === request.intent) return receipt;
      throw new CatalogEditError(409, 'PRODUCT_VERSION_CONFLICT', 'La publicación o los permisos cambiaron. Actualizá la lista y confirmá de nuevo.');
    }
    throw error;
  }
  try {
    const receipt = await readArchiveReceipt(db, editor, id, request.operationId);
    if (receipt) return receipt;
  } catch { /* A committed action must never be reported as not applied. */
    throw new CatalogEditError(503, 'ARCHIVE_CONFIRMATION_UNAVAILABLE', 'Falta confirmar la acción. Consultá su estado sin volver a enviarla.');
  }
  throw new CatalogEditError(503, 'ARCHIVE_CONFIRMATION_UNAVAILABLE', 'Falta confirmar la acción. Consultá su estado sin volver a enviarla.');
}
