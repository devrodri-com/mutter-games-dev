import type { Product } from '../data/types';

import { publicationDescriptionText } from '../components/admin/publication-description';

/** Keep literal comparisons out of the legacy markup projection. The result is
 * text only: entities decode once and React must escape every fallback. */
export function productDescriptionText(value: string): string {
  const literalAngles = value.replace(/<(?!\/?[a-z][a-z0-9:-]*(?=\s|\/?>|$)|!--)/gi, '&lt;');
  return publicationDescriptionText(literalAngles);
}

export type ProductDescriptionValue = Product['description'];

/** Public reads retain the supplied languages; display never creates a translation. */
export function normalizeProductDescription(value: unknown): ProductDescriptionValue {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return '';
  return {
    ...('es' in value && typeof value.es === 'string' ? { es: value.es } : {}),
    ...('en' in value && typeof value.en === 'string' ? { en: value.en } : {}),
  };
}

export function selectProductDescription(value: ProductDescriptionValue, language: 'es' | 'en'): string {
  return typeof value === 'string' ? value : value[language] ?? '';
}

/** The legacy editor changes Spanish only and retains the original object when untouched. */
export function editSpanishProductDescription(value: ProductDescriptionValue, edited: string): ProductDescriptionValue {
  if (typeof value === 'string') return edited;
  return edited === (value.es ?? '') ? value : { ...value, es: edited };
}
