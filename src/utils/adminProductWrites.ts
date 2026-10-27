import { auth } from '../firebase';
import { imageOperationIds } from './imagekitUtils';

type Result = { id: string; created?: boolean; updated?: boolean; slug?: string };
type Pending = { schema: 1; operationId: string; path: string; method: 'POST' | 'PATCH'; body: string };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function result(value: unknown): Result {
  if (!record(value) || typeof value.id !== 'string') throw new Error('La confirmación del guardado está incompleta.');
  return { id: value.id, ...(value.created === true ? { created: true } : {}), ...(value.updated === true ? { updated: true } : {}), ...(typeof value.slug === 'string' ? { slug: value.slug } : {}) };
}
async function request(path: string, method = 'GET', body?: string): Promise<{ status: number; value: unknown }> {
  const user = auth.currentUser, base = import.meta.env.VITE_ADMIN_API_URL;
  if (!user || !base) throw new Error('Volvé a iniciar sesión para comprobar la operación.');
  const response = await fetch(base + path, { method, redirect: 'error', headers: { Authorization: `Bearer ${await user.getIdToken()}`,
    ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body } : {}) });
  let value: unknown;
  try { value = await response.json(); } catch { throw new Error('Respuesta incompleta. No vuelvas a guardar hasta comprobar la operación.'); }
  return { status: response.status, value };
}
export async function writeAdminProduct(path: string, method: 'POST' | 'PATCH', payload: Record<string, unknown>): Promise<Result> {
  const user = auth.currentUser;
  if (!user) throw new Error('Volvé a iniciar sesión.');
  const images = method === 'POST' ? payload.images : record(payload.changes) ? payload.changes.images : undefined;
  const body = JSON.stringify({ ...payload, imageOperationIds: imageOperationIds(Array.isArray(images) ? images : []) });
  const key = `mutter-admin-product-write:${user.uid}:${path}`;
  const raw = localStorage.getItem(key);
  if (raw) {
    let previous: unknown;
    try { previous = JSON.parse(raw); } catch { throw new Error('Hay una operación local que necesita revisión. No se volvió a guardar.'); }
    if (!record(previous) || previous.schema !== 1 || typeof previous.operationId !== 'string' || previous.path !== path
      || previous.method !== method || previous.body !== body) throw new Error('Hay un guardado anterior sin resolver. Conservá estos cambios y comprobá la operación anterior antes de guardar otros.');
    const receipt = await request(`/api/admin/products?operationId=${encodeURIComponent(previous.operationId)}`);
    if (receipt.status !== 200 || !record(receipt.value) || receipt.value.status !== 'CONFIRMED') throw new Error('El guardado anterior todavía no está confirmado. No se envió otro.');
    const confirmed = result(receipt.value.result); localStorage.removeItem(key); return confirmed;
  }
  const pending: Pending = { schema: 1, operationId: crypto.randomUUID(), path, method, body };
  // A durable local intention precedes the one send. Losing a response never
  // turns the next click or a reload into another write.
  localStorage.setItem(key, JSON.stringify(pending));
  try {
    const sent = await request(path, method, JSON.stringify({ ...JSON.parse(body), operationId: pending.operationId }));
    if (sent.status < 200 || sent.status >= 300) {
      if (record(sent.value) && sent.value.applied === false) {
        localStorage.removeItem(key);
        throw new Error(typeof sent.value.error === 'string' ? sent.value.error : 'No se aplicó el cambio.');
      }
      throw new Error('No pudimos confirmar el guardado. Volvé a consultar su estado, sin repetirlo.');
    }
    const confirmed = result(sent.value); localStorage.removeItem(key); return confirmed;
  } catch (error: unknown) {
    if (localStorage.getItem(key)) throw new Error('El guardado quedó pendiente de confirmación. Un nuevo clic sólo consultará su estado; no enviará otro guardado.');
    throw error;
  }
}
