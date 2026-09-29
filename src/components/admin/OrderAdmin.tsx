import { useState } from 'react';
import { useAdminOrders } from '../../hooks/useAdminOrders';
import { adminAttentionLabel, adminDate, adminInventoryLabel, adminMoney, adminOrderLabel, adminPaymentLabel } from '../../domain/adminOrders';
import { OrderDetail } from './orders/OrderDetail';

export default function OrderAdmin() {
  const model = useAdminOrders();
  const [search, setSearch] = useState('');
  const searchText = search.trim().toLocaleLowerCase('es');
  const orders = model.orders.filter(order => [order.id, order.customer.name, order.customer.email].some(value => value.toLocaleLowerCase('es').includes(searchText)));
  return <div className="p-4">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Historial de Pedidos</h1>
      <button type="button" onClick={() => void model.reload()} disabled={model.loading} className="border rounded px-3 py-2 disabled:opacity-50">Actualizar</button></div>
    <p className="text-sm text-gray-600 mb-4">Estado de pago y stock según la última consulta al servidor. Esta vista es de sólo lectura.</p>
    <label className="block mb-4">Buscar en los pedidos cargados
      <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="ID, nombre o email" className="block border border-gray-300 rounded px-3 py-2 w-full" />
    </label>
    {model.error && <p role="alert" className="mb-4 text-red-700">{model.error}</p>}
    {model.loading && <p role="status" className="mb-4">Consultando pedidos…</p>}
    {model.loaded && !model.loading && !model.error && orders.length === 0 && <p>{model.orders.length ? 'No hay coincidencias entre los pedidos cargados.' : 'No hay pedidos en esta página.'}</p>}
    {orders.length > 0 && <div className="overflow-x-auto border border-gray-200 rounded-lg"><table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-100"><tr>{['Pedido', 'Fecha', 'Cliente', 'Total', 'Pago y stock', 'Acciones'].map(title => <th key={title} className="px-4 py-2 text-left text-sm font-semibold text-gray-700">{title}</th>)}</tr></thead>
      <tbody className="divide-y divide-gray-100 bg-white">{orders.map(order => <tr key={order.id}>
        <td className="px-4 py-2 text-sm break-all max-w-[180px]">{order.id}</td><td className="px-4 py-2 text-sm">{adminDate(order.createdAt)}</td>
        <td className="px-4 py-2 text-sm"><p>{order.customer.name || 'Nombre no registrado'}</p><p>{order.customer.email}</p><p>{order.customer.phone}</p></td>
        <td className="px-4 py-2 text-sm whitespace-nowrap">{adminMoney(order.total, order.currency)}</td>
        <td className="px-4 py-2 text-sm"><p className="font-semibold">{adminOrderLabel(order)}</p><p>{adminPaymentLabel(order)}</p><p>{adminInventoryLabel(order.inventoryState)}</p>
          {order.reservedUntil !== null && order.inventoryState === 'reserved' && <p>Plazo de reserva: {adminDate(order.reservedUntil)}</p>}
          {order.inventoryState === 'released' && <p>Liberación: {adminDate(order.releasedAt)}</p>}
          {order.attention && <p className="text-amber-800 max-w-sm">{adminAttentionLabel(order.attention)}</p>}
        </td>
        <td className="px-4 py-2 text-sm"><button type="button" onClick={() => void model.openDetail(order.id)} className="text-blue-600 hover:underline">Ver detalle</button></td>
      </tr>)}</tbody></table></div>}
    <div className="my-4"><p className="text-sm text-gray-600">Páginas por identificador de pedido; el historial conserva los registros sin fecha.</p>
      {model.nextCursor && <button type="button" onClick={() => void model.loadMore()} disabled={model.loading} className="mt-2 border rounded px-3 py-2 disabled:opacity-50">Cargar más pedidos</button>}
    </div>
    {model.detailId && <OrderDetail id={model.detailId} order={model.detail} loading={model.detailLoading} error={model.detailError} onClose={model.closeDetail} onRetry={() => { if (model.detailId) void model.openDetail(model.detailId); }} />}
  </div>;
}
