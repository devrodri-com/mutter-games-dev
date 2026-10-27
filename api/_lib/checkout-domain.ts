import { createHash } from 'node:crypto';
import { availableStock, identityForOption } from '../../src/domain/webInventory.js';
export class CheckoutError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
}
export function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new CheckoutError(400, 'INVALID_INPUT', 'Datos de compra inválidos.');
    return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
    if (Object.keys(value).some(key => !allowed.includes(key)))
        throw new CheckoutError(400, 'UPDATE_REQUIRED', 'Actualizá la página para continuar con una compra segura.');
}
function text(value: unknown, max = 200): string {
    if (typeof value !== 'string' || value.length > max)
        throw new CheckoutError(400, 'INVALID_INPUT', 'Datos de compra inválidos.');
    return value.trim();
}
export type Selection = {
    id: string;
    variantId: string;
    quantity: number;
    customName: string;
    customNumber: string;
};
export type Shipping = {
    pickup: boolean;
    department: string;
    name: string;
    address: string;
    city: string;
    postalCode: string;
    phone: string;
    email: string;
};
export type Purchase = {
    items: Selection[];
    shipping: Shipping;
};
export type CanonicalLine = Selection & {
    title: string;
    unitPrice: number;
    stock: number;
    inventorySlot: string;
    inventoryIdentity: string;
};
export type Quote = {
    items: CanonicalLine[];
    shippingCost: number;
    total: number;
    currency: 'UYU';
    hash: string;
};
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const departments = ['Artigas', 'Canelones', 'Cerro Largo', 'Colonia', 'Durazno', 'Flores', 'Florida', 'Lavalleja', 'Maldonado', 'Montevideo', 'Paysandú', 'Río Negro', 'Rivera', 'Rocha', 'Salto', 'San José', 'Soriano', 'Tacuarembó', 'Treinta y Tres'];
export function parsePurchase(value: unknown): Purchase {
    const data = record(value);
    keys(data, ['items', 'shipping']);
    if (!Array.isArray(data.items) || !data.items.length || data.items.length > 100)
        throw new CheckoutError(400, 'INVALID_ITEMS', 'Revisá los productos del carrito.');
    const aggregated = new Map<string, Selection>();
    for (const raw of data.items) {
        const item = record(raw);
        keys(item, ['id', 'variantId', 'quantity', 'customName', 'customNumber']);
        const id = text(item.id);
        if (!id || id.includes('/'))
            throw new CheckoutError(400, 'INVALID_ID', 'Producto inválido.');
        const variantId = text(item.variantId ?? '');
        if (typeof item.quantity !== 'number' || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)
            throw new CheckoutError(400, 'INVALID_QUANTITY', 'La cantidad debe ser un entero entre 1 y 99.');
        const selection = { id, variantId, quantity: item.quantity, customName: text(item.customName ?? ''), customNumber: text(item.customNumber ?? '', 30) };
        const key = JSON.stringify([id, variantId, selection.customName, selection.customNumber]);
        const previous = aggregated.get(key);
        selection.quantity += previous?.quantity ?? 0;
        if (selection.quantity > 99)
            throw new CheckoutError(400, 'INVALID_QUANTITY', 'La cantidad máxima por opción es 99.');
        aggregated.set(key, selection);
    }
    const rawShipping = record(data.shipping);
    keys(rawShipping, ['pickup', 'department', 'name', 'address', 'city', 'postalCode', 'phone', 'email']);
    if (typeof rawShipping.pickup !== 'boolean')
        throw new CheckoutError(400, 'INVALID_SHIPPING', 'Elegí el método de entrega.');
    const shipping: Shipping = { pickup: rawShipping.pickup, department: text(rawShipping.department), name: text(rawShipping.name), address: text(rawShipping.address, 500), city: text(rawShipping.city), postalCode: text(rawShipping.postalCode, 30), phone: text(rawShipping.phone, 40), email: text(rawShipping.email) };
    if (!shipping.name || !shipping.phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shipping.email) || (!shipping.pickup && (!departments.includes(shipping.department) || !shipping.address || !shipping.city)))
        throw new CheckoutError(400, 'INVALID_SHIPPING', 'Completá los datos de contacto y entrega.');
    return { items: [...aggregated.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), shipping };
}
function unavailable(): never { throw new CheckoutError(409, 'CATALOG_UNAVAILABLE', 'Un producto u opción ya no está disponible. Revisá tu carrito.'); }
function nonnegative(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    unavailable(); return value; }
export function quotePurchase(purchase: Purchase, catalog: Map<string, unknown>, excludeReservationId?: string): Quote {
    const quantities = new Map<string, number>();
    const lines = purchase.items.map(item => {
        const raw = catalog.get(item.id);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            unavailable();
        const product = record(raw);
        if (product.active !== true)
            unavailable();
        const title = typeof product.title === 'string' ? product.title : typeof product.title === 'object' && product.title ? record(product.title).es ?? record(product.title).en : product.name;
        if (typeof title !== 'string' || !title.trim())
            unavailable();
        let price = product.priceUSD;
        let stock = product.stockTotal;
        let canonicalVariant = 'base';
        let inventoryIdentity = 'base';
        if (product.variants !== undefined && !Array.isArray(product.variants))
            unavailable();
        if (Array.isArray(product.variants) && product.variants.length) {
            const matches: {
                price: unknown;
                stock: unknown;
                key: string;
                identity: string;
            }[] = [];
            product.variants.forEach((v, index) => {
                const variant = record(v);
                const label = record(variant.label);
                if (!Array.isArray(variant.options))
                    unavailable();
                variant.options.forEach((o, optionIndex) => {
                    const option = record(o);
                    const aliases = [option.variantId, `${label.es}-${option.value}`, `${label.en}-${option.value}`];
                    if (item.variantId && aliases.includes(item.variantId))
                        matches.push({ price: option.priceUSD, stock: option.stock, key: `${index}:${optionIndex}`, identity: identityForOption(label, option) });
                });
            });
            if (matches.length !== 1)
                unavailable();
            price = matches[0].price;
            stock = matches[0].stock;
            canonicalVariant = matches[0].key;
            inventoryIdentity = matches[0].identity;
        }
        else if (item.variantId)
            unavailable();
        const unitPrice = nonnegative(price);
        let available: number;
        try { available = availableStock(product, canonicalVariant, stock, excludeReservationId); }
        catch { unavailable(); }
        if (!Number.isSafeInteger(available) || unitPrice <= 0 || !Number.isSafeInteger(Math.round(unitPrice * 100)))
            unavailable();
        if ((item.customName || item.customNumber) && product.allowCustomization !== true)
            unavailable();
        const key = `${item.id}/${canonicalVariant}`;
        const total = (quantities.get(key) ?? 0) + item.quantity;
        quantities.set(key, total);
        if (total > 99 || total > available)
            unavailable();
        return { ...item, title: title.trim(), unitPrice: Math.round(unitPrice * 100) / 100, stock: available, inventorySlot: canonicalVariant, inventoryIdentity };
    });
    // Existing storefront policy: UYU structured data and $169 Montevideo; DAC paid on arrival.
    const shippingCost = purchase.shipping.pickup ? 0 : purchase.shipping.department === 'Montevideo' ? 169 : 0;
    const total = (lines.reduce((sum, line) => sum + Math.round(line.unitPrice * 100) * line.quantity, 0) + shippingCost * 100) / 100;
    if (!Number.isSafeInteger(Math.round(total * 100)))
        unavailable();
    const quote = { items: lines, shippingCost, total, currency: 'UYU' as const };
    // Reservation churn is not a price change; availability is checked in the admitting transaction.
    const pricedItems = lines.map(line => ({ ...line, stock: undefined }));
    return { ...quote, hash: hash({ ...quote, items: pricedItems }) };
}
