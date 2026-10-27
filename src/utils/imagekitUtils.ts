import { auth } from '../firebase';
import { adminApiFetch } from './adminApi';

type PendingImage = { operationId: string; phase: 'PLANNED' | 'UPLOAD_STARTED' | 'UPLOADED'; fileId?: string };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function receiptKey(): string {
  if (!auth.currentUser) throw new Error('Volvé a iniciar sesión para subir la imagen.');
  return `mutter-admin-image-receipts:${auth.currentUser.uid}`;
}
function receipts(): Record<string, string> {
  const raw = localStorage.getItem(receiptKey());
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!record(value) || Object.values(value).some(v => typeof v !== 'string')) throw new Error('Los recibos de imagen necesitan revisión.');
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}
export function imageOperationIds(urls: unknown[]): string[] {
  const saved = receipts();
  return urls.filter((url): url is string => typeof url === 'string').map(url => saved[url]).filter((id): id is string => typeof id === 'string');
}
function uploadEndpoint(): string {
  const endpoint = import.meta.env.VITE_DEMO_IMAGEKIT_UPLOAD_ENDPOINT;
  if (!endpoint) return 'https://upload.imagekit.io/api/v2/files/upload';
  const url = new URL(endpoint);
  if (import.meta.env.VITE_FIREBASE_PROJECT_ID !== 'demo-mutter-r1' || import.meta.env.VITE_USE_FIREBASE_EMULATORS !== 'true'
    || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/api/v2/files/upload') throw new Error('El destino de prueba de imágenes no está permitido.');
  return url.href;
}
export async function uploadImageToImageKit(file: File): Promise<string> {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size < 1 || file.size > 5000000) throw new Error('Usá PNG, JPG o WEBP de hasta 5 MB.');
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Volvé a iniciar sesión para subir la imagen.');
  const key = `mutter-admin-image-pending:${uid}:${file.name}:${file.size}:${file.lastModified}`;
  const raw = localStorage.getItem(key);
  let pending: PendingImage;
  if (raw) {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || typeof value.operationId !== 'string' || !['PLANNED','UPLOAD_STARTED','UPLOADED'].includes(String(value.phase))
      || value.fileId !== undefined && typeof value.fileId !== 'string') throw new Error('La carga anterior necesita revisión.');
    pending = { operationId: value.operationId, phase: value.phase === 'PLANNED' ? 'PLANNED' : value.phase === 'UPLOADED' ? 'UPLOADED' : 'UPLOAD_STARTED',
      ...(typeof value.fileId === 'string' ? { fileId: value.fileId } : {}) };
  } else { pending = { operationId: crypto.randomUUID(), phase: 'PLANNED' }; localStorage.setItem(key, JSON.stringify(pending)); }
  if (pending.phase === 'UPLOAD_STARTED') throw new Error('La carga anterior quedó sin confirmar. No se vuelve a subir automáticamente.');
  if (pending.phase === 'PLANNED') {
    const params: unknown = await adminApiFetch(`/api/imagekit-signature?operationId=${pending.operationId}&fileName=${encodeURIComponent(file.name)}`);
    if (!record(params)) throw new Error('Respuesta de imagen incompleta.');
    if (params.status === 'CONFIRMED' && typeof params.url === 'string') {
      localStorage.setItem(receiptKey(), JSON.stringify({ ...receipts(), [params.url]: pending.operationId })); localStorage.removeItem(key); return params.url;
    }
    if (params.uploadApi !== 'IMAGEKIT_V2_PAYLOAD' || typeof params.token !== 'string' || !record(params.fields)
      || Object.keys(params.fields).some(key => !['fileName','folder','useUniqueFileName','overwriteFile','isPrivateFile','checks'].includes(key))
      || Object.values(params.fields).some(value => typeof value !== 'string') || params.fields.useUniqueFileName !== 'false'
      || params.fields.overwriteFile !== 'false') throw new Error('Firma de imagen incompleta.');
    const multipart = new FormData(); multipart.append('file', file);
    for (const [name, value] of Object.entries(params.fields)) { if (typeof value !== 'string') throw new Error('Campo de carga inválido.'); multipart.append(name, value); }
    multipart.append('token', params.token);
    pending.phase = 'UPLOAD_STARTED'; localStorage.setItem(key, JSON.stringify(pending));
    const response = await fetch(uploadEndpoint(), { method: 'POST', body: multipart, redirect: 'error' });
    if (!response.ok) throw new Error('La carga quedó sin confirmar. No la repitas.');
    const uploaded: unknown = await response.json();
    if (!record(uploaded)) throw new Error('La carga quedó sin confirmación. No la repitas.');
    if (typeof uploaded.fileId !== 'string') throw new Error('La carga quedó sin confirmación. No la repitas.');
    pending = { ...pending, phase: 'UPLOADED', fileId: uploaded.fileId }; localStorage.setItem(key, JSON.stringify(pending));
  }
  const confirmed: unknown = await adminApiFetch('/api/imagekit-signature', { method: 'POST', body: JSON.stringify({ operationId: pending.operationId, fileId: pending.fileId }) });
  if (!record(confirmed) || typeof confirmed.url !== 'string' || confirmed.imageOperationId !== pending.operationId) throw new Error('La imagen sigue pendiente de confirmación.');
  localStorage.setItem(receiptKey(), JSON.stringify({ ...receipts(), [confirmed.url]: pending.operationId }));
  localStorage.removeItem(key); return confirmed.url;
}
