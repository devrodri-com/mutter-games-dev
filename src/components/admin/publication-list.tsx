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

const PAGE_SIZE = 30;
const money = (value: number | undefined) => value === undefined ? 'Sin precio' : new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'UYU' }).format(value);
export default function PublicationList() {
  const { user, credentialScope } = useAuth();
  const [catalog, setCatalog] = useState<AdminCatalogRead | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState(''), [category, setCategory] = useState(''), [state, setState] = useState('all'), [page, setPage] = useState(1);
  const [editor, setEditor] = useState<CatalogEditOpen | null>(null), [draft, setDraft] = useState<CatalogCreateDraft | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const actor = useRef(user?.uid); actor.current = user?.uid;
  useEffect(() => {
    let cancelled = false;
    setCatalog(null); setEditor(null); setDraft(null); setError(null); setLoading(true); setOpening(null);
    void readAdminCatalog().then(value => { if (!cancelled) setCatalog(value); }).catch((failure: unknown) => {
      if (!cancelled) setError(`No se pudieron cargar las publicaciones.${failure instanceof Error ? ` ${failure.message}` : ''}`);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.uid, credentialScope]);
  async function open(id: string) {
    if (opening) return;
    const uid = actor.current;
    setOpening(id); setError(null); setNotice(null);
    try { const current = await openCatalogEdit(id); if (actor.current === uid) setEditor(current); }
    catch (failure: unknown) { if (actor.current === uid) setError(failure instanceof Error ? failure.message : 'No se pudo abrir la publicación.'); }
    finally { if (actor.current === uid) setOpening(null); }
  }
  function accept(document: CatalogEditDocument, created = false, superseded = false) {
    setCatalog(previous => {
      if (!previous) return previous;
      const row = catalogProductForDisplay(document.id, document.product, previous.categories, previous.subcategories);
      const found = previous.products.some(product => product.id === document.id);
      return { ...previous, products: found ? previous.products.map(product => product.id === document.id ? row : product) : [row, ...previous.products] };
    });
    setEditor(null); setDraft(null); setNotice(created ? superseded ? 'Publicación creada; se abrió una edición posterior.' : 'Publicación creada y comprobada.' : 'Cambios guardados y comprobados.');
    if (created) { setCategory(''); setSearch(''); setState('all'); setPage(1); }
  }
  async function save(document: CatalogEditDocument, changes: CatalogEditChanges, imageOperations?: string[]) {
    const uid = actor.current, confirmed = await saveCatalogEdit(document, changes, imageOperations);
    if (actor.current === uid) accept(confirmed);
  }
  function create() {
    setError(null); setNotice(null);
    try { setDraft(newCatalogDraft()); }
    catch (failure: unknown) { setError(failure instanceof Error ? failure.message : 'No se pudo abrir el borrador.'); }
  }
  const products = catalog?.products ?? [];
  const query = search.trim().toLocaleLowerCase();
  const filtered = products.filter(product => (!query || product.title.es.toLocaleLowerCase().includes(query) || product.title.en.toLocaleLowerCase().includes(query))
    && (!category || product.category.id === category) && (state === 'all' || product.active === (state === 'active')));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), selectedPage = Math.min(page, pages);
  const visible = filtered.slice((selectedPage - 1) * PAGE_SIZE, selectedPage * PAGE_SIZE);
  return <section className="mutter-catalog mx-auto w-full max-w-7xl" aria-labelledby="publications-heading">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-500">Catálogo</p>
      <h1 id="publications-heading" className="text-2xl font-semibold tracking-tight text-gray-950">Publicaciones</h1>
      <p className="mt-2 text-sm text-gray-500">{loading ? 'Cargando catálogo…' : `${products.length.toLocaleString('es-UY')} publicaciones · ${products.filter(product => product.active).length.toLocaleString('es-UY')} activas`}</p></div>
      <button type="button" onClick={create} disabled={loading || !catalog} className="inline-flex items-center gap-2 rounded-xl bg-gray-950 px-4 py-3 text-sm font-medium text-white disabled:opacity-40"><Plus className="h-4 w-4" />Crear publicación</button>
    </header>
    {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
    <div className="mutter-catalog__filters mb-5 grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_220px_170px]">
      <label className="relative"><span className="sr-only">Buscar publicaciones</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400" />
        <input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar por título…" className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm" /></label>
      <MutterSelect label="Filtrar por categoría" hideLabel value={category} onChange={value => { setCategory(value); setPage(1); }}
        options={[{ value: '', label: 'Todas las categorías' }, ...(catalog?.categories.map(item => ({ value: item.id, label: item.name })) ?? [])]} />
      <MutterSelect label="Filtrar por estado" hideLabel value={state} onChange={value => { setState(value); setPage(1); }}
        options={[{ value: 'all', label: 'Todos los estados' }, { value: 'active', label: 'Activas' }, { value: 'inactive', label: 'Inactivas' }]} />
    </div>
    {loading ? <p role="status" className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500">Cargando publicaciones…</p>
      : <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {visible.length === 0 ? <p className="p-10 text-center text-sm text-gray-500">No hay publicaciones que coincidan con estos filtros.</p>
          : <ul className="divide-y divide-gray-100">{visible.map(product => <li key={product.id} className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3 p-4 sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:gap-5 sm:px-5">
            <button type="button" disabled={opening !== null} onClick={() => void open(product.id)} aria-label={`Abrir ${product.title.es}`} className="flex h-[76px] w-full items-center justify-center overflow-hidden rounded-xl border border-gray-100 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-800">
              {product.images?.[0] && /^https:\/\//i.test(product.images[0]) ? <img src={product.images[0]} alt="" className="h-full w-full object-contain" loading="lazy" /> : <ImageIcon className="h-7 w-7 text-gray-300" />}
            </button>
            <div className="min-w-0"><button type="button" disabled={opening !== null} onClick={() => void open(product.id)} className="text-left text-sm font-semibold leading-5 text-gray-900 underline-offset-4 hover:underline">{product.title.es}</button>
              <p className="mt-1 text-xs text-gray-500">{product.category.name || 'Sin categoría'}{product.subcategory.name ? ` · ${product.subcategory.name}` : ''}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs"><span className={`rounded-full px-2 py-1 font-medium ${product.active ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>{product.active ? 'Activa' : 'Inactiva'}</span>
                <span className="font-medium text-gray-800">{money(product.priceUSD)}</span><span className="text-gray-500">Stock: {product.stockTotal ?? 'sin dato'}</span><span className="text-gray-500">{product.images?.length ?? 0} imágenes</span></div>
            </div>
            <button type="button" disabled={opening !== null} onClick={() => void open(product.id)} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:text-gray-400 sm:col-span-1">{opening === product.id ? 'Abriendo…' : 'Abrir y editar'}<ArrowRight className="h-4 w-4" /></button>
          </li>)}</ul>}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-4 text-sm"><span className="text-gray-500">{filtered.length.toLocaleString('es-UY')} resultados · Página {selectedPage} de {pages}</span>
          <div className="flex gap-2"><button type="button" disabled={selectedPage <= 1} onClick={() => setPage(selectedPage - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-30">Anterior</button><button type="button" disabled={selectedPage >= pages} onClick={() => setPage(selectedPage + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-30">Siguiente</button></div></footer>
      </div>}
    {editor && catalog && <ScopedCatalogEditor key={`${editor.document.id}:${editor.document.version}`} mode="scoped" initial={editor} categories={catalog.categories} onSave={save}
      onReopen={async () => { const uid = actor.current; const current = await reopenSupersededCatalogEdit(editor.document.id); if (uid === actor.current) setEditor(current); }} onClose={() => setEditor(null)} />}
    {draft && catalog && <PublicationCreate key={draft.id} draft={draft} categories={catalog.categories} onCreated={(document, superseded) => { if (actor.current === user?.uid) accept(document, true, superseded); }} onClose={() => setDraft(null)} />}
  </section>;
}
