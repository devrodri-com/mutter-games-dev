import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { readAdminOrder, readAdminOrders } from '../utils/adminOrders';
import type { AdminOrderDetail, AdminOrderSummary } from '../domain/adminOrders';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'No pudimos leer los pedidos. Reintentá la consulta.';
export function useAdminOrders() {
  const [orders, setOrders] = useState<AdminOrderSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const generation = useRef(0), detailGeneration = useRef(0), busy = useRef(false);
  const active = useRef(new Set<AbortController>());

  const load = useCallback(async (cursor?: string) => {
    if (busy.current) return;
    const epoch = generation.current, controller = new AbortController();
    active.current.add(controller); busy.current = true; setLoading(true); setError(null);
    try {
      const page = await readAdminOrders(cursor, controller.signal);
      if (generation.current !== epoch) return;
      setOrders(previous => cursor ? [...new Map([...previous, ...page.orders].map(order => [order.id, order])).values()] : page.orders);
      setNextCursor(page.nextCursor); setLoaded(true);
    } catch (error) {
      if (generation.current === epoch && !controller.signal.aborted) setError(errorMessage(error));
    } finally {
      active.current.delete(controller);
      if (generation.current === epoch) { busy.current = false; setLoading(false); }
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
  useEffect(() => {
    const reset = () => {
      generation.current++; busy.current = false;
      for (const controller of active.current) controller.abort();
      active.current.clear(); setOrders([]); setNextCursor(null); setLoaded(false); closeDetail();
    };
    const unsubscribe = onAuthStateChanged(auth, user => {
      reset();
      if (user) { void load(); }
      else { setLoading(false); setError('Iniciá sesión con una cuenta administradora para consultar pedidos.'); }
    }, () => { reset(); setLoading(false); setError('No pudimos verificar la sesión administradora.'); });
    return () => { generation.current++; detailGeneration.current++; for (const controller of active.current) controller.abort(); active.current.clear(); unsubscribe(); };
  }, [load, closeDetail]);
  return { orders, nextCursor, loading, loaded, error, reload: () => load(), loadMore: () => nextCursor ? load(nextCursor) : Promise.resolve(),
    detail, detailId, detailLoading, detailError, openDetail, closeDetail };
}
