import { useEffect, useRef, useState } from 'react';
import { adminAttentionLabel, adminDate, adminInventoryLabel, adminMoney, adminOrderLabel, adminPaymentLabel, type AdminOrderDetail } from '../../../domain/adminOrders';
import { printOrderLabel } from './orderLabel';

type Props = { id: string; order: AdminOrderDetail | null; loading: boolean; error: string | null; onClose: () => void; onRetry: () => void };
export function OrderDetail({ id, order, loading, error, onClose, onRetry }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false), [printError, setPrintError] = useState<string | null>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [id]);
  async function print() {
    if (!order || printing) return;
    setPrinting(true); setPrintError(null);
    try { await printOrderLabel(order); }
    catch (error) { setPrintError(error instanceof Error ? error.message : 'No pudimos generar la etiqueta.'); }
    finally { setPrinting(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="order-detail-title" className="bg-white p-6 rounded shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto" onKeyDown={event => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <div className="flex justify-between gap-4 mb-4"><h2 id="order-detail-title" className="text-xl font-bold">Detalle del Pedido</h2><button type="button" onClick={onClose} className="text-blue-600">Cerrar</button></div>
      <p className="break-all"><strong>ID:</strong> {id}</p>
      {loading && <p role="status">Consultando el estado del servidor…</p>}
      {error && <div role="alert" className="my-4 text-red-700"><p>{error}</p><button type="button" onClick={onRetry} className="underline">Reintentar detalle</button></div>}
      {order && <>
        <section className="my-4 space-y-1" aria-label="Estado del pago y del stock">
          <p className="font-semibold">{adminOrderLabel(order)}</p>
          <p>{adminPaymentLabel(order)}</p><p>{adminInventoryLabel(order.inventoryState)}</p>
          {order.attention && <p className="text-amber-800">{adminAttentionLabel(order.attention)}</p>}
          {order.historical ? <p>Este pedido es histórico: no se verificó su pago ni se descontó stock automáticamente.</p> : <>
            <p>Plazo de pago: {adminDate(order.paymentDeadline ?? order.reservedUntil)}</p>
            <p>Reserva hasta: {adminDate(order.reservedUntil)}</p>
            <p>Liberación: {adminDate(order.releasedAt)}</p><p>Descuento de stock: {adminDate(order.committedAt)}</p>
            <p>Última verificación: {adminDate(order.lastVerifiedAt)}</p><p>Próxima comprobación: {adminDate(order.nextCheckAt)}</p>
            {order.paymentId && <p>Pago aprobado verificado: {order.paymentId}</p>}
            {order.reconciliation.lastError && <p className="text-amber-800">{adminAttentionLabel(order.reconciliation.lastError)}</p>}
            {order.inventoryState === 'reserved' && <p>Las unidades de esta reserva siguen comprometidas. Los ajustes de stock conservan esa protección.</p>}
          </>}
        </section>
        <section className="mb-4" aria-label="Cliente y entrega"><h3 className="font-semibold">Cliente y entrega</h3>
          <p>{order.customer.name || 'Nombre no registrado'}</p><p>{order.customer.email || 'Email no registrado'}</p><p>{order.customer.phone || 'Teléfono no registrado'}</p>
          <p>{order.delivery === 'pickup' ? 'Retiro' : order.delivery === 'shipping' ? 'Envío' : 'Entrega no registrada'}</p>
          <p>{Object.values(order.shipping).filter(Boolean).join(', ') || 'Dirección no registrada'}</p>
        </section>
        <div className="overflow-x-auto"><table className="w-full border text-sm"><thead><tr><th className="border p-2 text-left">Producto</th><th className="border p-2 text-left">Variante</th><th className="border p-2">Cantidad</th><th className="border p-2">Precio unitario</th></tr></thead>
          <tbody>{order.items.map((item, index) => <tr key={index}><td className="border p-2">{item.title}</td><td className="border p-2">{item.variant || '-'}</td><td className="border p-2">{item.quantity ?? 'No registrada'}</td><td className="border p-2">{adminMoney(item.unitPrice, order.currency)}</td></tr>)}</tbody></table></div>
        {order.itemsTruncated && <p role="status">Se muestran los primeros 100 artículos. Este pedido contiene más artículos registrados.</p>}
        <div className="my-4 text-right"><p>Envío: {adminMoney(order.shippingCost, order.currency)}</p><p className="font-semibold">Total registrado: {adminMoney(order.total, order.currency)}</p></div>
        {printError && <p role="alert" className="text-red-700">{printError}</p>}
        <button type="button" onClick={() => void print()} disabled={printing} className="px-4 py-2 rounded border disabled:opacity-50">{printing ? 'Generando etiqueta…' : 'Imprimir etiqueta'}</button>
      </>}
    </div>
  </div>;
}
