import { useState } from 'react';
import type { JsonValue } from '../../domain/catalogEdit';
import { acknowledgeCatalogImage, listCatalogImageDrafts, recoverCatalogImage, uploadCatalogImage, type CatalogImage } from '../../utils/catalogImageClient';

export default function PublicationImages({ productId, value, disabled, onChange, onOperation, onBusy }: {
  productId: string; value: JsonValue | undefined; disabled: boolean;
  onChange: (value: JsonValue[]) => void; onOperation: (operationId: string) => void; onBusy: (value: boolean) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [recoverable, setRecoverable] = useState<CatalogImage[]>([]);
  const unknownFormat = value !== undefined && !Array.isArray(value);
  const images = Array.isArray(value) ? value : [];
  function incorporate(result: CatalogImage) {
    if (!images.includes(result.url)) onChange([...images, result.url]);
    onOperation(result.imageOperationId);
  }
  async function transfer(file?: File) {
    if (busy || disabled || unknownFormat) return;
    setBusy(true); onBusy(true); setError(null);
    try {
      const result = file ? await uploadCatalogImage(file, productId) : await recoverCatalogImage(productId);
      if (!result) { setError('No hay una carga pendiente para esta publicación.'); return; }
      incorporate(result);
      acknowledgeCatalogImage(productId, result.imageOperationId);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'No se pudo comprobar la imagen. Conservamos el intento; no la vuelvas a subir.');
    } finally { setBusy(false); onBusy(false); }
  }
  function move(index: number, offset: number) {
    const destination = index + offset;
    if (destination < 0 || destination >= images.length) return;
    const reordered = [...images];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    onChange(reordered);
  }
  return <section className="space-y-3" aria-labelledby="publication-images-heading">
    <div><h3 id="publication-images-heading" className="font-semibold">Imágenes</h3><p className="mt-1 text-sm text-gray-500">La primera imagen es la portada. Podés agregar y ordenar imágenes; los archivos existentes se conservan.</p></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {images.map((image, index) => <figure key={index} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {typeof image === 'string' && /^https:\/\//i.test(image) ? <a href={image} target="_blank" rel="noopener noreferrer" className="block bg-gray-50" aria-label={`Abrir imagen ${index + 1}`}><img src={image} alt={`Imagen ${index + 1}`} className="h-36 w-full object-contain" /></a>
          : <p className="p-3 text-sm">Imagen en formato anterior conservada</p>}
        <figcaption className="flex items-center justify-between gap-1 p-2 text-xs"><span>{index === 0 ? 'Portada' : `Imagen ${index + 1}`}</span>
          <span className="flex gap-1"><button type="button" disabled={disabled || busy || index === 0} onClick={() => move(index, -1)} aria-label={`Mover imagen ${index + 1} antes`} className="rounded border px-2 py-1 disabled:opacity-30">←</button>
            <button type="button" disabled={disabled || busy || index === images.length - 1} onClick={() => move(index, 1)} aria-label={`Mover imagen ${index + 1} después`} className="rounded border px-2 py-1 disabled:opacity-30">→</button></span>
        </figcaption></figure>)}
    </div>
    {images.length === 0 && <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">{unknownFormat ? 'Las imágenes usan un formato anterior. Se conservan sin cambios; su edición requiere revisión.' : 'Todavía no hay imágenes.'}</p>}
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <label className={`rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium focus-within:ring-2 focus-within:ring-gray-900 ${disabled || busy || unknownFormat ? 'text-gray-400' : 'cursor-pointer hover:bg-gray-50'}`}>Agregar imagen<input aria-label="Agregar imagen" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || busy || unknownFormat}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void transfer(file); }} /></label>
      <button type="button" disabled={disabled || busy || unknownFormat} onClick={() => void transfer()} className="text-sm underline underline-offset-4 disabled:text-gray-400">Comprobar carga pendiente</button>
      <button type="button" disabled={disabled || busy || unknownFormat} onClick={() => {
        try { setRecoverable(listCatalogImageDrafts(productId).filter(image => !images.includes(image.url))); }
        catch (failure: unknown) { setError(failure instanceof Error ? failure.message : 'No se pudieron comprobar las imágenes conservadas.'); }
      }} className="text-sm underline underline-offset-4 disabled:text-gray-400">Ver imágenes recuperables</button>
      {busy && <span role="status" className="text-sm">Comprobando imagen…</span>}
    </div>
    {recoverable.filter(image => !images.includes(image.url)).map(image => <div key={image.imageOperationId} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <img src={image.url} alt="Imagen cargada y conservada" className="h-14 w-14 rounded object-contain" />
      <button type="button" disabled={disabled || busy} onClick={() => {
        try { incorporate(image); }
        catch (failure: unknown) { setError(failure instanceof Error ? failure.message : 'No se pudo incorporar la imagen.'); }
      }} className="text-sm font-medium underline">Incorporar a esta publicación</button>
    </div>)}
  </section>;
}
