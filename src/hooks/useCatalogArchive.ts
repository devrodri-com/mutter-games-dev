import { useEffect, useRef, useState } from 'react';
import type { CatalogEditDocument } from '../domain/catalogEdit';
import { ARCHIVE_JOURNAL_EVENT, catalogArchivePending, catalogArchivePendingIds, consultCatalogArchive,
  prepareCatalogArchive, submitCatalogArchive, type ArchiveIntent, type ArchiveOutcome, type ArchivePrepared } from '../utils/catalogArchiveClient';

export type ArchiveConfirmation = { actorKey: string; intent: ArchiveIntent; ids: string[]; prepared: ArchivePrepared[];
  preparing: boolean; preparationErrors: { id: string; message: string }[]; results: ArchiveOutcome[]; running: boolean };
export function useCatalogArchive(actorKey: string, onDocument: (document: CatalogEditDocument) => void) {
  const [selection, setSelection] = useState<{ actorKey: string; ids: string[]; error: string | null }>({ actorKey, ids: [], error: null });
  const [confirmation, setConfirmation] = useState<ArchiveConfirmation | null>(null);
  const [revision, setRevision] = useState(0), [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [consulting, setConsulting] = useState<string | null>(null);
  const lifecycle = useRef({ mounted: false, epoch: 0, actorKey });
  const live = useRef({ actorKey, onDocument }); live.current = { actorKey, onDocument };
  const busy = useRef(false);
  useEffect(() => {
    lifecycle.current.mounted = true; lifecycle.current.epoch += 1; lifecycle.current.actorKey = actorKey;
    busy.current = false; setConfirmation(null); setConsulting(null); setError(null); setNotice(null);
    const refresh = () => { if (lifecycle.current.mounted) setRevision(value => value + 1); };
    window.addEventListener('storage', refresh); window.addEventListener(ARCHIVE_JOURNAL_EVENT, refresh);
    return () => {
      lifecycle.current.mounted = false; lifecycle.current.epoch += 1;
      window.removeEventListener('storage', refresh); window.removeEventListener(ARCHIVE_JOURNAL_EVENT, refresh);
    };
  }, [actorKey]);
  function scope() {
    const epoch = lifecycle.current.epoch, key = actorKey;
    const current = () => lifecycle.current.mounted && lifecycle.current.epoch === epoch && live.current.actorKey === key;
    return { current, guard: () => { if (!current()) throw new Error('La sesión cambió o se cerró esta vista. No se enviarán más operaciones.'); } };
  }
  const selectedIds = selection.actorKey === actorKey ? selection.ids : [];
  const active = confirmation?.actorKey === actorKey ? confirmation : null;
  const running = active?.running === true;
  function select(ids: string[], checked: boolean) {
    if (busy.current) return;
    setError(null);
    setSelection(previous => {
      const before = previous.actorKey === actorKey ? previous.ids : [];
      const next = checked ? [...new Set([...before, ...ids])] : before.filter(id => !ids.includes(id));
      if (next.length > 50) return { actorKey, ids: before, error: 'Podés seleccionar hasta 50 publicaciones. Quitá algunas antes de seguir.' };
      return { actorKey, ids: next, error: null };
    });
  }
  async function prepare(ids: string[], intent: ArchiveIntent) {
    if (busy.current) return;
    const unique = [...new Set(ids)];
    if (!unique.length || unique.length > 50) { setError('Seleccioná entre 1 y 50 publicaciones.'); return; }
    busy.current = true; const context = scope();
    const next: ArchiveConfirmation = { actorKey, intent, ids: unique, prepared: [], preparationErrors: [], preparing: true, results: [], running: false };
    setConfirmation(next); setError(null); setNotice(null);
    try {
      for (const id of unique) {
        context.guard();
        try { next.prepared.push(await prepareCatalogArchive(id, intent, context.guard)); }
        catch (failure: unknown) { context.guard(); next.preparationErrors.push({ id, message: failure instanceof Error ? failure.message : 'No se pudo comprobar esta publicación.' }); }
      }
      if (context.current()) setConfirmation({ ...next, preparing: false });
    } catch (failure: unknown) {
      if (context.current()) setError(failure instanceof Error ? failure.message : 'No se pudo comprobar la selección.');
    } finally { if (context.current()) busy.current = false; }
  }
  async function confirm() {
    if (busy.current || !active || active.preparing || active.preparationErrors.length || active.results.length
      || active.prepared.length !== active.ids.length) return;
    const context = scope(), batch = active; busy.current = true;
    const results: ArchiveOutcome[] = batch.prepared.map(entry => ({ id: entry.document.id, intent: batch.intent, status: 'not_sent', message: 'Todavía no se envió.' }));
    setConfirmation({ ...batch, running: true, results: [...results] });
    try {
      for (const [index, prepared] of batch.prepared.entries()) {
        context.guard();
        const result = await submitCatalogArchive(prepared, context.guard);
        context.guard(); results[index] = result;
        if (result.status === 'success') live.current.onDocument(result.document);
        setConfirmation({ ...batch, running: true, results: [...results] });
        if (result.status === 'uncertain') {
          for (let remaining = index + 1; remaining < results.length; remaining += 1) results[remaining] = {
            id: results[remaining].id, intent: batch.intent, status: 'not_sent', message: 'No se envió porque una operación anterior necesita comprobación.' };
          break;
        }
      }
    } catch (failure: unknown) {
      if (context.current()) setError(failure instanceof Error ? failure.message : 'Se detuvo el lote. Las operaciones no confirmadas se conservan.');
    } finally {
      if (context.current()) { setConfirmation({ ...batch, running: false, results: [...results] }); busy.current = false; setRevision(value => value + 1); }
    }
  }
  async function consult(id: string) {
    if (busy.current) return;
    const context = scope(); setConsulting(id); setError(null); setNotice(null);
    try {
      const result = await consultCatalogArchive(id, context.guard); context.guard();
      if (result.status === 'success') { live.current.onDocument(result.document); setNotice(result.message); }
      else setError(result.message);
      setConfirmation(previous => previous?.actorKey === actorKey && previous.results.some(item => item.id === id)
        ? { ...previous, results: previous.results.map(item => item.id === id ? result : item) } : previous);
    } catch (failure: unknown) { if (context.current()) setError(failure instanceof Error ? failure.message : 'No se pudo consultar el resultado.'); }
    finally { if (context.current()) { setConsulting(null); setRevision(value => value + 1); } }
  }
  let pendingIds: string[] = [];
  let storageError: string | null = null;
  try { pendingIds = catalogArchivePendingIds(); } catch { storageError = 'No se pudieron comprobar las operaciones guardadas. Revisá el almacenamiento antes de iniciar otra.'; }
  return { selectedIds, select, clearSelection: () => { if (!busy.current) setSelection({ actorKey, ids: [], error: null }); },
    confirmation: active, prepare, confirm, consult, consulting, running, preparing: active?.preparing === true,
    close: () => {
      if (active?.running) return;
      if (active?.preparing) { lifecycle.current.epoch += 1; busy.current = false; }
      setConfirmation(null);
    }, error: error ?? storageError ?? (selection.actorKey === actorKey ? selection.error : null), notice, pendingIds, revision,
    pending: catalogArchivePending };
}
