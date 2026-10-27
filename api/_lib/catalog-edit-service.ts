import { FieldValue, type Firestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { JOHN_ADMIN_SCOPE } from './credential-access-state.js';
import { revalidateEditor, type Editor } from './catalog-edit-authorization.js';
import { CatalogEditError, canonical, editUpdate, object, parseEditRequest, productVersion, receiptPath,
  requestHash, timestampVersion, type EditRequest } from './catalog-edit-policy.js';
import { confirmedCreate } from './catalog-edit-create-service.js';
import { prepareImageAssociations } from './catalog-edit-images.js';

export type ConfirmedEdit = { status: 'CONFIRMED'; id: string; operationId: string; version: string;
  baseVersion: string; changes: Record<string, unknown>; requestHash: string };
function confirmed(snapshot: DocumentSnapshot, editor: Editor, id: string, operationId: string): ConfirmedEdit {
  const value: unknown = snapshot.data();
  if (!object(value) || value.schema !== 1 || value.kind !== 'SCOPED_EXISTING_PUBLICATION_EDIT_V1'
    || value.status !== 'CONFIRMED' || value.uid !== editor.uid || value.id !== id || value.operationId !== operationId
    || !object(value.request)) throw new CatalogEditError(409, 'EDIT_RECEIPT_TARGET_MISMATCH', 'Ese guardado pertenece a otra publicación u operación.');
  const request = parseEditRequest({ ...value.request, operationId });
  const hash = requestHash(id, request);
  if (value.requestHash !== hash) throw new CatalogEditError(503, 'EDIT_RECEIPT_INVALID', 'No pudimos comprobar el recibo del guardado.');
  // Receipt creation and product update are in the same transaction. The
  // provider's immutable createTime is that write's version, not a later read.
  return { status: 'CONFIRMED', id, operationId, version: timestampVersion(snapshot.createTime),
    baseVersion: request.version, changes: request.changes, requestHash: hash };
}
export async function readEditReceipt(db: Firestore, editor: Editor, id: string, operationId: string) {
  const snapshot = await db.doc(receiptPath(editor.uid, operationId)).get();
  if (snapshot.get('kind') === 'SCOPED_PUBLICATION_CREATE_V1') return confirmedCreate(snapshot, editor, id, operationId);
  return snapshot.exists ? confirmed(snapshot, editor, id, operationId)
    : { status: 'NOT_CONFIRMED' as const, id, operationId, resubmissionAuthorized: false };
}
export async function readEditProduct(db: Firestore, id: string) {
  const snapshot = await db.doc(`products/${id}`).get();
  const version = productVersion(snapshot);
  return { id, version, product: snapshot.data(), capabilities: { editExisting: true } };
}
export async function saveEdit(auth: Auth, db: Firestore, editor: Editor, id: string, request: EditRequest): Promise<ConfirmedEdit> {
  const operation = db.doc(receiptPath(editor.uid, request.operationId)), ref = db.doc(`products/${id}`);
  const hash = requestHash(id, request);
  try { await db.runTransaction(async tx => {
    await revalidateEditor(auth, db, editor, tx);
    const [previous, product] = await Promise.all([tx.get(operation), tx.get(ref)]);
    if (previous.exists) {
      const receipt = confirmed(previous, editor, id, request.operationId);
      if (receipt.requestHash !== hash || canonical(receipt.changes) !== canonical(request.changes)
        || receipt.baseVersion !== request.version) throw new CatalogEditError(409, 'EDIT_OPERATION_CONFLICT',
        'Ese identificador ya tiene otro guardado. No se repitió la operación.');
      return;
    }
    const update = editUpdate(product, request);
    const associate = await prepareImageAssociations(db, tx, editor, id, update.images, product.get('images'), request.imageOperationIds ?? []);
    associate();
    tx.update(ref, update);
    tx.create(operation, { schema: 1, kind: 'SCOPED_EXISTING_PUBLICATION_EDIT_V1', uid: editor.uid, id,
      operationId: request.operationId, scope: JOHN_ADMIN_SCOPE, requestHash: hash, status: 'CONFIRMED',
      request: { version: request.version, intent: 'edit', changes: request.changes,
        ...(request.imageOperationIds === undefined ? {} : { imageOperationIds: request.imageOperationIds }) }, confirmedAt: FieldValue.serverTimestamp() });
  }, { maxAttempts: 1 }); } catch (error: unknown) {
    if (object(error) && error.code === 10) {
      // A known ABORTED transaction made no commit. First resolve an identical
      // concurrent operation from its receipt, without another write attempt.
      const receipt = await readEditReceipt(db, editor, id, request.operationId);
      if (receipt.status === 'CONFIRMED' && 'changes' in receipt && receipt.requestHash === hash) return receipt;
      throw new CatalogEditError(409, 'PRODUCT_VERSION_CONFLICT',
        'La publicación o los permisos cambiaron durante el guardado. Conservá tu texto y volvé a abrirla.');
    }
    throw error;
  }
  try {
    const receipt = await readEditReceipt(db, editor, id, request.operationId);
    if (receipt.status === 'CONFIRMED' && 'changes' in receipt) return receipt;
  } catch {
    throw new CatalogEditError(503, 'EDIT_CONFIRMATION_UNAVAILABLE',
      'El guardado necesita confirmación. Consultá su recibo sin volver a enviarlo.');
  }
  throw new CatalogEditError(503, 'EDIT_CONFIRMATION_UNAVAILABLE',
    'El guardado necesita confirmación. Consultá su recibo sin volver a enviarlo.');
}
