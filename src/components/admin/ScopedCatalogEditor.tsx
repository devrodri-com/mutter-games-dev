import { useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import type { Category } from '../../data/types';
import { changedFields, isObject, sameJson, type CatalogEditChanges, type CatalogEditDocument,
  type CatalogEditField, type JsonValue } from '../../domain/catalogEdit';
import { CatalogEditPendingError, CatalogEditSupersededError, type CatalogEditOpen } from '../../utils/catalogEditClient';
import PublicationFields from './publication-fields';
import './admin-visual.css';
import { publicationFormDraft } from './publication-form-draft';
import { selectedPublicationSubcategory } from './publication-classification';

export type ScopedCatalogEditorProps = {
  mode: 'scoped'; initial: CatalogEditOpen; categories: Category[];
  onSave: (document: CatalogEditDocument, changes: CatalogEditChanges, imageOperationIds?: string[]) => Promise<void>;
  onReopen: () => Promise<void>;
  onClose: () => void;
};
const text = (value: unknown) => typeof value === 'string' ? value : '';

/** The original document is never normalized into a save. Only touched changes
 * leave this editor, and an uncertain operation can only be observed. */
export default function ScopedCatalogEditor({ initial, categories, onSave, onReopen, onClose }: ScopedCatalogEditorProps) {
  const [touched, setTouched] = useState<CatalogEditChanges>(initial.changes);
  const [imageOperations, setImageOperations] = useState<string[]>(initial.imageOperationIds ?? []);
  const [pending, setPending] = useState(initial.pending), [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false), [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState<string | null>(null), [superseded, setSuperseded] = useState(false);
  const product = publicationFormDraft(initial.document.product, touched);
  const disabled = saving || pending || imageBusy;
  const hasChanges = !sameJson(initial.document.product, product);
  function change(field: CatalogEditField, value: JsonValue) {
    if (saving || pending) return;
    if (field === 'active') {
      if (imageBusy) return;
      if (typeof value !== 'boolean') { setError('Elegí el estado de la publicación.'); return; }
      setTouched(previous => ({ ...previous, active: value })); return;
    }
    setTouched(previous => ({ ...previous, [field]: isObject(previous[field]) && isObject(value)
      ? { ...previous[field], ...value } : value }));
  }
  function close() {
    if (saving || imageBusy) return;
    if (!pending && hasChanges) setConfirmClose(true);
    else onClose();
  }
  async function save() {
    if (saving || imageBusy) return;
    setError(null);
    let delta: CatalogEditChanges;
    try { delta = pending ? touched : changedFields(initial.document.product, touched); }
    catch (failure: unknown) { setError(failure instanceof Error ? failure.message : 'Revisá los datos antes de guardar.'); return; }
    if (!Object.keys(delta).length) { setError('No hay cambios para guardar.'); return; }
    if (!pending && (delta.category || delta.subcategory)) {
      if (!selectedPublicationSubcategory(product, categories)) {
        setError('Elegí una subcategoría de la categoría seleccionada.'); return;
      }
    }
    setSaving(true);
    try { setTouched(delta); await onSave(initial.document, delta, imageOperations); }
    catch (failure: unknown) {
      if (failure instanceof CatalogEditPendingError) setPending(true);
      if (failure instanceof CatalogEditSupersededError) setSuperseded(true);
      setError(failure instanceof Error ? failure.message : 'No pudimos comprobar el guardado.');
    } finally { setSaving(false); }
  }
  async function reopen() {
    if (saving) return;
    setSaving(true); setError(null);
    try { await onReopen(); }
    catch (failure: unknown) { setError(failure instanceof Error ? failure.message : 'No se pudo abrir la versión actual.'); }
    finally { setSaving(false); }
  }
  const title = typeof product.title === 'string' ? product.title : isObject(product.title) ? text(product.title.es) : '';
  return <Dialog open onClose={close} className="mutter-modal relative z-50">
    <div className="mutter-modal__backdrop fixed inset-0" aria-hidden="true" />
    <div className="mutter-modal__viewport fixed inset-0 overflow-y-auto"><div className="mutter-modal__position flex min-h-full items-center justify-center">
      <DialogPanel className="mutter-modal__panel w-full bg-white">
        <header className="mutter-modal__header">
          <div className="mutter-modal__heading"><img src="/brand/login/mutter-compacto-color-positivo.svg" alt="Mutter Games" className="mutter-modal__brand" /><div className="min-w-0"><p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Publicación</p>
            <DialogTitle className="break-words text-xl font-semibold text-gray-900">{title || 'Editar publicación'}</DialogTitle>
            <p className="mt-2 text-sm text-gray-600">Estado: <strong>{product.active === true ? 'Activa' : product.active === false ? 'Inactiva' : 'Original conservado'}</strong>. Sólo cambia si elegís otro estado y guardás.</p></div></div>
          <button type="button" disabled={saving || imageBusy} onClick={close} aria-label="Cerrar publicación" className="mutter-modal__close">✕</button>
        </header>
        <div className="mutter-modal__body space-y-5">
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {pending && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">Hay un guardado pendiente de comprobación. Conservamos tus cambios; no se enviarán otra vez.</p>}
          <label className="mutter-modal__visibility flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={product.active === true} disabled={disabled} onChange={event => change('active', event.target.checked)} />
            <span><strong>Mostrar esta publicación en la web</strong><span className="mt-1 block text-gray-500">El estado elegido se aplicará al guardar los cambios.</span></span></label>
          <PublicationFields productId={initial.document.id} original={initial.document.product} product={product} categories={categories} disabled={disabled}
            onChange={change} onImageOperation={operation => setImageOperations(previous => previous.includes(operation) ? previous : [...previous, operation])} onImageBusy={setImageBusy} />
        </div>
        <footer className="mutter-modal__footer sticky bottom-0">
          {confirmClose ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">Tenés cambios sin guardar.</p><div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setConfirmClose(false)} className="rounded-lg border px-4 py-2 text-sm">Seguir editando</button>
            <button type="button" onClick={onClose} className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-700">Descartar cambios</button></div></div>
            : <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-gray-500">Se guardan sólo los campos que cambiaste.</span><div className="flex gap-2">
              <button type="button" disabled={saving || imageBusy} onClick={close} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40">Cerrar</button>
              <button type="button" disabled={saving || imageBusy} onClick={() => void (superseded ? reopen() : save())} className="mutter-modal__primary">{saving ? 'Comprobando…' : superseded ? 'Abrir versión actual' : pending ? 'Comprobar guardado' : 'Guardar cambios'}</button>
            </div></div>}
        </footer>
      </DialogPanel>
    </div></div>
  </Dialog>;
}
