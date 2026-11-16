import type { CartItem, Product } from '../data/types';
import { cartText } from '../utils/cartPresentation';
import { currentCartItem, currentCartOption, isPublished } from './catalog';

type Description = Readonly<{ label: Readonly<{ es: string; en: string }>; value: string }>;
// CartItem is persisted elsewhere. Keep this optional view data off the object,
// including when a projected item is passed to removal, serialization or checkout.
const descriptions = new WeakMap<CartItem, Description>();

export function currentCartView(item: CartItem, product: Product | null | 'unverified'): CartItem {
  if (product === 'unverified') return { ...item, availability: 'unverified' };
  const current = currentCartItem(item, product);
  const selected = product && isPublished(product) ? currentCartOption(item, product) : undefined;
  if (selected) descriptions.set(current, { label: { ...selected.label }, value: selected.option.value });
  return current;
}

const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('es-UY').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function cartVariantDescription(item: CartItem, language: 'es' | 'en'): string {
  const description = descriptions.get(item);
  const fallback = item.variantId ? (language === 'en' ? 'Selected option' : 'Opción seleccionada') : '';
  if (!description) return fallback;
  const value = description.value.trim();
  if (!value) return fallback;
  const condition = normalized(value);
  if (condition === 'nuevo' || condition === 'usado') {
    return language === 'en'
      ? `Condition: ${condition === 'nuevo' ? 'New' : 'Used'}`
      : `Condición: ${condition === 'nuevo' ? 'Nuevo' : 'Usado'}`;
  }
  const label = cartText(description.label, language).trim();
  const labelKey = normalized(label), valueKey = normalized(value);
  const redundantLabel = !labelKey || /^\d+$/u.test(labelKey) || labelKey === valueKey;
  return redundantLabel ? value : `${label}: ${value}`;
}
