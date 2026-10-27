function hasClassificationId(value: unknown): value is Record<string, unknown> & { id: string } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && 'id' in value && typeof value.id === 'string' && value.id.length <= 200 && Boolean(value.id.trim());
}

/** Validate the effective pair without normalizing it or removing legacy keys. */
export function assertCatalogClassificationPair(category: unknown, subcategory: unknown): void {
  if (!hasClassificationId(category) || !hasClassificationId(subcategory)) {
    throw new Error('Elegí la categoría y subcategoría.');
  }
  if (subcategory.categoryId !== category.id) {
    throw new Error('La subcategoría no corresponde a la categoría.');
  }
}
