import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Product } from '../../src/data/types';
import type { CatalogSnapshot } from '../../src/hooks/useCatalogSnapshot';
import { getCatalogDisplayPrice, readShopCriteria, selectShopProducts, type ShopCriteria } from '../../src/domain/shopSelection';
const boundary = vi.hoisted(() => ({ snapshot: { products: [], complete: true, pending: false, error: null, retry: vi.fn() } as CatalogSnapshot,
  categories: vi.fn(), language: 'es' }));
vi.mock('../../src/hooks/useCatalogSnapshot', () => ({ useCatalogSnapshot: () => boundary.snapshot }));
vi.mock('../../src/firebase/categories', () => ({ fetchCategories: boundary.categories }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: boundary.language } }) }));
vi.mock('../../src/components/ProductCard', () => ({ default: ({ product }: { product: Product }) => <a href={'/producto/'+product.id}>{product.title.es}</a> }));
import { useShopProducts } from '../../src/hooks/useShopProducts';
import ShopResults from '../../src/components/ShopResults';
const item = (index: number, changes: Partial<Product> = {}): Product => ({ id: 'p'+index, name: 'Juego '+index, title: { es: 'Juego '+index, en: '' },
  active: true, priceUSD: index+1, description: '', images: [], category: { id: 'retro', name: 'Retro' }, subcategory: { id: 'cartuchos', name: 'Cartuchos', categoryId: 'retro' }, tipo: 'Juegos', ...changes });
const defaults: ShopCriteria = { search: '', category: '', subcategory: '', type: 'Todos', sort: 'az' };
let root: Root | null = null, latest: ReturnType<typeof useShopProducts> | null = null, navigate: NavigateFunction | null = null;
function current() { if (!latest) throw new Error('Hook missing'); return latest; }
function Probe() {
  const value = useShopProducts(); latest = value; navigate = useNavigate();
  return <><p data-count>{value.countDescription}</p><ShopResults products={value.sortedProducts} pending={value.catalogPending} complete={value.catalogComplete}
    error={value.catalogError} hasMore={value.hasMore} onLoadMore={value.loadMore} onRetry={value.retryCatalog}
    onClear={() => { value.setSearchTerm(''); value.setSelectedCategory(''); value.setSelectedSubcategory(''); value.setSelectedType('Todos'); }} /></>;
}
async function mount(url='/shop', products=Array.from({length:137},(_,i)=>item(i))) {
  boundary.snapshot.products=products;
  const host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root?.render(<MemoryRouter initialEntries={[url]}><Probe/></MemoryRouter>));
}
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); latest=null; navigate=null; boundary.language='es';
  boundary.snapshot={products:[],complete:true,pending:false,error:null,retry:vi.fn()};
  boundary.categories.mockResolvedValue([{id:'retro',name:'Retro',subcategories:[{id:'cartuchos',name:'Cartuchos',categoryId:'retro'}]}]);
});
afterEach(async()=>{await act(async()=>root?.unmount());root=null;document.body.replaceChildren();});

