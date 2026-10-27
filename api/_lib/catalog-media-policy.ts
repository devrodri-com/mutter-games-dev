import { createHash, createHmac } from 'node:crypto';
import { CatalogEditError, object, operationId, productId } from './catalog-edit-policy.js';

export type MediaPlan = { operationId: string; productId: string; fileName: string; size: number; mime: string };
export const actorKey = (uid: string): string => createHash('sha256').update(uid).digest('hex');
export const mediaPath = (uid: string, id: string): string => `adminImageOperations/${actorKey(uid)}-${operationId(id)}`;
export function mediaError(message: string, status = 400): never {
  throw new CatalogEditError(status, 'CATALOG_MEDIA_ERROR', message);
}
export function parseMediaPlan(value: unknown): MediaPlan {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'fileName,intent,mime,operationId,productId,size'
    || value.intent !== 'prepare' || typeof value.fileName !== 'string' || value.fileName.length > 255
    || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 5000000
    || !['image/jpeg', 'image/png', 'image/webp'].includes(String(value.mime))) mediaError('Usá una imagen JPG, PNG o WEBP de hasta 5 MB.');
  const id = operationId(value.operationId), extension = value.fileName.split('.').at(-1)?.toLowerCase();
  if (!extension || !['jpg', 'jpeg', 'png', 'webp'].includes(extension)) mediaError('Formato de imagen inválido.');
  const expectedMime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`;
  if (expectedMime !== value.mime) mediaError('El formato y el nombre de la imagen no coinciden.');
  return { operationId: id, productId: productId(value.productId), fileName: `mutter-${id}.${extension}`, size: value.size, mime: expectedMime };
}
export function imageKeys(): { publicKey: string; privateKey: string } {
  const publicKey = process.env.IMAGEKIT_PUBLIC_KEY, privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!publicKey || !privateKey) mediaError('La carga de imágenes no está disponible. No se inició una carga.', 503);
  return { publicKey, privateKey };
}
export function providerBase(): string {
  const override = process.env.MUTTER_DEMO_IMAGEKIT_API;
  if (!override) return 'https://api.imagekit.io';
  const url = new URL(override);
  if (process.env.FIREBASE_PROJECT_ID !== 'demo-mutter-edit'
    || !/^127\.0\.0\.1:8487$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')
    || !/^127\.0\.0\.1:9397$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')
    || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/'
    || url.username || url.password || url.search || url.hash) mediaError('Configuración de imágenes inválida.', 503);
  return url.origin;
}
export function signedImage(plan: MediaPlan, uid: string, expire: number) {
  const { publicKey, privateKey } = imageKeys();
  const fields = { fileName: plan.fileName, folder: `/mutter/admin/${actorKey(uid)}`,
    useUniqueFileName: 'false', overwriteFile: 'false', isPrivateFile: 'false',
    checks: `"file.mime" = "${plan.mime}" AND "file.size" = ${plan.size}` };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: publicKey })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ ...fields, iat: expire - 600, exp: expire })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const token = `${unsigned}.${createHmac('sha256', privateKey).update(unsigned).digest('base64url')}`;
  return { status: 'ISSUED', imageOperationId: plan.operationId, productId: plan.productId, token, fields, expire };
}
export function validateImage(value: unknown, expected: { folder: string; fileName: string; size: number }): { fileId: string; url: string } {
  if (!object(value) || typeof value.fileId !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(value.fileId)
    || value.filePath !== `${expected.folder}/${expected.fileName}` || value.fileType !== 'image'
    || value.size !== expected.size || typeof value.url !== 'string' || value.url.length > 2048) mediaError('La imagen recibida no coincide con la carga.', 409);
  const configured = process.env.IMAGEKIT_URL_ENDPOINT;
  if (!configured) mediaError('No pudimos comprobar la configuración de imágenes.', 503);
  let url: URL, base: URL;
  try { url = new URL(value.url); base = new URL(configured); }
  catch { return mediaError('La dirección de la imagen no es válida.', 409); }
  // ImageKit returns original file URLs with an optional updatedAt timestamp.
  // Admit that exact provider shape, preserving its URL and rejecting transforms.
  const updatedAt = /^\?updatedAt=([1-9][0-9]{0,15})$/.exec(url.search);
  const allowedQuery = !value.url.includes('?') || updatedAt !== null
    && Number.isSafeInteger(Number(updatedAt[1])) && Number(updatedAt[1]) > 0;
  const basePath = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname;
  if (base.protocol !== 'https:' || base.username || base.password || base.search || configured.includes('?')
    || base.hash || configured.includes('#') || !basePath || basePath.includes('//')
    || url.protocol !== 'https:' || url.origin !== base.origin
    || url.pathname !== `${basePath}${expected.folder}/${expected.fileName}`
    || url.href !== value.url || url.username || url.password || value.url.includes('#') || !allowedQuery)
    mediaError('La dirección de la imagen no es válida.', 409);
  return { fileId: value.fileId, url: value.url };
}
export async function providerRead(path: string): Promise<unknown> {
  const { privateKey } = imageKeys();
  const response = await fetch(providerBase() + path, { redirect: 'error', method: 'GET',
    headers: { Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}` }, signal: AbortSignal.timeout(10000) });
  const text = await response.text();
  if (!response.ok || text.length > 65536) mediaError('No pudimos comprobar la carga. No vuelvas a enviar la imagen.', 503);
  try { return JSON.parse(text); } catch { return mediaError('No pudimos comprobar la respuesta de imágenes.', 503); }
}
