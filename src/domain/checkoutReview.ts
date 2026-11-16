import type { CartItem } from '../data/types';
import type { CheckoutQuote } from '../utils/createPreference';

type PricedLine = { id: string; variantId?: string; quantity: number; unitPrice: number };
function cents(amount: number): number | null {
  const result = Math.round(amount * 100);
  return Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(result)
    && Math.abs(amount * 100 - result) < 0.0000001 ? result : null;
}
function priceLines(lines: readonly PricedLine[]): string | null {
  const quantities = new Map<string, number>();
  for (const line of lines) {
    const price = cents(line.unitPrice);
    if (!line.id || price === null || price <= 0 || !Number.isSafeInteger(line.quantity) || line.quantity < 1) return null;
    const key = JSON.stringify([line.id, line.variantId ?? '', price]);
    quantities.set(key, (quantities.get(key) ?? 0) + line.quantity);
  }
  return quantities.size ? JSON.stringify([...quantities].sort(([left], [right]) => left.localeCompare(right))) : null;
}

/** Compare the amounts visible at submit with the authoritative server quote.
 * Stock is rechecked by the server; a stock-only change is not a price change. */
export function matchesDisplayedCheckout(
  items: readonly CartItem[], total: number, shippingCost: number, quote: CheckoutQuote,
): boolean {
  const displayedTotal = cents(total), displayedShipping = cents(shippingCost);
  const displayedLines = priceLines(items.map(item => ({
    id: item.id, variantId: item.variantId, quantity: item.quantity, unitPrice: item.priceUSD,
  })));
  return quote.currency === 'UYU' && displayedTotal !== null && displayedShipping !== null
    && displayedTotal === cents(quote.total) && displayedShipping === cents(quote.shippingCost)
    && displayedLines !== null && displayedLines === priceLines(quote.items);
}
