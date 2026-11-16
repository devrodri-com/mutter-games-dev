import { useEffect, useRef } from 'react';
import type { Product } from '../data/types';
import ProductCard from './ProductCard';
import ProductSkeleton from './ProductSkeleton';

interface ShopResultsProps {
  products: Product[];
  pending: boolean;
  complete: boolean;
  error: string | null;
  hasMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onClear: () => void;
}
export default function ShopResults({ products, pending, complete, error, hasMore, onRetry, onLoadMore, onClear }: ShopResultsProps) {
  const grid = useRef<HTMLDivElement>(null);
  const nextFocus = useRef<number | null>(null);
  useEffect(() => {
    const index = nextFocus.current;
    if (index === null) return;
    grid.current?.querySelectorAll<HTMLAnchorElement>('a')[index]?.focus();
    nextFocus.current = null;
  }, [products.length]);
  return <>
    {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-900">
      <p>{error}</p>
      <button type="button" onClick={onRetry} disabled={pending} className="mt-2 font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600 disabled:opacity-50">Reintentar carga</button>
    </div>}
    {pending && <p role="status" className="mt-4 text-sm text-gray-600">Cargando catálogo completo...</p>}
    <div id="shop-results" ref={grid} aria-busy={pending} className="shop-results-grid grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 mt-6">
      {products.map(product => <ProductCard key={product.id} product={product} presentation="catalog" />)}
      {!products.length && pending && Array.from({ length: 8 }, (_, index) => <ProductSkeleton key={index} />)}
      {!products.length && complete && !error && !pending && <div className="col-span-full py-16 min-h-[300px] text-center space-y-4">
        <p className="text-gray-500 font-medium max-w-xl mx-auto">No se encontraron productos con los filtros seleccionados.</p>
        <button type="button" onClick={onClear} className="text-red-600 hover:underline font-semibold mt-2 inline-block">Mostrar todos los productos</button>
      </div>}
    </div>
    {hasMore && !pending && <div className="flex justify-center mt-8 mb-8">
      <button type="button" aria-controls="shop-results" onClick={() => { nextFocus.current = products.length; onLoadMore(); }} className="px-6 py-3 bg-black text-white rounded-lg font-semibold hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">Cargar más productos</button>
    </div>}
  </>;
}
