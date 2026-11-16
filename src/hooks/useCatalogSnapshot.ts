import { useCallback, useEffect, useRef, useState } from 'react';
import type { Product } from '../data/types';
import { fetchInitialShopProducts, fetchShopCatalogSnapshot } from '../firebase/shopCatalog';

type SnapshotState = { products: Product[]; complete: boolean; pending: boolean; error: string | null };
export type CatalogSnapshot = SnapshotState & { retry: () => void };

export function useCatalogSnapshot(): CatalogSnapshot {
  const [state, setState] = useState<SnapshotState>({ products: [], complete: false, pending: true, error: null });
  const mounted = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback((includeInitial: boolean) => {
    if (!mounted.current) return;
    const current = ++generation.current;
    let fullSucceeded = false;
    let fullSettled = false;
    const isCurrent = () => mounted.current && generation.current === current;
    // Keep products as a preview, but only the new full server result can
    // establish completeness for the current generation.
    setState(previous => ({ ...previous, complete: false, pending: true, error: null }));

    if (includeInitial) {
      void fetchInitialShopProducts().then(products => {
        if (isCurrent() && !fullSucceeded) setState(previous => ({ ...previous, products }));
      }, () => {
        if (isCurrent() && !fullSettled) setState(previous => ({ ...previous,
          error: 'No pudimos cargar la primera vista. Seguimos cargando el catálogo completo.' }));
      });
    }

    void fetchShopCatalogSnapshot().then(products => {
      if (!isCurrent()) return;
      fullSucceeded = true;
      fullSettled = true;
      setState({ products, complete: true, pending: false, error: null });
    }, () => {
      fullSettled = true;
      if (isCurrent()) setState(previous => ({ ...previous, complete: false, pending: false,
        error: 'No pudimos cargar el catálogo completo. Reintentá para buscar en todas las publicaciones.' }));
    });
  }, []);

  const retry = useCallback(() => refresh(false), [refresh]);
  useEffect(() => {
    mounted.current = true;
    refresh(true);
    window.addEventListener('focus', retry);
    return () => {
      mounted.current = false;
      generation.current += 1;
      window.removeEventListener('focus', retry);
    };
  }, [refresh, retry]);

  return { ...state, retry };
}
