import type { CartItem } from '../data/types';

const amountFormat = new Intl.NumberFormat('es-UY', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Presentation only: callers retain the existing numeric calculations. */
export function formatCartAmount(amount: number): string {
  return `$${amountFormat.format(amount)}`;
}

export function cartText(value: unknown, language: 'es' | 'en', fallback = ''): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return fallback;
  if (language in value) {
    const text = Reflect.get(value, language);
    if (typeof text === 'string' && text) return text;
  }
  return Object.values(value).find((text): text is string => typeof text === 'string' && Boolean(text)) ?? fallback;
}

export function cartItemTitle(item: CartItem, language: 'es' | 'en'): string {
  return cartText(item.title, language, 'Sin título');
}

