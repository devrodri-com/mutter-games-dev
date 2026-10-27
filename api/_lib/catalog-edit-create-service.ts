import { FieldValue, type Firestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { revalidateEditor, type Editor } from './catalog-edit-authorization.js';
import { CatalogEditError, canonical, object, receiptPath, timestampVersion } from './catalog-edit-policy.js';
import { createRequestHash, creationProductId, parseCreateRequest, type CreateRequest } from './catalog-edit-create-policy.js';
import { normalizeCatalogCreate } from './catalog-edit-create.js';
import { prepareImageAssociations } from './catalog-edit-images.js';
import { JOHN_ADMIN_SCOPE } from './credential-access-state.js';

export type ConfirmedCreate = { status: 'CONFIRMED'; intent: 'create'; id: string; operationId: string;
  version: string; requestHash: string; product: Record<string, unknown> };
export function confirmedCreate(snapshot: DocumentSnapshot, editor: Editor, id: string, operationId: string): ConfirmedCreate {
  const value: unknown = snapshot.data();
  if (!object(value) || value.schema !== 1 || value.kind !== 'SCOPED_PUBLICATION_CREATE_V1' || value.status !== 'CONFIRMED'
    || value.uid !== editor.uid || value.id !== id || value.operationId !== operationId || !object(value.request))
    throw new CatalogEditError(409, 'EDIT_RECEIPT_TARGET_MISMATCH', 'Ese guardado pertenece a otra publicación u operación.');
  const request = parseCreateRequest({ ...value.request, operationId });
  if (creationProductId(request) !== id || value.requestHash !== createRequestHash(id, request))
    throw new CatalogEditError(503, 'EDIT_RECEIPT_INVALID', 'No pudimos comprobar el recibo de la creación.');
  const product = normalizeCatalogCreate(request.product, operationId);
  if (!object(value.product) || canonical(product) !== canonical(value.product))
    throw new CatalogEditError(503, 'EDIT_RECEIPT_INVALID', 'El recibo no conserva el contenido confirmado.');
  return { status: 'CONFIRMED', intent: 'create', id, operationId, version: timestampVersion(snapshot.createTime),
    requestHash: value.requestHash, product };
}
export async function createPublication(auth: Auth, db: Firestore, editor: Editor, id: string, request: CreateRequest): Promise<ConfirmedCreate> {
  if (creationProductId(request) !== id) throw new CatalogEditError(400, 'INVALID_CREATE_TARGET', 'La nueva publicación no corresponde a esta operación.');
  const operation = db.doc(receiptPath(editor.uid, request.operationId)), ref = db.doc(`products/${id}`);
  const hash = createRequestHash(id, request), product = normalizeCatalogCreate(request.product, request.operationId);
  try { await db.runTransaction(async tx => {
    await revalidateEditor(auth, db, editor, tx);
    const [previous, existing] = await Promise.all([tx.get(operation), tx.get(ref)]);
    if (previous.exists) {
      const receipt = confirmedCreate(previous, editor, id, request.operationId);
      if (receipt.requestHash !== hash) throw new CatalogEditError(409, 'EDIT_OPERATION_CONFLICT', 'Ese identificador ya corresponde a otra creación. No se creó otra publicación.');
      return;
    }
    if (existing.exists) throw new CatalogEditError(409, 'PRODUCT_ALREADY_EXISTS', 'La publicación ya existe. No se sobrescribió ni se creó otra.');
    const associate = await prepareImageAssociations(db, tx, editor, id, product.images, [], request.imageOperationIds ?? []);
    associate(); tx.create(ref, product);
    tx.create(operation, { schema: 1, kind: 'SCOPED_PUBLICATION_CREATE_V1', uid: editor.uid, id,
      operationId: request.operationId, scope: JOHN_ADMIN_SCOPE, requestHash: hash, status: 'CONFIRMED',
      request: { intent: 'create', product: request.product,
        ...(request.imageOperationIds === undefined ? {} : { imageOperationIds: request.imageOperationIds }) },
      product, confirmedAt: FieldValue.serverTimestamp() });
  }, { maxAttempts: 1 }); } catch (error: unknown) {
    if (object(error) && error.code === 10) {
      const snapshot = await operation.get();
      if (snapshot.exists) {
        const receipt = confirmedCreate(snapshot, editor, id, request.operationId);
        if (receipt.requestHash === hash) return receipt;
      }
      throw new CatalogEditError(409, 'CREATE_VERSION_CONFLICT', 'Los permisos o la operación cambiaron durante la creación. No se repitió el envío.');
    }
    throw error;
  }
  try {
    const snapshot = await operation.get();
    if (snapshot.exists) return confirmedCreate(snapshot, editor, id, request.operationId);
  } catch {
    throw new CatalogEditError(503, 'EDIT_CONFIRMATION_UNAVAILABLE', 'La creación necesita confirmación. Consultá su estado sin volver a enviarla.');
  }
  throw new CatalogEditError(503, 'EDIT_CONFIRMATION_UNAVAILABLE', 'La creación necesita confirmación. Consultá su estado sin volver a enviarla.');
}
