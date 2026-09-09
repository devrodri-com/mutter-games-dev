import type { Product, CartItem } from '../data/types';
export const isPublished = (data: {
    active?: unknown;
}): boolean => data.active === true;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
export function mapCatalogProduct(id: string, input: unknown): Product {
    const data = object(input);
    const rawTitle = object(data.title);
    const title = { es: text(data.title, text(rawTitle.es, text(data.titleEs, 'Producto'))), en: text(rawTitle.en, text(data.titleEn)) };
    const category = object(data.category);
    const subcategory = object(data.subcategory);
    const variants: NonNullable<Product['variants']> = [];
    if (data.variants !== undefined && !Array.isArray(data.variants))
        throw new Error('Datos de variantes inválidos.');
    for (const raw of Array.isArray(data.variants) ? data.variants : []) {
        const variant = object(raw);
        const label = object(variant.label);
        if (!Array.isArray(variant.options))
            throw new Error('Datos de opciones inválidos.');
        variants.push({ label: { es: text(label.es), en: text(label.en) }, options: variant.options.map(raw => {
                const option = object(raw);
                if (typeof option.value !== 'string' || typeof option.priceUSD !== 'number' || !Number.isFinite(option.priceUSD))
                    throw new Error('Precio de opción inválido.');
                return { value: option.value, priceUSD: option.priceUSD, ...(typeof option.stock === 'number' ? { stock: option.stock } : {}), ...(typeof option.variantId === 'string' ? { variantId: option.variantId } : {}), ...(typeof option.variantLabel === 'string' ? { variantLabel: option.variantLabel } : {}) };
            }) });
    }
    return { id, title, name: text(data.name, title.es), slug: text(data.slug, `${id}-${title.es.toLowerCase().replace(/\s+/g, '-')}`), description: text(data.description), priceUSD: typeof data.priceUSD === 'number' ? data.priceUSD : NaN, active: isPublished(data), images: Array.isArray(data.images) ? data.images.filter((v): v is string => typeof v === 'string') : [], category: { id: text(category.id), name: text(category.name) }, subcategory: { id: text(subcategory.id), name: text(subcategory.name), categoryId: text(subcategory.categoryId) }, variants, stockTotal: typeof data.stockTotal === 'number' ? data.stockTotal : undefined, tipo: text(data.tipo), subtitle: text(data.subtitle), defaultDescriptionType: text(data.defaultDescriptionType, 'none'), extraDescriptionTop: text(data.extraDescriptionTop), extraDescriptionBottom: text(data.extraDescriptionBottom), descriptionPosition: data.descriptionPosition === 'top' ? 'top' : 'bottom', allowCustomization: data.allowCustomization === true, customName: text(data.customName), customNumber: text(data.customNumber) };
}
export function currentCartItem(item: CartItem, product: Product | null): CartItem {
    if (!product || !isPublished(product))
        return { ...item, availability: 'unavailable' };
    let price = product.priceUSD;
    let stock = product.stockTotal;
    if (product.variants?.length) {
        const options = product.variants.flatMap(v => v.options.filter(o => Boolean(item.variantId) && [o.variantId, `${v.label.es}-${o.value}`, `${v.label.en}-${o.value}`].includes(item.variantId)));
        if (options.length !== 1)
            return { ...item, availability: 'unavailable' };
        price = options[0].priceUSD;
        stock = options[0].stock;
    }
    else if (item.variantId)
        return { ...item, availability: 'unavailable' };
    const available = Number.isFinite(price) && price > 0 && typeof stock === 'number' && Number.isSafeInteger(stock) && stock >= item.quantity && Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99;
    return { ...item, title: product.title, name: product.name, image: product.images?.[0] ?? item.image, priceUSD: price, price, stock, availability: available ? 'available' : 'unavailable', priceChanged: item.priceUSD !== price || item.priceChanged === true };
}
