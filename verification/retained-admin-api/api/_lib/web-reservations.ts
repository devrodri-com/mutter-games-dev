/** Server-owned web holds remain binding until payment reconciliation removes them. */
export class WebReservationError extends Error {
    readonly status = 409;
}

type Hold = { slot: string; identity: string; quantity: number };
const conflict = (): never => {
    throw new WebReservationError('Las reservas web requieren verificación. No se guardó el cambio.');
};
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return conflict();
    return value as Record<string, unknown>;
}
function validSlot(value: unknown): value is string {
    if (value === 'base') return true;
    return typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value)
        && value.split(':').every(part => Number.isSafeInteger(Number(part)));
}
function holds(product: Record<string, unknown>): Hold[] {
    if (product.webReservations === undefined) return [];
    const reservations = object(product.webReservations);
    const result: Hold[] = [];
    for (const [id, raw] of Object.entries(reservations)) {
        if (!/^[a-zA-Z0-9_-]{20,100}$/.test(id)) return conflict();
        const reservation = object(raw);
        if (Object.keys(reservation).some(key => !['expiresAt', 'lines'].includes(key))
            || typeof reservation.expiresAt !== 'number' || !Number.isSafeInteger(reservation.expiresAt)
            || reservation.expiresAt <= 0 || !Array.isArray(reservation.lines) || !reservation.lines.length) return conflict();
        // expiresAt schedules a provider check. Time alone never makes a persisted hold disappear.
        for (const rawLine of reservation.lines) {
            const line = object(rawLine);
            if (Object.keys(line).some(key => !['slot', 'identity', 'quantity'].includes(key))
                || !validSlot(line.slot) || typeof line.identity !== 'string' || !line.identity
                || typeof line.quantity !== 'number' || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) return conflict();
            result.push({ slot: line.slot, identity: line.identity, quantity: line.quantity });
        }
    }
    return result;
}
function slotState(product: Record<string, unknown>, slot: string): { identity: string; stock: number } {
    if (product.variants !== undefined && !Array.isArray(product.variants)) return conflict();
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (slot === 'base') {
        if (variants.length || typeof product.stockTotal !== 'number'
            || !Number.isSafeInteger(product.stockTotal) || product.stockTotal < 0) return conflict();
        return { identity: 'base', stock: product.stockTotal };
    }
    const [variantIndex, optionIndex] = slot.split(':').map(Number);
    const variant = object(variants[variantIndex]);
    const label = object(variant.label);
    if (!Array.isArray(variant.options)) return conflict();
    const option = object(variant.options[optionIndex]);
    if ((label.es !== undefined && typeof label.es !== 'string')
        || (label.en !== undefined && typeof label.en !== 'string')
        || typeof option.value !== 'string'
        || (option.variantId !== undefined && typeof option.variantId !== 'string')
        || typeof option.stock !== 'number' || !Number.isSafeInteger(option.stock) || option.stock < 0) return conflict();
    return {
        identity: JSON.stringify([label.es ?? '', label.en ?? '', option.value, option.variantId ?? '']),
        stock: option.stock,
    };
}

export function assertWebReservationEdit(current: Record<string, unknown>, next: Record<string, unknown>): void {
    const totals = new Map<string, number>();
    let allHeld = 0;
    for (const hold of holds(current)) {
        const before = slotState(current, hold.slot);
        const after = slotState(next, hold.slot);
        if (before.identity !== hold.identity || after.identity !== hold.identity) {
            throw new WebReservationError('No se puede cambiar o quitar una opción con reservas web pendientes.');
        }
        const quantity = (totals.get(hold.slot) ?? 0) + hold.quantity;
        if (!Number.isSafeInteger(quantity)) return conflict();
        totals.set(hold.slot, quantity);
        allHeld += hold.quantity;
        if (!Number.isSafeInteger(allHeld)) return conflict();
        if (after.stock < quantity) {
            throw new WebReservationError('El stock no puede ser menor que las unidades reservadas por compras web.');
        }
    }
    if (allHeld && next.stockTotal !== undefined) {
        if (typeof next.stockTotal !== 'number' || !Number.isSafeInteger(next.stockTotal) || next.stockTotal < 0) return conflict();
        if (next.stockTotal < allHeld) {
            throw new WebReservationError('El stock total no puede ser menor que todas las unidades reservadas por compras web.');
        }
    }
}

export function assertWebReservationDelete(product: Record<string, unknown>): void {
    if (holds(product).length) {
        throw new WebReservationError('No se puede eliminar un producto con reservas web pendientes.');
    }
}
