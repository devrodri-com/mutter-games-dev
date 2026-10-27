import { FieldValue, type Firestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { assertWebReservationDelete, assertWebReservationEdit } from './web-reservations';
export class ProductPatchError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new ProductPatchError(400, 'Payload inválido.');
    return value as Record<string, unknown>;
};
const strings = ['description', 'slug', 'tipo', 'defaultDescriptionType', 'extraDescriptionTop', 'extraDescriptionBottom', 'customName', 'customNumber', 'sku', 'subtitle'];
const allowed = [...strings, 'title', 'category', 'subcategory', 'descriptionPosition', 'images', 'allowCustomization', 'priceUSD', 'variants', 'stockTotal'];
export function productVersion(snapshot: DocumentSnapshot): string {
    const time = snapshot.updateTime;
    if (!time)
        throw new ProductPatchError(404, 'Producto no encontrado.');
    const catalogVersion: unknown = snapshot.get('webCatalogVersion');
    if (typeof catalogVersion === 'string' && /^\d+:\d+$/.test(catalogVersion)) return catalogVersion;
    return `${time.seconds}:${time.nanoseconds}`;
}
function money(value: unknown) { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new ProductPatchError(400, 'Precio inválido.'); return value; }
function stock(value: unknown) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new ProductPatchError(400, 'Stock inválido.'); return value; }
export function parsePatch(input: unknown) {
    const body = object(input);
    if (Object.keys(body).some(k => !['version', 'intent', 'changes'].includes(k)) || typeof body.version !== 'string' || !/^\d+:\d+$/.test(body.version))
        throw new ProductPatchError(428, 'Actualizá la página y volvé a abrir el producto antes de guardar.');
    const changes = object(body.changes);
    if (!Object.keys(changes).length)
        throw new ProductPatchError(400, 'No hay cambios.');
    if (body.intent === 'publication') {
        if (Object.keys(changes).length !== 1 || typeof changes.active !== 'boolean')
            throw new ProductPatchError(400, 'Cambio de publicación inválido.');
    }
    else if (body.intent === 'edit') {
        if (Object.keys(changes).some(k => !allowed.includes(k)))
            throw new ProductPatchError(400, 'Campo no permitido. La publicación se cambia por separado.');
        for (const [key, value] of Object.entries(changes)) {
            if (strings.includes(key) && (typeof value !== 'string' || value.length > 100000))
                throw new ProductPatchError(400, 'Texto inválido.');
            if (key === 'title') {
                if (typeof value === 'string') {
                    if (!value.trim())
                        throw new ProductPatchError(400, 'Título requerido.');
                }
                else {
                    const t = object(value);
                    if (Object.keys(t).some(k => !['es', 'en'].includes(k)) || Object.values(t).some(v => typeof v !== 'string') || !Object.values(t).some(v => typeof v === 'string' && v.trim()))
                        throw new ProductPatchError(400, 'Título inválido.');
                }
            }
            if (key === 'category' || key === 'subcategory') {
                const c = object(value);
                if (Object.keys(c).some(k => !['id', 'name', 'categoryId'].includes(k)) || Object.values(c).some(v => typeof v !== 'string'))
                    throw new ProductPatchError(400, 'Categoría inválida.');
            }
            if (key === 'descriptionPosition' && !['top', 'bottom'].includes(String(value)))
                throw new ProductPatchError(400, 'Posición inválida.');
            if (key === 'images' && (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !/^https:\/\//.test(v))))
                throw new ProductPatchError(400, 'Imágenes inválidas.');
            if (key === 'allowCustomization' && typeof value !== 'boolean')
                throw new ProductPatchError(400, 'Personalización inválida.');
            if (key === 'priceUSD')
                money(value);
            if (key === 'stockTotal')
                stock(value);
            if (key === 'variants') {
                if (!Array.isArray(value))
                    throw new ProductPatchError(400, 'Variantes inválidas.');
                for (const raw of value) {
                    const v = object(raw);
                    const label = object(v.label);
                    if (v.title !== undefined && typeof v.title !== 'string' && (Object.keys(object(v.title)).some(k => !['es', 'en'].includes(k)) || Object.values(object(v.title)).some(t => typeof t !== 'string')))
                        throw new ProductPatchError(400, 'Título de variante inválido.');
                    if (Object.keys(v).some(k => !['label', 'options', 'title'].includes(k)) || Object.values(label).some(t => typeof t !== 'string') || Object.keys(label).some(k => !['es', 'en'].includes(k)) || !Array.isArray(v.options) || !v.options.length)
                        throw new ProductPatchError(400, 'Variante inválida.');
                    for (const rawOption of v.options) {
                        const o = object(rawOption);
                        if (Object.keys(o).some(k => !['value', 'priceUSD', 'stock', 'variantLabel', 'variantId'].includes(k)) || typeof o.value !== 'string' || !o.value.trim())
                            throw new ProductPatchError(400, 'Opción inválida.');
                        money(o.priceUSD);
                        if (o.stock !== undefined)
                            stock(o.stock);
                        for (const k of ['variantLabel', 'variantId'])
                            if (o[k] !== undefined && typeof o[k] !== 'string')
                                throw new ProductPatchError(400, 'Identificador inválido.');
                    }
                }
            }
        }
    }
    else
        throw new ProductPatchError(400, 'Intención inválida.');
    return { version: body.version, changes };
}
export function prepareProductPatch(snap: DocumentSnapshot, input: unknown): Record<string, unknown> {
        const { version, changes } = parsePatch(input);
        if (!snap.exists)
            throw new ProductPatchError(404, 'Producto no encontrado.');
        if (productVersion(snap) !== version)
            throw new ProductPatchError(409, 'El producto cambió mientras lo editabas. Cerrá y volvé a abrir para revisar los cambios. No se guardó tu edición.');
        const current = object(snap.data());
        const update: Record<string, unknown> = {
            ...changes, updatedAt: FieldValue.serverTimestamp(), webCatalogVersion: FieldValue.delete(),
        };
        if (changes.title !== undefined) {
            const title = typeof changes.title === 'string' ? changes.title : { ...(typeof current.title === 'object' && current.title ? object(current.title) : {}), ...object(changes.title) };
            update.title = title;
            const text = typeof title === 'string' ? title : String(title.es || title.en || '');
            update.sortKey = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
        }
        for (const key of ['category', 'subcategory'])
            if (changes[key] !== undefined) {
                update[key] = { ...(current[key] && typeof current[key] === 'object' ? object(current[key]) : {}), ...object(changes[key]) };
            }
        if (Array.isArray(changes.variants) && changes.variants.length) {
            const options = changes.variants.flatMap(v => object(v).options as unknown[]).map(object);
            update.priceUSD = Math.min(...options.map(o => money(o.priceUSD)));
            // Do not manufacture stock for legacy variants lacking a stock field.
            if (options.every(o => o.stock !== undefined))
                update.stockTotal = options.reduce((sum, o) => sum + stock(o.stock), 0);
        }
        assertWebReservationEdit(current, { ...current, ...update });
        return update;
}
export async function patchProduct(db: Firestore, id: string, input: unknown) {
    const ref = db.collection('products').doc(id);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        tx.update(ref, prepareProductPatch(snap, input));
    });
    return { id, updated: true };
}

export async function deleteProduct(db: Firestore, id: string) {
    const ref = db.collection('products').doc(id);
    await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new ProductPatchError(404, 'Producto no encontrado.');
        assertWebReservationDelete(object(snapshot.data()));
        tx.delete(ref);
    });
    return { id, deleted: true };
}
