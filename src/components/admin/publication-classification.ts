import { assertCatalogClassificationPair } from '../../../api/_lib/catalog-edit-classification';
import type { Category, Subcategory } from '../../data/types';
import { isObject, type JsonObject } from '../../domain/catalogEdit';

/** Resolve the selected option without normalizing the stored classification.
 * Incomplete drafts have no selected option; the form requires one on save. */
export function selectedPublicationSubcategory(product: JsonObject, categories: Category[]): Subcategory | undefined {
  try { assertCatalogClassificationPair(product.category, product.subcategory); }
  catch { return undefined; }
  const category = product.category, subcategory = product.subcategory;
  if (!isObject(category) || !isObject(subcategory)) return undefined;
  return categories.find(item => item.id === category.id)?.subcategories.find(item =>
    item.id === subcategory.id && item.categoryId === category.id);
}
