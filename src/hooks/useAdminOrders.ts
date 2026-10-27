import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { readAdminOrder, readAdminOrders } from '../utils/adminOrders';
import type { AdminOrderCursor, AdminOrderDetail, AdminOrderSection, AdminOrderSummary } from '../domain/adminOrders';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'No pudimos leer los pedidos. Reintentá la consulta.';
type PageState = { orders: AdminOrderSummary[]; nextCursor: AdminOrderCursor | null; loading: boolean; error: string | null; loaded: boolean };
const emptyPage = (): PageState => ({ orders: [], nextCursor: null, loading: false, error: null, loaded: false });
export function useAdminOrders() {
  const [pages, setPages] = useState<Record<AdminOrderSection, PageState>>({ recent: emptyPage(), undated: emptyPage() });
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const generation = useRef(0), detailGeneration = useRef(0), busy = useRef(new Set<AdminOrderSection>());
  const active = useRef(new Set<AbortController>());

  const load = useCallback(async (section: AdminOrderSection, cursor?: AdminOrderCursor) => {
    if (busy.current.has(section)) return;
    const epoch = generation.current, controller = new AbortController();
    const patch = (changes: Partial<PageState>) => setPages(previous => ({ ...previous, [section]: { ...previous[section], ...changes } }));
    active.current.add(controller); busy.current.add(section); patch({ loading: true, error: null });
    try {
      const page = await readAdminOrders(section, cursor, controller.signal);
      if (generation.current !== epoch) return;
      if (page.section !== section) throw new Error('La respuesta corresponde a otra sección de pedidos.');
      setPages(previous => ({ ...previous, [section]: { ...previous[section],
        orders: cursor ? [...new Map([...previous[section].orders, ...page.orders].map(order => [order.id, order])).values()] : page.orders,
        nextCursor: page.nextCursor, loaded: true } }));
    } catch (error) {
      if (generation.current === epoch && !controller.signal.aborted) patch({ error: errorMessage(error) });
    } finally {
      active.current.delete(controller);
      if (generation.current === epoch) { busy.current.delete(section); patch({ loading: false }); }
    }
  }, []);
  const closeDetail = useCallback(() => {
    detailGeneration.current++; setDetailId(null); setDetail(null); setDetailError(null); setDetailLoading(false);
  }, []);
  const openDetail = useCallback(async (id: string) => {
    const epoch = generation.current, request = ++detailGeneration.current, controller = new AbortController();
    active.current.add(controller); setDetailId(id); setDetail(null); setDetailError(null); setDetailLoading(true);
    try {
      const order = await readAdminOrder(id, controller.signal);
      if (epoch === generation.current && request === detailGeneration.current) setDetail(order);
    } catch (error) {
      if (epoch === generation.current && request === detailGeneration.current && !controller.signal.aborted) setDetailError(errorMessage(error));
    } finally {
      active.current.delete(controller);
      if (epoch === generation.current && request === detailGeneration.current) setDetailLoading(false);
    }
  }, []);
  const reset = useCallback(() => {
    generation.current++; busy.current.clear();
    for (const controller of active.current) controller.abort();
    active.current.clear(); setPages({ recent: emptyPage(), undated: emptyPage() }); closeDetail();
  }, [closeDetail]);
  useEffect(() => {
    const sessionError = (message: string) => setPages(previous => ({ ...previous, recent: { ...emptyPage(), error: message } }));
    const unsubscribe = onAuthStateChanged(auth, user => {
      reset();
      if (user) { void load('recent'); }
      else sessionError('Iniciá sesión con una cuenta administradora para consultar pedidos.');
    }, () => { reset(); sessionError('No pudimos verificar la sesión administradora.'); });
    return () => { generation.current++; detailGeneration.current++; for (const controller of active.current) controller.abort(); active.current.clear(); unsubscribe(); };
  }, [load, reset]);
  return { ...pages, reload: () => { reset(); return load('recent'); },
    loadMore: (section: AdminOrderSection) => load(section, pages[section].nextCursor ?? undefined),
    detail, detailId, detailLoading, detailError, openDetail, closeDetail };
}
