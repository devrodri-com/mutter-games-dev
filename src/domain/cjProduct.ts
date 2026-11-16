type OptionalPrice = string | number | null | undefined;
type CJImage = { imageUrl?: string | null };
type CJVariant = {
  variantSku?: string | number | null;
  variantKey?: string | null;
  imageUrl?: string | null;
  sellPrice?: OptionalPrice;
};
type CJProduct = {
  name: string;
  productImageInfoList?: CJImage[] | null;
  productInfo?: { sellPrice?: OptionalPrice; description?: unknown } | null;
  productVariantInfoList?: CJVariant[] | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): value is string | null | undefined {
  return value == null || typeof value === 'string';
}

function optionalPrice(value: unknown): value is OptionalPrice {
  return value == null || typeof value === 'string' || typeof value === 'number';
}

function isProduct(value: unknown): value is CJProduct {
  if (!isRecord(value) || typeof value.name !== 'string') return false;
  const images = value.productImageInfoList;
  const info = value.productInfo;
  const variants = value.productVariantInfoList;
  return (images == null || (Array.isArray(images) && images.every((image: unknown) =>
    isRecord(image) && optionalText(image.imageUrl))))
    && (info == null || (isRecord(info) && optionalPrice(info.sellPrice)))
    && (variants == null || (Array.isArray(variants) && variants.every((variant: unknown) =>
      isRecord(variant) && optionalPrice(variant.variantSku) && optionalText(variant.variantKey)
      && optionalText(variant.imageUrl) && optionalPrice(variant.sellPrice))));
}

export function parseCJProductResponse(value: unknown): CJProduct {
  if (!isRecord(value) || !value.data) throw new Error('Producto no encontrado en CJ');
  if (!isProduct(value.data)) throw new Error('Respuesta de producto inválida de CJ');
  return value.data;
}