test('selection reaches products beyond24 and100 and applies every criterion together before sorting',()=>{
  const products=Array.from({length:1200},(_,i)=>item(i));
  products[1199]=item(1199,{title:{es:'Colección Pokémon Amarillo',en:'Yellow Pokemon'},priceUSD:2});
  products.push(item(1300,{active:false,title:{es:'Colección Pokémon Amarillo',en:''},priceUSD:1}));
  const result=selectShopProducts(products,{...defaults,search:'  POKEMON   amarillo ',category:'retro',subcategory:'cartuchos',type:'juegos',sort:'priceAsc'},'es');
  expect(result.map(p=>p.id)).toEqual(['p1199']);expect(products).toHaveLength(1201);
  expect(selectShopProducts(products,{...defaults,search:'Yellow Pokemon'},'es').map(p=>p.id)).toEqual(['p1199']);
  expect(selectShopProducts(products,{...defaults,search:'pokemon',category:'other'},'es')).toEqual([]);
});
test('price order uses exactly the same variant-first display price as cards, globally and without mutating data',()=>{
  const variant=item(2,{priceUSD:1,variants:[{label:{es:'Modelo',en:''},options:[{value:'A',priceUSD:70},{value:'B',priceUSD:50}]}]});
  expect(getCatalogDisplayPrice(variant)).toBe(50);
  const values=[item(0,{priceUSD:40}),variant,item(3,{priceUSD:NaN})],before=values.map(p=>p.id);
  expect(selectShopProducts(values,{...defaults,sort:'priceAsc'},'es').map(p=>p.id)).toEqual(['p0','p2','p3']);
  expect(selectShopProducts(values,{...defaults,sort:'priceDesc'},'es').map(p=>p.id)).toEqual(['p2','p0','p3']);expect(values.map(p=>p.id)).toEqual(before);
});
test('global sort and card pagination work equally with search and filters, with no new transport',async()=>{
  await mount('/shop?q=juego&type=Juegos&sort=priceDesc');
  expect(current().filteredProducts).toHaveLength(137);expect(current().sortedProducts[0].id).toBe('p136');
  expect(document.querySelectorAll('#shop-results a')).toHaveLength(24);
  await act(async()=>{current().loadMore();});expect(current().sortedProducts).toHaveLength(48);
  await act(async()=>{current().setSearchTerm('juego 119');});
  expect(current().sortedProducts.map(p=>p.id)).toEqual(['p119']);expect(current().hasMore).toBe(false);
  await act(async()=>{current().setSearchTerm('juego');});expect(current().sortedProducts).toHaveLength(24);
  expect(boundary.snapshot.retry).not.toHaveBeenCalled();expect(boundary.categories).toHaveBeenCalledTimes(1);
});
test('page count describes all matches, and keyboard load-more focuses the first newly rendered product',async()=>{
  await mount();expect(document.querySelector('[data-count]')?.textContent).toBe('137 productos encontrados');
  const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Cargar más productos');expect(button).toBeTruthy();
  await act(async()=>{button?.focus();button?.click();});
  const links=document.querySelectorAll('#shop-results a');expect(links).toHaveLength(48);expect(document.activeElement).toBe(links[24]);
});
test('pending and failed global reads never claim a partial filtered catalog is empty or complete',async()=>{
  boundary.snapshot.complete=false;boundary.snapshot.pending=true;
  await mount('/shop?q=missing',[item(0)]);
  expect(document.querySelector('[data-count]')?.textContent).toContain('Cargando');expect(document.querySelectorAll('#shop-results a')).toHaveLength(0);
  expect(document.body.textContent).not.toContain('No se encontraron productos');
  boundary.snapshot={...boundary.snapshot,pending:false,error:'No pudimos completar el catálogo.'};
  await act(async()=>{root?.render(<MemoryRouter initialEntries={['/shop?q=missing']}><Probe/></MemoryRouter>);});
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('No pudimos');expect(document.body.textContent).not.toContain('No se encontraron productos');
  const retry=[...document.querySelectorAll('button')].find(b=>b.textContent==='Reintentar carga');
  await act(async()=>{retry?.click();});expect(boundary.snapshot.retry).toHaveBeenCalledTimes(1);
});
test('complete empty catalog offers clear filters; hidden products never render even in a supplied snapshot',async()=>{
  await mount('/shop?q=hidden',[item(0,{active:false,title:{es:'hidden',en:''}})]);
  expect(document.querySelectorAll('#shop-results a')).toHaveLength(0);expect(document.body.textContent).toContain('No se encontraron productos');
  expect(document.body.textContent).toContain('Mostrar todos los productos');
});
test('browser navigation adopts URL criteria rather than rewriting the previous query, including Spanish accents',async()=>{
  await mount('/shop?q=juego+119');expect(current().sortedProducts.map(p=>p.id)).toEqual(['p119']);
  await act(async()=>{navigate?.('/shop?q=juego+27&sort=za');});expect(current().searchTerm).toBe('juego 27');expect(current().sortedProducts.map(p=>p.id)).toEqual(['p27']);
  await act(async()=>{navigate?.(-1);});expect(current().searchTerm).toBe('juego 119');
  expect(readShopCriteria('?sort=unsupported').sort).toBe('az');
});
