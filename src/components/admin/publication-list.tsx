import { useEffect, useRef, useState } from 'react';
import { Search, Plus, ArrowRight, Image as ImageIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { catalogProductForDisplay, readAdminCatalog, type AdminCatalogRead } from '../../firebase/adminCatalogRead';
import { openCatalogEdit, reopenSupersededCatalogEdit, saveCatalogEdit, type CatalogEditOpen } from '../../utils/catalogEditClient';
import { newCatalogDraft, type CatalogCreateDraft } from '../../utils/catalogCreateClient';
import type { CatalogEditChanges, CatalogEditDocument } from '../../domain/catalogEdit';
import ScopedCatalogEditor from './ScopedCatalogEditor';
import PublicationCreate from './publication-create';
import MutterSelect from './MutterSelect';
import PublicationArchiveDialog from './PublicationArchiveDialog';
import { useCatalogArchive } from '../../hooks/useCatalogArchive';
import type { ArchiveIntent } from '../../utils/catalogArchiveClient';

const PAGE_SIZE = 30;
type ArchiveOpener = { element: HTMLButtonElement; actorKey: string };
const money = (value: number | undefined) => value === undefined ? 'Sin precio' : new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'UYU' }).format(value);
export default function PublicationList() {
  const { user, credentialScope } = useAuth();
  const [catalog, setCatalog] = useState<AdminCatalogRead | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState(''), [category, setCategory] = useState(''), [state, setState] = useState('all'), [page, setPage] = useState(1);
  const [editor, setEditor] = useState<CatalogEditOpen | null>(null), [draft, setDraft] = useState<CatalogCreateDraft | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [tab, setTab] = useState<'publications' | 'archived'>('publications');
  const viewKey = `${user?.uid ?? ''}:${credentialScope ?? ''}`;
  const actor = useRef(viewKey); actor.current = viewKey;
  const archiveOpener = useRef<ArchiveOpener | null>(null), returnFocus = useRef<ArchiveOpener | null>(null);
  const selectedTab = useRef<HTMLButtonElement | null>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const archive = useCatalogArchive(viewKey, mergeDocument);
  const archiveBusy = archive.running || archive.preparing;
  useEffect(() => {
    if (archive.confirmation || !returnFocus.current) return;
    const request = returnFocus.current;
    // Headless UI restores from an unmount microtask. Return after that cleanup
    // and the committed row removal, without overriding a newer modal or session.
    const frame = requestAnimationFrame(() => {
      if (returnFocus.current !== request) return;
      returnFocus.current = null;
      if (!mounted.current || actor.current !== request.actorKey || document.querySelector('[role="dialog"]')) return;
      const opener = request.element;
      const destination = opener.isConnected && !opener.disabled ? opener : selectedTab.current;
      if (destination?.isConnected && !destination.disabled) {
        destination.focus();
        destination.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      archiveOpener.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [archive.confirmation, viewKey]);
  useEffect(() => {
    let cancelled = false;
    archiveOpener.current = null; returnFocus.current = null;
    setCatalog(null); setEditor(null); setDraft(null); setError(null); setLoading(true); setOpening(null);
    void readAdminCatalog().then(value => { if (!cancelled) setCatalog(value); }).catch((failure: unknown) => {
      if (!cancelled) setError(`No se pudieron cargar las publicaciones.${failure instanceof Error ? ` ${failure.message}` : ''}`);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.uid, credentialScope]);
  useEffect(() => {
    if (editor && archive.pending(editor.document.id).pending) {
      setEditor(null); setNotice('Hay una operación pendiente para esta publicación. Consultá su resultado antes de editarla.');
    }
  }, [archive.revision, editor]);
  function prepareArchive(ids: string[], intent: ArchiveIntent, element: HTMLButtonElement) {
    if (archiveBusy) return;
    returnFocus.current = null;
    archiveOpener.current = { element, actorKey: actor.current };
    void archive.prepare(ids, intent);
  }
  function closeArchive() {
    if (!archive.confirmation || archive.confirmation.running) return;
    returnFocus.current = archiveOpener.current;
    archive.close();
  }
  async function open(id: string) {
    if (opening || archiveBusy) return;
    if (archive.pending(id).pending) { setError('Hay una operación pendiente. Consultá su resultado antes de editar.'); return; }
    returnFocus.current = null;
    const uid = actor.current;
    setOpening(id); setError(null); setNotice(null);
    try { const current = await openCatalogEdit(id); if (mounted.current && actor.current === uid && !archive.pending(id).pending) setEditor(current); }
    catch (failure: unknown) { if (mounted.current && actor.current === uid) setError(failure instanceof Error ? failure.message : 'No se pudo abrir la publicación.'); }
    finally { if (mounted.current && actor.current === uid) setOpening(null); }
  }
  function mergeDocument(document: CatalogEditDocument) {
    setCatalog(previous => {
      if (!previous) return previous;
      const row = catalogProductForDisplay(document.id, document.product, previous.categories, previous.subcategories);
      const found = previous.products.some(product => product.id === document.id);
      return { ...previous, products: found ? previous.products.map(product => product.id === document.id ? row : product) : [row, ...previous.products] };
    });
  }
  function accept(document: CatalogEditDocument, created = false, superseded = false) {
    mergeDocument(document);
    setEditor(null); setDraft(null); setNotice(created ? superseded ? 'Publicación creada; se abrió una edición posterior.' : 'Publicación creada y comprobada.' : 'Cambios guardados y comprobados.');
    if (created) { setCategory(''); setSearch(''); setState('all'); setPage(1); setTab('publications'); }
  }
  async function save(document: CatalogEditDocument, changes: CatalogEditChanges, imageOperations?: string[]) {
    if (archiveBusy || archive.pending(document.id).pending) throw new Error('Comprobá la operación pendiente antes de guardar otra edición.');
    const uid = actor.current, confirmed = await saveCatalogEdit(document, changes, imageOperations);
    if (mounted.current && actor.current === uid) accept(confirmed);
  }
  function create() {
    returnFocus.current = null;
    setError(null); setNotice(null);
    try { setDraft(newCatalogDraft()); }
    catch (failure: unknown) { setError(failure instanceof Error ? failure.message : 'No se pudo abrir el borrador.'); }
  }
  const products = catalog?.products ?? [];
  const query = search.trim().toLocaleLowerCase();
  const filtered = products.filter(product => (product.catalogArchived === true) === (tab === 'archived')
    && (!query || product.title.es.toLocaleLowerCase().includes(query) || product.title.en.toLocaleLowerCase().includes(query))
    && (!category || product.category.id === category) && (state === 'all' || product.active === (state === 'active')));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), selectedPage = Math.min(page, pages);
  const visible = filtered.slice((selectedPage - 1) * PAGE_SIZE, selectedPage * PAGE_SIZE);
  const titles = new Map(products.map(product => [product.id, product.title.es || product.title.en || product.id]));
  const hiddenSelected = archive.selectedIds.filter(id => !visible.some(product => product.id === id)).length;
  const visibleIds = visible.map(product => product.id);
  const pageSelected = visibleIds.length > 0 && visibleIds.every(id => archive.selectedIds.includes(id));
  const selectedProducts = products.filter(product => archive.selectedIds.includes(product.id));
  const mixedSelection = selectedProducts.some(product => product.catalogArchived === true) && selectedProducts.some(product => product.catalogArchived !== true);
  const selectionIntent = selectedProducts.length === archive.selectedIds.length && selectedProducts.length > 0 && !mixedSelection
    ? selectedProducts[0]?.catalogArchived === true ? 'restore' : 'withdraw' : null;
  const selectionIssue = mixedSelection ? 'La selección mezcla publicaciones y archivadas. Quitá los artículos del otro estado para retirar o restaurar.'
    : selectedProducts.length !== archive.selectedIds.length ? 'Falta cargar parte de la selección. Volvé a cargar el catálogo antes de continuar.' : null;
  return <section className="mutter-catalog mx-auto w-full max-w-7xl" aria-labelledby="publications-heading">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-500">Catálogo</p>
      <h1 id="publications-heading" className="text-2xl font-semibold tracking-tight text-gray-950">Publicaciones</h1>
      <p className="mt-2 text-sm text-gray-500">{loading ? 'Cargando catálogo…' : `${products.length.toLocaleString('es-UY')} publicaciones · ${products.filter(product => product.active).length.toLocaleString('es-UY')} activas`}</p></div>
      <button type="button" onClick={create} disabled={loading || !catalog || archiveBusy} className="inline-flex items-center gap-2 rounded-xl bg-gray-950 px-4 py-3 text-sm font-medium text-white disabled:opacity-40"><Plus className="h-4 w-4" />Crear publicación</button>
    </header>
    {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
    {archive.error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{archive.error}</p>}
    {archive.notice && <p role="status" className="mb-4 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800">{archive.notice}</p>}
    <div role="tablist" aria-label="Estado de archivo" className="mb-4 flex flex-wrap gap-2">
      {(['publications', 'archived'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value}
        ref={tab === value ? selectedTab : null}
        id={`catalog-tab-${value}`} aria-controls="catalog-tab-panel"
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'publications' : event.key === 'End' ? 'archived' : value === 'publications' ? 'archived' : 'publications';
          setTab(next); setPage(1); document.getElementById(`catalog-tab-${next}`)?.focus();
        }}
        onClick={() => { setTab(value); setPage(1); }} disabled={archiveBusy}
        className={`rounded-xl px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-900 ${tab === value ? 'bg-gray-950 text-white' : 'border border-gray-200 bg-white text-gray-700'}`}>
        {value === 'publications' ? 'Publicaciones' : 'Archivadas'}</button>)}
    </div>
    <div className="mutter-catalog__filters mb-5 grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_220px_170px]">
      <label className="relative"><span className="sr-only">Buscar publicaciones</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400" />
        <input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar por título…" className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm" /></label>
      <MutterSelect label="Filtrar por categoría" hideLabel value={category} onChange={value => { setCategory(value); setPage(1); }}
        options={[{ value: '', label: 'Todas las categorías' }, ...(catalog?.categories.map(item => ({ value: item.id, label: item.name })) ?? [])]} />
      <MutterSelect label="Filtrar por estado" hideLabel value={state} onChange={value => { setState(value); setPage(1); }}
        options={[{ value: 'all', label: 'Todos los estados' }, { value: 'active', label: 'Activas' }, { value: 'inactive', label: 'Inactivas' }]} />
    </div>
    {!loading && catalog && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={pageSelected} disabled={archiveBusy || !visibleIds.length}
        onChange={event => archive.select(visibleIds, event.target.checked)} />Seleccionar esta página ({visible.length})</label>
      <p aria-live="polite" className="text-gray-600">{archive.selectedIds.length} seleccionadas{hiddenSelected > 0 ? ` · ${hiddenSelected} fuera de esta página o filtro` : ''}</p>
      {archive.selectedIds.length > 0 && <><button type="button" disabled={archiveBusy || selectionIntent === null} onClick={event => { if (selectionIntent) prepareArchive(archive.selectedIds, selectionIntent, event.currentTarget); }}
        className="rounded-lg bg-gray-950 px-3 py-2 font-medium text-white disabled:opacity-40">{selectionIntent === 'restore' ? 'Restaurar selección' : selectionIntent === 'withdraw' ? 'Retirar selección' : 'Revisar selección'}</button>
        <button type="button" disabled={archiveBusy} onClick={archive.clearSelection} className="rounded-lg border px-3 py-2 disabled:opacity-40">Limpiar selección</button></>}
      {selectionIssue && <p role="alert" className="w-full text-amber-900">{selectionIssue}</p>}
      {archive.pendingIds.length > 0 && <p className="text-amber-900">{archive.pendingIds.length} operaciones pendientes de consulta. Buscá la publicación en cualquiera de las dos pestañas.</p>}
    </div>}
    {loading ? <p role="status" className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500">Cargando publicaciones…</p>
      : <div id="catalog-tab-panel" role="tabpanel" aria-labelledby={`catalog-tab-${tab}`} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {visible.length === 0 ? <p className="p-10 text-center text-sm text-gray-500">No hay publicaciones que coincidan con estos filtros.</p>
          : <ul className="divide-y divide-gray-100">{visible.map(product => { const pending = archive.pending(product.id); return <li key={product.id} className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3 p-4 sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:gap-5 sm:px-5">
            <button type="button" disabled={opening !== null || archiveBusy || pending.pending} onClick={() => void open(product.id)} aria-label={`Abrir ${product.title.es}`} className="flex h-[76px] w-full items-center justify-center overflow-hidden rounded-xl border border-gray-100 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-800">
              {product.images?.[0] && /^https:\/\//i.test(product.images[0]) ? <img src={product.images[0]} alt="" className="h-full w-full object-contain" loading="lazy" /> : <ImageIcon className="h-7 w-7 text-gray-300" />}
            </button>
            <div className="min-w-0"><button type="button" disabled={opening !== null || archiveBusy || pending.pending} onClick={() => void open(product.id)} className="text-left text-sm font-semibold leading-5 text-gray-900 underline-offset-4 hover:underline">{product.title.es}</button>
              <p className="mt-1 text-xs text-gray-500">{product.category.name || 'Sin categoría'}{product.subcategory.name ? ` · ${product.subcategory.name}` : ''}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs"><span className={`rounded-full px-2 py-1 font-medium ${product.active ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>{product.catalogArchived ? 'Archivada' : product.active ? 'Activa' : 'Inactiva'}</span>
                <span className="font-medium text-gray-800">{money(product.priceUSD)}</span><span className="text-gray-500">Stock: {product.stockTotal ?? 'sin dato'}</span><span className="text-gray-500">{product.images?.length ?? 0} imágenes</span></div>
              <label className="mt-3 flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" aria-label={`Seleccionar ${product.title.es}`} checked={archive.selectedIds.includes(product.id)} disabled={archiveBusy}
                onChange={event => archive.select([product.id], event.target.checked)} />Seleccionar</label>
            </div>
            <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:flex-col">
              <button type="button" disabled={opening !== null || archiveBusy || pending.pending} onClick={() => void open(product.id)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:text-gray-400">{opening === product.id ? 'Abriendo…' : 'Abrir y editar'}<ArrowRight className="h-4 w-4" /></button>
              {pending.pending ? <><button type="button" disabled={archiveBusy || archive.consulting === product.id || pending.foreign || pending.invalid} onClick={() => void archive.consult(product.id)} className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-900 disabled:opacity-40">{archive.consulting === product.id ? 'Consultando…' : 'Consultar resultado'}</button>
                {(pending.foreign || pending.invalid) && <p className="max-w-48 text-xs text-amber-900">{pending.foreign ? 'Volvé a la cuenta que inició la operación.' : 'La operación guardada necesita revisión.'}</p>}</>
                : <button type="button" disabled={archiveBusy} onClick={event => prepareArchive([product.id], product.catalogArchived ? 'restore' : 'withdraw', event.currentTarget)}
                  aria-label={`${product.catalogArchived ? 'Restaurar' : 'Retirar'} ${product.title.es}`} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 disabled:opacity-40">{product.catalogArchived ? 'Restaurar' : 'Retirar'}</button>}
            </div>
          </li>; })}</ul>}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-4 text-sm"><span className="text-gray-500">{filtered.length.toLocaleString('es-UY')} resultados · Página {selectedPage} de {pages}</span>
          <div className="flex gap-2"><button type="button" disabled={selectedPage <= 1} onClick={() => setPage(selectedPage - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-30">Anterior</button><button type="button" disabled={selectedPage >= pages} onClick={() => setPage(selectedPage + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-30">Siguiente</button></div></footer>
      </div>}
    {editor && catalog && <ScopedCatalogEditor key={`${editor.document.id}:${editor.document.version}`} mode="scoped" initial={editor} categories={catalog.categories} onSave={save}
      onReopen={async () => { const uid = actor.current; const current = await reopenSupersededCatalogEdit(editor.document.id); if (mounted.current && uid === actor.current) setEditor(current); }} onClose={() => setEditor(null)} />}
    {draft && catalog && <PublicationCreate key={draft.id} draft={draft} categories={catalog.categories} onCreated={(document, superseded) => { if (mounted.current && actor.current === viewKey) accept(document, true, superseded); }} onClose={() => setDraft(null)} />}
    {archive.confirmation && <PublicationArchiveDialog confirmation={archive.confirmation} titles={titles} consulting={archive.consulting}
      onClose={closeArchive} onConfirm={() => void archive.confirm()} onPrepare={() => { const current = archive.confirmation; if (current) void archive.prepare(current.ids, current.intent); }}
      onConsult={id => void archive.consult(id)} />}
  </section>;
}
