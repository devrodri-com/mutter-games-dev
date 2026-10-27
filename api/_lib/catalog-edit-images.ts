import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { Editor } from './catalog-edit-authorization.js';
import { CatalogEditError, object } from './catalog-edit-policy.js';
import { validCatalogImageUrl } from './catalog-edit-create.js';

/** Only a new URL needs an actor/product-bound receipt. Existing opaque legacy
 * URLs remain untouched and provider files are never removed by a catalog edit. */
export async function prepareImageAssociations(db: Firestore, tx: Transaction, editor: Editor, id: string,
  images: unknown, original: unknown, operationIds: string[]): Promise<() => void> {
  if (!Array.isArray(images)) return () => {};
  const previous = Array.isArray(original) ? original : [];
  const added = images.filter(url => !previous.includes(url));
  if (!added.length) return () => {};
  if (added.some(url => !validCatalogImageUrl(url))) throw new CatalogEditError(400, 'INVALID_CATALOG_IMAGE', 'La imagen nueva no tiene una dirección válida.');
  const actorKey = createHash('sha256').update(editor.uid).digest('hex');
  const snapshots = await Promise.all(operationIds.map(operation => tx.get(db.doc(`adminImageOperations/${actorKey}-${operation}`))));
  const used = snapshots.filter(snapshot => added.includes(snapshot.get('url')));
  if (added.some(url => !used.some(snapshot => snapshot.get('url') === url)))
    throw new CatalogEditError(400, 'CATALOG_IMAGE_RECEIPT_REQUIRED', 'Confirmá la carga de cada imagen nueva antes de guardar.');
  for (const snapshot of used) {
    const receipt: unknown = snapshot.data();
    if (!object(receipt) || receipt.schema !== 1 || receipt.uid !== editor.uid || receipt.productId !== id
      || typeof receipt.operationId !== 'string' || snapshot.id !== `${actorKey}-${receipt.operationId}`
      || receipt.status !== 'CONFIRMED' || receipt.associatedProductId !== null && receipt.associatedProductId !== id)
      throw new CatalogEditError(409, 'CATALOG_IMAGE_TARGET_MISMATCH', 'La imagen no está confirmada para esta cuenta y publicación.');
  }
  return () => { for (const snapshot of used) if (snapshot.get('associatedProductId') === null)
    tx.update(snapshot.ref, { associatedProductId: id }); };
}
