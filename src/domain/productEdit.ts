import type { Product } from '../data/types';
const fields = ['title', 'description', 'category', 'subcategory', 'tipo', 'defaultDescriptionType', 'extraDescriptionTop', 'extraDescriptionBottom', 'descriptionPosition', 'images', 'allowCustomization', 'customName', 'customNumber', 'variants', 'sku', 'subtitle'] as const;
/** Publication is a separate intent. Only actual edits leave the browser. */
export function editProductChanges(original: Product, edited: Product): Record<string, unknown> {
    const changes: Record<string, unknown> = {};
    for (const key of fields) {
        if (edited[key] !== undefined && JSON.stringify(original[key]) !== JSON.stringify(edited[key]))
            changes[key] = edited[key];
    }
    // Legacy string titles may be normalized for the editor without being edited.
    const oldTitle: unknown = original.title;
    if (typeof oldTitle === 'string' && edited.title.es === oldTitle && edited.title.en === oldTitle)
        delete changes.title;
    if (oldTitle && typeof oldTitle === 'object' && 'es' in oldTitle && 'en' in oldTitle) {
        const normalized = { es: oldTitle.es || oldTitle.en || '', en: oldTitle.en || oldTitle.es || '' };
        if (JSON.stringify(normalized) === JSON.stringify(edited.title))
            delete changes.title;
    }
    for (const key of fields)
        if (original[key] === undefined && (edited[key] === '' || (Array.isArray(edited[key]) && edited[key].length === 0)))
            delete changes[key];
    return changes;
}
