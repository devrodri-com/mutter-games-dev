import { MERGED_FIELDS } from '../../../api/_lib/catalog-edit-fields';
import { catalogEditFields, isObject, type CatalogEditChanges, type JsonObject } from '../../domain/catalogEdit';

/** Uncommitted display state may contain an incomplete option while the user
 * types. Admission and preservation rules run through the real clients on save. */
export function publicationFormDraft(product: JsonObject, changes: CatalogEditChanges): JsonObject {
  const result = { ...product };
  for (const field of catalogEditFields) {
    const value = changes[field];
    if (value === undefined) continue;
    const previous = product[field];
    result[field] = MERGED_FIELDS.some(item => item === field) && isObject(previous) && isObject(value)
      ? { ...previous, ...value } : value;
  }
  return result;
}
