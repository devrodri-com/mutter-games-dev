import { auth } from '../firebase';
import { parseAdminOrderDetail, parseAdminOrderPage, type AdminOrderCursor, type AdminOrderDetail, type AdminOrderPage, type AdminOrderSection } from '../domain/adminOrders';

async function request(body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Iniciá sesión con una cuenta administradora para consultar pedidos.');
  const token = await user.getIdToken();
  if (auth.currentUser?.uid !== user.uid) throw new Error('Cambió la sesión. Volvé a consultar los pedidos.');
  const response = await fetch('/api/create-mp-preference', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal });
  const data: unknown = await response.json();
  if (auth.currentUser?.uid !== user.uid) throw new Error('Cambió la sesión. Volvé a consultar los pedidos.');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('La respuesta de pedidos es inválida.');
  const result = data as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'No pudimos leer los pedidos. Reintentá la consulta.');
  return result;
}
export async function readAdminOrders(section: AdminOrderSection, cursor?: AdminOrderCursor, signal?: AbortSignal): Promise<AdminOrderPage> {
  return parseAdminOrderPage(await request({ action: 'admin_orders', section, limit: 20, ...(cursor ? { cursor } : {}) }, signal));
}
export async function readAdminOrder(orderId: string, signal?: AbortSignal): Promise<AdminOrderDetail> {
  const result = await request({ action: 'admin_order', orderId }, signal);
  return parseAdminOrderDetail(result.order);
}
