import { canonicalJson } from './catalog-edit-fields.js';
import { inventoryObject, parseReservations, reservedQuantity, slotInventory, stockQuantity } from '../../src/domain/webInventory.js';

function quantity(value: unknown): number {
  try { return stockQuantity(value); }
  catch { throw new Error('El stock debe ser un número entero, igual o mayor que cero.'); }
}

/** Calculate only the explicit option delta. Historical aggregate differences
 * and missing aggregate fields are preserved, never silently reconciled. */
function optionDelta(previous: unknown, next: unknown): { changed: boolean; quantity: number } {
  if (!Array.isArray(next)) return { changed: false, quantity: 0 };
  const before = Array.isArray(previous) ? previous : [];
  let changed = false, delta = 0;
  for (const [index, raw] of next.entries()) {
    const variant = inventoryObject(raw), old = before[index] === undefined ? {} : inventoryObject(before[index]);
    if (!Array.isArray(variant.options)) continue;
    const oldOptions = Array.isArray(old.options) ? old.options : [];
    for (const [position, value] of variant.options.entries()) {
      const option = inventoryObject(value), previousOption = oldOptions[position];
      const oldStock = previousOption === undefined ? 0 : inventoryObject(previousOption).stock;
      if (canonicalJson(option.stock ?? null) === canonicalJson(oldStock ?? null)) continue;
      const nextStock = quantity(option.stock);
      const previousStock = quantity(oldStock);
      changed = true; delta += nextStock - previousStock;
      if (!Number.isSafeInteger(delta)) throw new Error('El cambio de stock supera el límite permitido.');
    }
  }
  return { changed, quantity: delta };
}

/** Shared by the actual editor/readback and the authoritative transaction.
 * Returns only additional aggregate changes; never writes reservations/states. */
export function prepareCatalogStockUpdate(current: Record<string, unknown>, update: Record<string, unknown>): Record<string, number> {
  const nextVariants = Object.hasOwn(update, 'variants') ? update.variants : current.variants;
  const hasVariants = Array.isArray(nextVariants) && nextVariants.length > 0;
  const hasBaseUpdate = Object.hasOwn(update, 'stockTotal');
  if (hasBaseUpdate && hasVariants) throw new Error('Editá el stock de cada opción; el total se ajusta con esos cambios.');
  if (hasBaseUpdate) quantity(update.stockTotal);
  const delta = Object.hasOwn(update, 'variants') ? optionDelta(current.variants, nextVariants) : { changed: false, quantity: 0 };
  if (!hasBaseUpdate && !delta.changed) return {};
  const additional: Record<string, number> = {};
  if (delta.changed && current.stockTotal !== undefined) {
    const total = quantity(current.stockTotal) + delta.quantity;
    additional.stockTotal = quantity(total);
  }
  const next = { ...current, ...update, ...additional };
  try {
    const holds = parseReservations(current.webReservations);
    const slots = new Set<string>();
    let totalReserved = 0;
    for (const hold of Object.values(holds)) for (const line of hold.lines) {
      if (slotInventory(current, line.slot).identity !== line.identity || slotInventory(next, line.slot).identity !== line.identity)
        throw new Error('Reservation identity mismatch');
      slots.add(line.slot); totalReserved += line.quantity;
    }
    quantity(totalReserved);
    for (const slot of slots) if (slotInventory(next, slot).stock < reservedQuantity(holds, slot))
      throw new Error('Reserved quantity exceeds stock');
    if (next.stockTotal !== undefined && quantity(next.stockTotal) < totalReserved)
      throw new Error('Reserved quantity exceeds total');
  } catch {
    throw new Error('No se puede guardar un stock menor que las unidades reservadas ni modificar una reserva que requiere revisión.');
  }
  return additional;
}
