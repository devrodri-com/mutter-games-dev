import { useId } from 'react';
import type { JsonObject, JsonValue } from '../../domain/catalogEdit';
import { availableStock, parseReservations, reservedQuantity, stockQuantity } from '../../domain/webInventory';

const object = (value: JsonValue | undefined): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: JsonValue | undefined) => typeof value === 'string' ? value : '';
const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500';

export function PublicationStockInput({ value, label, name, disabled, onChange }: {
  value: JsonValue | undefined; label: string; name: string; disabled: boolean; onChange: (quantity: JsonValue) => void;
}) {
  const messageId = useId();
  let problem: string | null = null;
  try { stockQuantity(value); }
  catch { problem = `Cantidad no válida: ${value === undefined ? 'sin dato' : JSON.stringify(value).slice(0, 80)}. Ingresá un entero igual o mayor que cero para guardar un cambio de stock.`; }
  return <label className="block text-sm">{label}<input className={field} aria-label={name} type="number" min="0" step="1"
    value={typeof value === 'number' && Number.isFinite(value) ? value : ''} disabled={disabled}
    aria-invalid={problem ? true : undefined} aria-describedby={problem ? messageId : undefined}
    onChange={event => onChange(Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : event.target.value)} />
    {problem && <span id={messageId} className="mt-1 block text-xs text-amber-800">{problem}</span>}
  </label>;
}

export function PublicationStockAvailability({ product, slot, value }: {
  product: JsonObject | undefined; slot: string; value: JsonValue | undefined;
}) {
  if (!product) return null;
  try {
    const quantity = stockQuantity(value), held = reservedQuantity(parseReservations(product.webReservations), slot);
    const available = availableStock(product, slot, quantity);
    return <p className="mt-1 text-xs text-gray-600">Reservadas: {held}. {slot === 'base' ? 'Disponibles' : 'Disponibles de esta opción'}: {available}.</p>;
  } catch (error: unknown) {
    return <p role="status" className="mt-1 text-xs text-amber-800">Disponibilidad sin comprobar. {error instanceof Error ? error.message : 'Revisá los datos guardados.'}</p>;
  }
}

/** Update only the selected key; legacy identities, inventory and unknown fields survive. */
export default function PublicationVariants({ value, product, creating, disabled, onChange }: {
  value: JsonValue | undefined; product?: JsonObject; creating: boolean; disabled: boolean; onChange: (value: JsonValue[]) => void;
}) {
  const variants = Array.isArray(value) ? value : [];
  function changeVariant(index: number, changes: JsonObject) {
    onChange(variants.map((variant, position) => position === index && object(variant) ? { ...variant, ...changes } : variant));
  }
  function changeOption(variantIndex: number, optionIndex: number, changes: JsonObject) {
    const variant = variants[variantIndex];
    if (!object(variant) || !Array.isArray(variant.options)) return;
    changeVariant(variantIndex, { options: variant.options.map((option, position) => position === optionIndex && object(option)
      ? { ...option, ...changes } : option) });
  }
  return <section aria-labelledby="publication-variants-heading" className="space-y-4">
    <div><h3 id="publication-variants-heading" className="font-semibold text-gray-900">Variantes y precios</h3>
      {!creating && <p className="mt-1 text-sm text-gray-500">Editá la cantidad física de cada opción. Las unidades reservadas y los identificadores se conservan.</p>}</div>
    {value !== undefined && !Array.isArray(value) && <p className="rounded-lg bg-amber-50 p-3 text-sm">Este producto tiene variantes en un formato anterior. Se conservan sin cambios.</p>}
    {variants.map((variant, variantIndex) => object(variant) ? <fieldset key={variantIndex} disabled={disabled} className="space-y-3 rounded-xl border border-gray-200 p-4">
      <legend className="px-1 text-sm font-medium">Variante {variantIndex + 1}</legend>
      <label className="block text-sm">Nombre de variante
        <input className={field} value={typeof variant.label === 'string' ? variant.label : object(variant.label) ? text(variant.label.es) : ''}
          onChange={event => changeVariant(variantIndex, { label: typeof variant.label === 'string' ? event.target.value
            : { ...(object(variant.label) ? variant.label : {}), es: event.target.value } })} /></label>
      {Array.isArray(variant.options) ? variant.options.map((option, optionIndex) => object(option) ? <div key={optionIndex} className="grid grid-cols-1 gap-3 border-t border-gray-100 pt-3 sm:grid-cols-3">
        <label className="text-sm">Opción {optionIndex + 1}<input className={field} value={text(option.value)}
          onChange={event => changeOption(variantIndex, optionIndex, { value: event.target.value })} /></label>
        <label className="text-sm">Precio<input className={field} type="number" min="0" step="0.01"
          value={typeof option.priceUSD === 'number' ? option.priceUSD : ''}
          onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) changeOption(variantIndex, optionIndex, { priceUSD: event.target.valueAsNumber }); }} /></label>
        <div><PublicationStockInput value={option.stock} label="Stock" name={`Stock variante ${variantIndex + 1} opción ${optionIndex + 1}`} disabled={disabled}
          onChange={stock => changeOption(variantIndex, optionIndex, { stock })} />
          <PublicationStockAvailability product={product} slot={`${variantIndex}:${optionIndex}`} value={option.stock} /></div>
      </div> : <p key={optionIndex} className="text-sm text-amber-800">Opción {optionIndex + 1}: formato anterior conservado.</p>)
        : <p className="text-sm text-amber-800">Opciones en formato anterior conservadas.</p>}
      {Array.isArray(variant.options) && <button type="button" className="text-sm font-medium underline underline-offset-4 disabled:text-gray-400"
        onClick={() => { if (Array.isArray(variant.options)) changeVariant(variantIndex, { options: [...variant.options, { value: '', priceUSD: 0, stock: 0 }] }); }}>Agregar opción</button>}
    </fieldset> : <p key={variantIndex} className="text-sm text-amber-800">Variante {variantIndex + 1}: formato anterior conservado.</p>)}
    {(value === undefined || Array.isArray(value)) && <button type="button" disabled={disabled} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium disabled:text-gray-400"
      onClick={() => onChange([...variants, { label: { es: '' }, options: [{ value: '', priceUSD: 0, stock: 0 }] }])}>Agregar variante</button>}
  </section>;
}
