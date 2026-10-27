import { adminAttentionLabel, adminCommercialAttention, adminDate, adminInventoryLabel, adminMoney, adminOrderDateLabel, adminOrderLabel, adminPaymentLabel, type AdminOrderSummary } from '../../../domain/adminOrders';

export function OrderList({ orders, openDetail }: { orders: AdminOrderSummary[]; openDetail: (id: string) => Promise<void> }) {
  return <div className="overflow-x-auto border border-gray-200 rounded-lg"><table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-100"><tr>{['Pedido', 'Fecha', 'Cliente', 'Total', 'Pago y stock', 'Acciones'].map(title => <th key={title} className="px-4 py-2 text-left text-sm font-semibold text-gray-700">{title}</th>)}</tr></thead>
      <tbody className="divide-y divide-gray-100 bg-white">{orders.map(order => <tr key={order.id}>
        <td className="px-4 py-2 text-sm break-all max-w-[180px]">{order.id}</td><td className="px-4 py-2 text-sm">{adminOrderDateLabel(order)}</td>
        <td className="px-4 py-2 text-sm"><p>{order.customer.name || 'Nombre no registrado'}</p><p>{order.customer.email}</p><p>{order.customer.phone}</p></td>
        <td className="px-4 py-2 text-sm whitespace-nowrap">{adminMoney(order.total, order.currency)}</td>
        <td className="px-4 py-2 text-sm"><p className="font-semibold">{adminOrderLabel(order)}</p><p>{adminPaymentLabel(order)}</p><p>{adminInventoryLabel(order.inventoryState)}</p>
          {order.reservedUntil !== null && order.inventoryState === 'reserved' && <p>Plazo de reserva: {adminDate(order.reservedUntil)}</p>}
          {order.inventoryState === 'released' && <p>Liberación: {adminDate(order.releasedAt)}</p>}
          {adminCommercialAttention(order) && order.attention && <p className="text-amber-800 max-w-sm">{adminAttentionLabel(order.attention, order)}</p>}
        </td>
        <td className="px-4 py-2 text-sm"><button type="button" onClick={() => void openDetail(order.id)} className="text-blue-600 hover:underline">Ver detalle</button></td>
      </tr>)}</tbody></table></div>;
}
