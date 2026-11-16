import { createHash } from 'node:crypto';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { archiveChangeSet, catalogArchiveHashPayload, type ArchiveChanges, type ArchiveIntent } from './catalog-archive-fields.js';
import { CatalogEditError, canonical, invalid, object, operationId, productVersion } from './catalog-edit-policy.js';

export type ArchiveRequest = { intent: ArchiveIntent; version: string; operationId: string };
export function parseArchiveRequest(input: unknown): ArchiveRequest {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (!object(value) || Object.keys(value).some(key => !['intent', 'version', 'operationId'].includes(key))
    || (value.intent !== 'withdraw' && value.intent !== 'restore') || typeof value.version !== 'string'
    || !/^\d+:\d{1,9}$/.test(value.version)) invalid('Revisá la acción y la versión de la publicación.');
  return { intent: value.intent, version: value.version, operationId: operationId(value.operationId) };
}
export function parseArchiveChanges(value: unknown, intent: ArchiveIntent): ArchiveChanges {
  if (!object(value) || value.active !== false || value.catalogArchived !== (intent === 'withdraw')
    || Object.keys(value).length !== (intent === 'withdraw' ? 3 : 2)
    || Object.keys(value).some(key => !['active', 'catalogArchived', 'catalogArchiveWasActive'].includes(key))
    || (intent === 'withdraw' ? typeof value.catalogArchiveWasActive !== 'boolean' : 'catalogArchiveWasActive' in value)) {
    throw new CatalogEditError(503, 'ARCHIVE_RECEIPT_INVALID', 'No pudimos comprobar el resultado del retiro.');
  }
  return { active: false, catalogArchived: intent === 'withdraw',
    ...(intent === 'withdraw' ? { catalogArchiveWasActive: value.catalogArchiveWasActive === true } : {}) };
}
export function archiveUpdate(snapshot: DocumentSnapshot, request: ArchiveRequest): ArchiveChanges {
  if (productVersion(snapshot) !== request.version) throw new CatalogEditError(409, 'PRODUCT_VERSION_CONFLICT',
    'La publicación cambió. Actualizá la lista y confirmá la selección de nuevo.');
  const value = snapshot.data();
  if (!value) throw new CatalogEditError(404, 'PRODUCT_NOT_FOUND', 'La publicación no existe.');
  try { return archiveChangeSet(value, request.intent); }
  catch (error: unknown) { throw new CatalogEditError(409, 'ARCHIVE_STATE_CONFLICT', error instanceof Error ? error.message : 'Cambió el estado de archivo.'); }
}
export function archiveRequestHash(id: string, request: ArchiveRequest, changes: ArchiveChanges): string {
  return createHash('sha256').update(canonical(catalogArchiveHashPayload(id, request, changes))).digest('hex');
}
