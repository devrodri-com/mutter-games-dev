import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { CheckoutError, record, type Quote } from './checkout-domain.js';
import { parseReservations, reservedQuantity, slotInventory, inventoryObject, stockQuantity, type ReservationLine, type ReservationMap } from '../../src/domain/webInventory.js';

export type InventoryLine = ReservationLine & { productId: string };
export type OrderInventory = {
    state: 'reserved' | 'committed' | 'released';
    reservationId: string;
    expiresAt: number;
    lines: InventoryLine[];
};
export function readInventory(value: unknown): OrderInventory {
    const raw = record(value);
    if (!['reserved', 'committed', 'released'].includes(String(raw.state)) ||
        typeof raw.reservationId !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(raw.reservationId) ||
        typeof raw.expiresAt !== 'number' || !Number.isSafeInteger(raw.expiresAt) || !Array.isArray(raw.lines) || !raw.lines.length) {
        throw new CheckoutError(409, 'RECOVERY_REQUIRED', 'Esta reserva requiere verificación.');
    }
    const lines = raw.lines.map(value => {
        const line = record(value);
        if (typeof line.productId !== 'string' || !line.productId || line.productId.includes('/') ||
            typeof line.slot !== 'string' || !/^(base|(0|[1-9]\d*):(0|[1-9]\d*))$/.test(line.slot) ||
            typeof line.identity !== 'string' || !line.identity || stockQuantity(line.quantity) < 1) throw new Error('Invalid stored inventory');
        return { productId: line.productId, slot: line.slot, identity: line.identity, quantity: stockQuantity(line.quantity) };
    });
    const state = raw.state;
    if (state !== 'reserved' && state !== 'committed' && state !== 'released') throw new Error('Invalid inventory state');
    return { state, reservationId: raw.reservationId, expiresAt: raw.expiresAt, lines };
}
export function inventoryForQuote(quote: Quote, reservationId: string, expiresAt: number): OrderInventory {
    const grouped = new Map<string, InventoryLine>();
    for (const line of quote.items) {
        const key = JSON.stringify([line.id, line.inventorySlot]);
        const previous = grouped.get(key);
        grouped.set(key, { productId: line.id, slot: line.inventorySlot, identity: line.inventoryIdentity, quantity: line.quantity + (previous?.quantity ?? 0) });
    }
    return { state: 'reserved', reservationId, expiresAt, lines: [...grouped.values()] };
}
export function catalogVersion(snapshot: DocumentSnapshot): string {
    const existing = snapshot.data()?.webCatalogVersion;
    if (typeof existing === 'string' && /^\d+:\d+$/.test(existing)) return existing;
    if (!snapshot.updateTime) throw new Error('Missing catalog version');
    return `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}`;
}
export function reserveProducts(tx: Transaction, products: DocumentSnapshot[], inventory: OrderInventory): void {
    for (const snapshot of products) {
        const data = record(snapshot.data());
        const holds = parseReservations(data.webReservations);
        if (Object.keys(holds).length >= 250) throw new CheckoutError(409, 'CATALOG_UNAVAILABLE', 'El producto tiene demasiadas reservas pendientes de verificación.');
        const lines = inventory.lines.filter(line => line.productId === snapshot.id)
            .map(line => ({ slot: line.slot, identity: line.identity, quantity: line.quantity }));
        if (data.stockTotal !== undefined && Array.isArray(data.variants) && data.variants.length) {
            const allHeld = Object.values(holds).flatMap(hold => hold.lines).reduce((sum, line) => sum + line.quantity, 0);
            if (stockQuantity(data.stockTotal) < allHeld + lines.reduce((sum, line) => sum + line.quantity, 0)) {
                throw new CheckoutError(409, 'CATALOG_UNAVAILABLE', 'El inventario requiere revisión antes de comprar.');
            }
        }
        for (const line of lines) {
            const current = slotInventory(data, line.slot);
            if (current.identity !== line.identity || current.stock - reservedQuantity(holds, line.slot) < line.quantity) {
                throw new CheckoutError(409, 'CATALOG_UNAVAILABLE', 'La disponibilidad cambió. Revisá tu carrito.');
            }
        }
        tx.update(snapshot.ref, { webReservations: { ...holds, [inventory.reservationId]: { expiresAt: inventory.expiresAt, lines } }, webCatalogVersion: catalogVersion(snapshot) });
    }
}
type ProductInventoryUpdate = {
    webCatalogVersion: string | FieldValue;
    webReservations: ReservationMap;
    stockTotal?: number;
    variants?: Record<string, unknown>[];
    updatedAt?: FieldValue;
};
// Produces all writes before applying any: failures never commit a partial basket.
export function transitionProducts(products: DocumentSnapshot[], inventory: OrderInventory, commit: boolean): { snapshot: DocumentSnapshot; update: ProductInventoryUpdate }[] {
    return products.map(snapshot => {
        const product = record(snapshot.data());
        const holds = parseReservations(product.webReservations);
        const lines = inventory.lines.filter(line => line.productId === snapshot.id);
        const own = holds[inventory.reservationId];
        const expected = lines.map(line => ({ slot: line.slot, identity: line.identity, quantity: line.quantity }));
        if (inventory.state === 'reserved' && (!own || JSON.stringify(own.lines) !== JSON.stringify(expected))) throw new Error('Reservation ledger mismatch');
        delete holds[inventory.reservationId];
        const update: ProductInventoryUpdate = { webCatalogVersion: catalogVersion(snapshot), webReservations: holds };
        if (!commit) return { snapshot, update };
        const variants = Array.isArray(product.variants) ? product.variants.map(raw => {
            const variant = inventoryObject(raw);
            if (!Array.isArray(variant.options)) throw new Error('Invalid variants');
            return { ...variant, options: variant.options.map(option => ({ ...inventoryObject(option) })) };
        }) : [];
        const decrement = lines.reduce((sum, line) => sum + line.quantity, 0);
        for (const line of lines) {
            const current = slotInventory(product, line.slot);
            if (current.identity !== line.identity || current.stock - reservedQuantity(holds, line.slot) < line.quantity) throw new Error('Paid inventory unavailable');
            if (line.slot === 'base') update.stockTotal = current.stock - line.quantity;
            else {
                const [v, o] = line.slot.split(':').map(Number);
                variants[v].options[o].stock = current.stock - line.quantity;
            }
        }
        if (lines.some(line => line.slot !== 'base')) {
            update.variants = variants;
            // Preserve the existing aggregate, including any historical discrepancy; never reconcile it.
            if (product.stockTotal !== undefined) {
                const total = stockQuantity(product.stockTotal);
                if (total < decrement) throw new Error('Catalog aggregate requires attention');
                update.stockTotal = total - decrement;
            }
        }
        update.webCatalogVersion = FieldValue.delete();
        update.updatedAt = FieldValue.serverTimestamp();
        return { snapshot, update };
    });
}
