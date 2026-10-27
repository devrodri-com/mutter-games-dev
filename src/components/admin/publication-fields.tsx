import type { Category } from '../../data/types';
import { isObject, type CatalogEditField, type JsonObject, type JsonValue } from '../../domain/catalogEdit';
import { TIPOS } from '../../constants/tipos';
import ScopedDescriptionInput from './ScopedDescriptionInput';
import PublicationImages from './publication-images';
import PublicationVariants, { PublicationStockAvailability, PublicationStockInput } from './publication-variants';
import { selectedPublicationSubcategory } from './publication-classification';
import { prepareCatalogStockUpdate } from '../../../api/_lib/catalog-edit-stock';
import { stockQuantity } from '../../domain/webInventory';
import MutterSelect from './MutterSelect';

const text = (value: unknown) => typeof value === 'string' ? value : '';
const id = (value: JsonValue | undefined) => typeof value === 'string' ? value : isObject(value) ? text(value.id) : '';
const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50';
export type PublicationFieldsProps = {
  productId: string; original: JsonObject; product: JsonObject; categories: Category[]; disabled: boolean; creating?: boolean;
  onChange: (field: CatalogEditField, value: JsonValue) => void;
  onImageOperation: (operationId: string) => void; onImageBusy: (value: boolean) => void;
};
export default function PublicationFields({ productId, original, product, categories, disabled, creating = false, onChange, onImageOperation, onImageBusy }: PublicationFieldsProps) {
  const categoryId = id(product.category), subcategoryId = id(product.subcategory);
  const subcategories = categories.find(category => category.id === categoryId)?.subcategories ?? [];
  const selectedSubcategory = selectedPublicationSubcategory(product, categories);
  const subcategoryValue = selectedSubcategory?.id ?? '';
  const originalClassificationVisible = !creating && categoryId === id(original.category) && subcategoryId === id(original.subcategory);
  const hasVariantOptions = Array.isArray(product.variants) && product.variants.some(variant => isObject(variant) && Array.isArray(variant.options) && variant.options.length > 0);
  const creationOptions = creating && Array.isArray(product.variants) ? product.variants.flatMap(variant => isObject(variant) && Array.isArray(variant.options) ? variant.options : []) : [];
  const creationPrices = creationOptions.flatMap(option => isObject(option) && typeof option.priceUSD === 'number' && Number.isFinite(option.priceUSD) ? [option.priceUSD] : []);
  const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
  const baseStockEditable = product.variants === undefined || Array.isArray(product.variants) && !product.variants.length;
  let totalStock = product.stockTotal, stockError: string | null = null;
  try {
    if (creating && creationOptions.length) totalStock = creationOptions.reduce<number>((total, option) =>
      stockQuantity(total + stockQuantity(isObject(option) ? option.stock : undefined)), 0);
    else if (!creating) {
      const update = hasVariants ? { variants: product.variants }
        : product.stockTotal !== original.stockTotal ? { stockTotal: product.stockTotal } : {};
      totalStock = prepareCatalogStockUpdate(original, update).stockTotal ?? product.stockTotal;
    }
  } catch (error: unknown) { stockError = error instanceof Error ? error.message : 'No pudimos calcular el stock. Revisá las cantidades.'; }
  let stockDiscrepancy = false;
  if (hasVariants && Array.isArray(product.variants)) {
    try {
      let optionTotal = 0;
      for (const variant of product.variants) {
        if (!isObject(variant) || !Array.isArray(variant.options)) throw new Error('Opciones sin formato legible.');
        for (const option of variant.options) optionTotal = stockQuantity(optionTotal + stockQuantity(isObject(option) ? option.stock : undefined));
      }
      stockDiscrepancy = stockQuantity(totalStock) !== optionTotal;
    } catch (error: unknown) {
      stockError ??= error instanceof Error ? `No pudimos comprobar la suma de las opciones. ${error.message}` : 'No pudimos comprobar la suma de las opciones.';
    }
  }
  return <div className="mutter-fields space-y-7">
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="mb-3 text-base font-semibold">Información de la publicación</legend>
      {typeof original.title === 'string'
        ? <label className="block text-sm font-medium">Título<input className={inputClass} value={text(product.title)} onChange={event => onChange('title', event.target.value)} /></label>
        : <label className="block text-sm font-medium">Título<input className={inputClass} value={isObject(product.title) ? text(product.title.es) : ''}
          onChange={event => onChange('title', { es: event.target.value })} /></label>}
      <label className="block text-sm font-medium">Subtítulo<input className={inputClass} value={text(product.subtitle)} onChange={event => onChange('subtitle', event.target.value)} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <MutterSelect label="Categoría" value={categoryId} disabled={disabled} onChange={value => {
          const selected = categories.find(category => category.id === value);
          if (selected) onChange('category', { id: selected.id, name: selected.name });
        }} options={[{ value: categoryId, label: categories.find(category => category.id === categoryId)?.name || (categoryId ? 'Categoría actual conservada' : 'Elegir categoría') },
          ...categories.filter(category => category.id !== categoryId).map(category => ({ value: category.id, label: category.name }))]} />
        <MutterSelect label="Subcategoría" value={subcategoryValue} disabled={disabled} onChange={value => {
          const selected = subcategories.find(subcategory => subcategory.id === value && subcategory.categoryId === categoryId);
          if (selected) {
            // A deliberate classification selection may replace the legacy string;
            // unrelated edits never normalize that stored value.
            const category = categories.find(item => item.id === categoryId);
            if (typeof product.category === 'string' && category) onChange('category', { id: category.id, name: category.name });
            onChange('subcategory', { id: selected.id, name: selected.name, categoryId: selected.categoryId });
          }
        }} options={[{ value: '', label: originalClassificationVisible && subcategoryId ? 'Subcategoría actual conservada' : 'Elegir subcategoría', disabled: true },
          ...subcategories.filter(subcategory => subcategory.categoryId === categoryId).map(subcategory => ({ value: subcategory.id, label: subcategory.name }))]} />
        <MutterSelect label="Tipo" value={text(product.tipo)} disabled={disabled} onChange={value => onChange('tipo', value)}
          options={[...(!TIPOS.includes(text(product.tipo)) ? [{ value: text(product.tipo), label: text(product.tipo) || 'Elegir tipo' }] : []),
            ...TIPOS.map(type => ({ value: type, label: type }))]} />
        <label className="text-sm font-medium">SKU<input className={inputClass} value={text(product.sku)} onChange={event => onChange('sku', event.target.value)} /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {creationPrices.length ? <div className="text-sm font-medium">Precio desde<output className="mt-1 block rounded-lg bg-gray-50 px-3 py-2 font-normal">{Math.min(...creationPrices)}</output><p className="mt-1 text-xs font-normal text-gray-500">Se calcula con los precios de las opciones.</p></div>
          : <label className="text-sm font-medium">Precio general<input className={inputClass} type="number" min="0" step="0.01" value={typeof product.priceUSD === 'number' ? product.priceUSD : ''} disabled={hasVariantOptions}
            onChange={event => { if (!hasVariantOptions && Number.isFinite(event.target.valueAsNumber)) onChange('priceUSD', event.target.valueAsNumber); }} />{hasVariantOptions && <span className="mt-1 block text-xs font-normal text-gray-500">Valor conservado. Editá el precio de cada opción.</span>}</label>}
        {baseStockEditable ? <div><PublicationStockInput value={product.stockTotal} label="Stock total" name="Stock total" disabled={disabled}
          onChange={stock => onChange('stockTotal', stock)} /><PublicationStockAvailability product={product} slot="base" value={product.stockTotal} /></div>
          : <div className="text-sm font-medium">Stock total<output aria-label="Stock total" className="mt-1 block rounded-lg bg-gray-50 px-3 py-2 font-normal">{typeof totalStock === 'number' ? totalStock : 'Sin dato'}</output>
            <p className="mt-1 text-xs font-normal text-gray-500">Se ajusta con los cambios de cantidad de las opciones.</p></div>}
      </div>
      {stockDiscrepancy && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">El total registrado difiere de la suma de las opciones. Esa diferencia se conserva al guardar.</p>}
      {stockError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{stockError} El stock todavía no se guardó.</p>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={product.allowCustomization === true} onChange={event => onChange('allowCustomization', event.target.checked)} />Permitir personalización</label>
      {product.allowCustomization === true && <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">Nombre personalizado<input className={inputClass} value={text(product.customName)} onChange={event => onChange('customName', event.target.value)} /></label>
        <label className="text-sm">Número personalizado<input className={inputClass} value={text(product.customNumber)} onChange={event => onChange('customNumber', event.target.value)} /></label>
      </div>}
    </fieldset>
    <PublicationImages productId={productId} value={product.images} disabled={disabled} onChange={value => onChange('images', value)} onOperation={onImageOperation} onBusy={onImageBusy} />
    <PublicationVariants value={product.variants} product={product} disabled={disabled} creating={creating} onChange={value => onChange('variants', value)} />
    <fieldset disabled={disabled} className="space-y-4 border-t border-gray-200 pt-5">
      <legend className="mb-3 text-base font-semibold">Descripción</legend>
      {isObject(original.description) ? <ScopedDescriptionInput
        initial={text(original.description.es)} value={isObject(product.description) ? text(product.description.es) : ''}
        label="Descripción" disabled={disabled} onChange={value => onChange('description', { es: value })} />
        : <ScopedDescriptionInput initial={text(original.description)} value={text(product.description)} label="Descripción" disabled={disabled} onChange={value => onChange('description', value)} />}
      <label className="block text-sm">Descripción adicional superior<textarea className={inputClass} rows={3} value={text(product.extraDescriptionTop)} onChange={event => onChange('extraDescriptionTop', event.target.value)} /></label>
      <label className="block text-sm">Descripción adicional inferior<textarea className={inputClass} rows={3} value={text(product.extraDescriptionBottom)} onChange={event => onChange('extraDescriptionBottom', event.target.value)} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <MutterSelect label="Descripción predeterminada" value={text(product.defaultDescriptionType)} disabled={disabled} onChange={value => onChange('defaultDescriptionType', value)}
          options={[...(!['none', 'camiseta'].includes(text(product.defaultDescriptionType)) ? [{ value: text(product.defaultDescriptionType), label: text(product.defaultDescriptionType) || 'Sin selección' }] : []),
            { value: 'none', label: 'Ninguna' }, { value: 'camiseta', label: 'Camiseta' }]} />
        <MutterSelect label="Posición de descripción" value={text(product.descriptionPosition)} disabled={disabled} onChange={value => onChange('descriptionPosition', value)}
          options={[...(!['top', 'bottom'].includes(text(product.descriptionPosition)) ? [{ value: text(product.descriptionPosition), label: 'Posición actual conservada' }] : []),
            { value: 'top', label: 'Arriba' }, { value: 'bottom', label: 'Abajo' }]} />
      </div>
    </fieldset>
  </div>;
}
