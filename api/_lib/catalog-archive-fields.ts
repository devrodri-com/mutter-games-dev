export type ArchiveIntent = 'withdraw' | 'restore';
export type ArchiveChanges = { active: false; catalogArchived: boolean; catalogArchiveWasActive?: boolean };
type Publication = { active?: unknown; catalogArchived?: unknown; catalogArchiveWasActive?: unknown };

export function catalogIsArchived(value: Publication): boolean { return value.catalogArchived === true; }
export function catalogPublicationVisible(value: Publication): boolean {
  return value.active === true && (value.catalogArchived === undefined || value.catalogArchived === false);
}
export function archiveChangeSet(value: Publication, intent: ArchiveIntent): ArchiveChanges {
  if (value.catalogArchived !== undefined && typeof value.catalogArchived !== 'boolean') throw new Error('No se pudo comprobar el estado de archivo.');
  if (intent === 'withdraw') {
    if (catalogIsArchived(value)) throw new Error('La publicación ya está retirada. Actualizá la lista.');
    return { active: false, catalogArchived: true, catalogArchiveWasActive: value.active === true };
  }
  if (!catalogIsArchived(value)) throw new Error('La publicación ya está fuera de Archivadas. Actualizá la lista.');
  return { active: false, catalogArchived: false };
}
export function catalogArchiveHashPayload(id: string, request: { version: string; intent: ArchiveIntent }, changes: ArchiveChanges) {
  return { schema: 1, id, version: request.version, intent: request.intent, changes };
}
