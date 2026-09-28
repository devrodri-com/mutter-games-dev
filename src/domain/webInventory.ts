// Shared server/storefront interpretation of the persisted web-only reservation ledger.
// Time alone never removes a hold: only a verified server transition may do that.
export type ReservationLine = { slot: string; identity: string; quantity: number };
export type WebReservation = { expiresAt: number; lines: ReservationLine[] };
export type ReservationMap = Record<string, WebReservation>;
export function inventoryObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Inventario inválido.');
    return value as Record<string, unknown>;
}
export function stockQuantity(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Stock inválido.');
    return value;
}
export function identityForOption(label: Record<string, unknown>, option: Record<string, unknown>): string {
    if (label.es !== undefined && typeof label.es !== 'string' || label.en !== undefined && typeof label.en !== 'string' ||
        typeof option.value !== 'string' || option.variantId !== undefined && typeof option.variantId !== 'string') throw new Error('Opción inválida.');
    return JSON.stringify([label.es ?? '', label.en ?? '', option.value, option.variantId ?? '']);
}
export function parseReservations(input: unknown): ReservationMap {
    if (input === undefined) return {};
    const result: ReservationMap = {};
    for (const [id, raw] of Object.entries(inventoryObject(input))) {
        if (!/^[a-zA-Z0-9_-]{20,100}$/.test(id)) throw new Error('Reserva inválida.');
        const value = inventoryObject(raw);
        if (Object.keys(value).some(k => !['expiresAt', 'lines'].includes(k)) ||
            typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0 ||
            !Array.isArray(value.lines) || !value.lines.length) throw new Error('Reserva inválida.');
        const lines = value.lines.map(rawLine => {
            const line = inventoryObject(rawLine);
            if (Object.keys(line).some(k => !['slot', 'identity', 'quantity'].includes(k)) ||
                typeof line.slot !== 'string' || !/^(base|(0|[1-9]\d*):(0|[1-9]\d*))$/.test(line.slot) ||
                typeof line.identity !== 'string' || !line.identity || stockQuantity(line.quantity) < 1) throw new Error('Reserva inválida.');
            return { slot: line.slot, identity: line.identity, quantity: stockQuantity(line.quantity) };
        });
        result[id] = { expiresAt: value.expiresAt, lines };
    }
    return result;
}
export function reservedQuantity(reservations: ReservationMap, slot: string, excludeId?: string): number {
    const total = Object.entries(reservations).reduce((sum, [id, hold]) => sum + (id === excludeId ? 0 :
        hold.lines.filter(line => line.slot === slot).reduce((count, line) => count + line.quantity, 0)), 0);
    return stockQuantity(total);
}
export function availableStock(product: Record<string, unknown>, slot: string, rawStock: unknown, excludeId?: string): number {
    const holds = parseReservations(product.webReservations);
    for (const hold of Object.values(holds)) {
        for (const line of hold.lines) if (slotInventory(product, line.slot).identity !== line.identity) throw new Error('La reserva requiere verificación.');
    }
    return Math.max(0, stockQuantity(rawStock) - reservedQuantity(holds, slot, excludeId));
}
export function slotInventory(product: Record<string, unknown>, slot: string): { stock: number; identity: string } {
    if (slot === 'base') {
        if (Array.isArray(product.variants) && product.variants.length) throw new Error('La opción cambió.');
        return { stock: stockQuantity(product.stockTotal), identity: 'base' };
    }
    const [v, o] = slot.split(':').map(Number);
    if (!Array.isArray(product.variants)) throw new Error('La opción cambió.');
    const variant = inventoryObject(product.variants[v]);
    if (!Array.isArray(variant.options)) throw new Error('La opción cambió.');
    const option = inventoryObject(variant.options[o]);
    return { stock: stockQuantity(option.stock), identity: identityForOption(inventoryObject(variant.label), option) };
}
