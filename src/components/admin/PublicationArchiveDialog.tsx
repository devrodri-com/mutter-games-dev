import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import type { ArchiveConfirmation } from '../../hooks/useCatalogArchive';

function documentTitle(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('es' in value && typeof value.es === 'string' && value.es) return value.es;
    if ('en' in value && typeof value.en === 'string' && value.en) return value.en;
  }
  return fallback;
}
export default function PublicationArchiveDialog({ confirmation, titles, consulting, onClose, onConfirm, onPrepare, onConsult }: {
  confirmation: ArchiveConfirmation; titles: ReadonlyMap<string, string>; consulting: string | null;
  onClose: () => void; onConfirm: () => void; onPrepare: () => void; onConsult: (id: string) => void;
}) {
  const restoring = confirmation.intent === 'restore', results = confirmation.results;
  const locked = confirmation.running || confirmation.preparing;
  const title = restoring ? 'Restaurar publicaciones' : 'Retirar publicaciones';
  const action = restoring ? 'Restaurar como inactivas' : 'Retirar de la web';
  return <Dialog open onClose={() => { if (!confirmation.running) onClose(); }} className="mutter-modal relative z-50">
    <div className="mutter-modal__backdrop fixed inset-0" aria-hidden="true" />
    <div className="mutter-modal__viewport fixed inset-0 overflow-y-auto"><div className="mutter-modal__position flex min-h-full items-center justify-center">
      <DialogPanel className="mutter-modal__panel w-full bg-white">
        <header className="mutter-modal__header"><div className="mutter-modal__heading">
          <img src="/brand/login/mutter-compacto-color-positivo.svg" alt="Mutter Games" className="mutter-modal__brand" />
          <DialogTitle className="text-xl font-semibold">{title}</DialogTitle></div>
          <button type="button" onClick={onClose} disabled={confirmation.running} aria-label="Cerrar confirmación" className="mutter-modal__close">✕</button></header>
        <div className="mutter-modal__body space-y-4">
          <p className="font-medium text-gray-900">{confirmation.ids.length} {confirmation.ids.length === 1 ? 'publicación seleccionada' : 'publicaciones seleccionadas'}</p>
          <p className="text-sm text-gray-600">{restoring
            ? 'Volverán a Publicaciones como inactivas. Podés revisarlas y activar su visibilidad desde el editor.'
            : 'Pasarán a Archivadas y dejarán de mostrarse en la web. Se conservan sus datos, imágenes e historial.'}</p>
          {confirmation.preparing && <p role="status" className="text-sm text-gray-600">Comprobando la selección antes de confirmar…</p>}
          {confirmation.preparationErrors.length > 0 && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">No se pudo comprobar toda la selección. No se enviaron cambios.</p>}
          {confirmation.running && <p role="status" className="text-sm text-gray-600">Procesando de a una publicación. Conservá esta vista abierta.</p>}
          {results.some(item => item.status === 'uncertain') && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">El lote se detuvo. Consultá el resultado pendiente; las publicaciones restantes no se enviaron.</p>}
          <ul className="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-gray-200 p-3">
            {confirmation.ids.map(id => {
              const prepared = confirmation.prepared.find(item => item.document.id === id);
              const result = results.find(item => item.id === id), failure = confirmation.preparationErrors.find(item => item.id === id);
              return <li key={id} className="break-words text-sm"><p className="font-medium text-gray-900">{documentTitle(prepared?.document.product.title, titles.get(id) ?? id)}</p>
                {(result || failure) && <p className={`mt-1 ${result?.status === 'success' ? 'text-emerald-800' : 'text-gray-600'}`}>{result?.message ?? failure?.message}</p>}
                {result?.status === 'uncertain' && <button type="button" disabled={locked || consulting !== null} onClick={() => onConsult(id)} className="mt-2 rounded-lg border px-3 py-2 font-medium disabled:opacity-40">{consulting === id ? 'Consultando…' : 'Consultar resultado'}</button>}
              </li>;
            })}
          </ul>
          {results.length > 0 && <p role="status" className="text-sm text-gray-600">Confirmadas: {results.filter(item => item.status === 'success').length}. No aplicadas: {results.filter(item => item.status === 'known_failure').length}. Sin confirmar: {results.filter(item => item.status === 'uncertain').length}. No enviadas: {results.filter(item => item.status === 'not_sent').length}.</p>}
        </div>
        <footer className="mutter-modal__footer flex flex-wrap items-center justify-end gap-3">
          <button type="button" disabled={confirmation.running} onClick={onClose} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40">{results.length ? 'Cerrar' : 'Cancelar'}</button>
          {!results.length && (confirmation.preparationErrors.length
            ? <button type="button" disabled={locked} onClick={onPrepare} className="mutter-modal__primary">Volver a comprobar</button>
            : <button type="button" disabled={locked || confirmation.prepared.length !== confirmation.ids.length} onClick={onConfirm} className="mutter-modal__primary disabled:opacity-40">{action}</button>)}
        </footer>
      </DialogPanel>
    </div></div>
  </Dialog>;
}
