import { useState } from 'react';
import { useAdminOrders } from '../../hooks/useAdminOrders';
import type { AdminOrderSection } from '../../domain/adminOrders';
import { OrderDetail } from './orders/OrderDetail';
import { OrderList } from './orders/OrderList';

export default function OrderAdmin() {
  const model = useAdminOrders();
  const [search, setSearch] = useState('');
  const searchText = search.trim().toLocaleLowerCase('es');
  const sections: AdminOrderSection[] = ['recent', 'undated'];
  return <div className="p-4">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Historial de Pedidos</h1>
      <button type="button" onClick={() => void model.reload()} disabled={model.recent.loading} className="border rounded px-3 py-2 disabled:opacity-50">Actualizar</button></div>
    <p className="text-sm text-gray-600 mb-4">Estado de pago y stock según la última consulta al servidor. Esta vista es de sólo lectura.</p>
    <label className="block mb-4">Buscar en los pedidos cargados
      <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="ID, nombre o email" className="block border border-gray-300 rounded px-3 py-2 w-full" />
    </label>
    {sections.map(section => {
      const page = model[section];
      const orders = page.orders.filter(order => [order.id, order.customer.name, order.customer.email].some(value => value.toLocaleLowerCase('es').includes(searchText)));
      return <section key={section} aria-label={section === 'recent' ? 'Pedidos recientes' : 'Sin fecha verificada'} className="mb-6">
        <h2 className="font-semibold mb-2">{section === 'recent' ? 'Pedidos recientes' : 'Sin fecha verificada'}</h2>
        <p className="text-sm text-gray-600 mb-3">{section === 'recent'
          ? 'Más recientes primero. Actualizá para ver nuevas ventas; las páginas cargadas no forman una foto fija de todo el historial.'
          : 'Registros con fecha ausente, vacía o inválida. Se revisan por grupos de identificadores, sin asignarles una fecha.'}</p>
        {page.error && <p role="alert" className="mb-4 text-red-700">{page.error}</p>}
        {page.loading && <p role="status" className="mb-4">Consultando pedidos…</p>}
        {page.loaded && !page.loading && !page.error && orders.length === 0 && <p>{page.orders.length
          ? 'No hay coincidencias entre los pedidos cargados.'
          : section === 'undated' ? 'No se encontraron pedidos sin fecha entre los registros revisados.' : 'No hay pedidos en esta página.'}</p>}
        {orders.length > 0 && <OrderList orders={orders} openDetail={model.openDetail} />}
        {section === 'undated' && page.nextCursor && <p role="status" className="text-sm mt-3">Quedan registros por revisar, aunque este grupo no haya incluido pedidos sin fecha.</p>}
        {(page.nextCursor || (section === 'undated' && !page.loaded)) && <button type="button" onClick={() => void model.loadMore(section)} disabled={page.loading} className="mt-2 border rounded px-3 py-2 disabled:opacity-50">
          {section === 'recent' ? 'Cargar más pedidos' : page.loaded ? 'Revisar más registros sin fecha' : 'Consultar pedidos sin fecha'}
        </button>}
      </section>;
    })}
    {model.detailId && <OrderDetail id={model.detailId} order={model.detail} loading={model.detailLoading} error={model.detailError} onClose={model.closeDetail} onRetry={() => { if (model.detailId) void model.openDetail(model.detailId); }} />}
  </div>;
}
