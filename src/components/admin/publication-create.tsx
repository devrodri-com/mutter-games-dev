import { useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import type { Category } from '../../data/types';
import { isObject, type CatalogEditDocument, type CatalogEditField, type JsonObject, type JsonValue } from '../../domain/catalogEdit';
import { CatalogCreatePendingError, CatalogCreateSupersededError, createCatalogPublication, reopenSupersededCatalogCreate, updateCatalogDraft, type CatalogCreateDraft } from '../../utils/catalogCreateClient';
import PublicationFields from './publication-fields';
import './admin-visual.css';
import { publicationFormDraft } from './publication-form-draft';
import { selectedPublicationSubcategory } from './publication-classification';

const text = (value: unknown) => typeof value === 'string' ? value : '';
export default function PublicationCreate({ draft, categories, onCreated, onClose }: {
  draft: CatalogCreateDraft; categories: Category[]; onCreated: (document: CatalogEditDocument, superseded?: boolean) => void; onClose: () => void;
}) {
  const [product, setProduct] = useState<JsonObject>(draft.product);
  const [imageOperations, setImageOperations] = useState<string[]>(draft.imageOperationIds);
  const latest = useRef({ product: draft.product, imageOperations: draft.imageOperationIds });
  const [saving, setSaving] = useState(false), [pending, setPending] = useState(draft.pending), [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [superseded, setSuperseded] = useState(false);
  function change(field: CatalogEditField, value: JsonValue) {
    if (saving || pending) return;
    const next = publicationFormDraft(latest.current.product, { [field]: value });
    try { updateCatalogDraft(draft, next, latest.current.imageOperations); latest.current.product = next; setProduct(next); }
    catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'No se pudo conservar el borrador.');
      if (field === 'images') throw failure; // The upload must retain its receipt when incorporating into the draft fails.
    }
  }
  function changeState(active: boolean) {
    const next = { ...latest.current.product, active };
    try { updateCatalogDraft(draft, next, latest.current.imageOperations); latest.current.product = next; setProduct(next); }
    catch (failure: unknown) { setError(failure instanceof Error ? failure.message : 'No se pudo conservar el borrador.'); }
  }
  async function save() {
    if (saving || imageBusy) return;
    setError(null);
    if (!pending) {
      const title = typeof product.title === 'string' ? product.title : isObject(product.title) ? text(product.title.es) || text(product.title.en) : '';
      if (!title.trim()) { setError('Escribí el título de la publicación.'); return; }
      if (!selectedPublicationSubcategory(product, categories)) {
        setError('Elegí una categoría y una subcategoría válida.'); return;
      }
      if (!Array.isArray(product.images) || !product.images.length) { setError('Agregá al menos una imagen antes de crear la publicación.'); return; }
    }
    setSaving(true);
    try { onCreated(await createCatalogPublication(draft, product, imageOperations)); }
    catch (failure: unknown) {
      if (failure instanceof CatalogCreatePendingError) setPending(true);
      if (failure instanceof CatalogCreateSupersededError) setSuperseded(true);
      setError(failure instanceof Error ? failure.message : 'No se pudo comprobar la creación.');
    } finally { setSaving(false); }
  }
  async function reopen() {
    if (saving || imageBusy) return;
    setSaving(true); setError(null);
    try { onCreated(await reopenSupersededCatalogCreate(draft), true); }
    catch (failure: unknown) { setError(failure instanceof Error ? failure.message : 'No se pudo abrir la versión actual.'); }
    finally { setSaving(false); }
  }
  const disabled = saving || pending || imageBusy;
  const close = () => { if (!saving && !imageBusy) onClose(); };
  return <Dialog open onClose={close} className="mutter-modal relative z-50">
    <div className="mutter-modal__backdrop fixed inset-0" aria-hidden="true" />
    <div className="mutter-modal__viewport fixed inset-0 overflow-y-auto"><div className="mutter-modal__position flex min-h-full items-center justify-center">
      <DialogPanel className="mutter-modal__panel w-full bg-white">
        <header className="mutter-modal__header"><div className="mutter-modal__heading"><img src="/brand/login/mutter-compacto-color-positivo.svg" alt="Mutter Games" className="mutter-modal__brand" /><div>
          <DialogTitle className="text-xl font-semibold">Crear publicación</DialogTitle><p className="mt-1 text-sm text-gray-500">Tu borrador se conserva en este navegador. Crear una publicación no habilita las compras.</p></div></div>
          <button type="button" disabled={saving || imageBusy} onClick={close} aria-label="Cerrar creación" className="mutter-modal__close">✕</button></header>
        <div className="mutter-modal__body space-y-5">
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {pending && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">La creación necesita comprobación. Conservamos el intento y no crearemos otra publicación.</p>}
          <label className="mutter-modal__visibility flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={product.active === true} disabled={disabled} onChange={event => changeState(event.target.checked)} />
            <span><strong>Mostrar esta publicación en la web</strong><span className="mt-1 block text-gray-500">{product.active === true ? 'Se creará activa. Las compras seguirán cerradas.' : 'Se creará inactiva. Las publicaciones existentes no cambian.'}</span></span></label>
          <PublicationFields productId={draft.id} original={draft.product} product={product} categories={categories} creating disabled={disabled}
            onChange={change} onImageOperation={operation => {
              const next = latest.current.imageOperations.includes(operation) ? latest.current.imageOperations : [...latest.current.imageOperations, operation];
              updateCatalogDraft(draft, latest.current.product, next); latest.current.imageOperations = next; setImageOperations(next);
            }} onImageBusy={setImageBusy} />
        </div>
        <footer className="mutter-modal__footer sticky bottom-0 flex flex-wrap items-center justify-end gap-3">
          <button type="button" disabled={saving || imageBusy} onClick={close} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40">Cerrar y conservar borrador</button>
          <button type="button" disabled={saving || imageBusy} onClick={() => void (superseded ? reopen() : save())} className="mutter-modal__primary">{saving ? 'Comprobando…' : superseded ? 'Abrir versión actual' : pending ? 'Comprobar creación' : 'Crear publicación'}</button>
        </footer>
      </DialogPanel>
    </div></div>
  </Dialog>;
}
