import type { CatalogEditRequest } from './catalog-edit.js';
import type { AccessResponse } from './_lib/credential-access-handler.js';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from './_lib/firebase-server.js';
import { authenticateEditor } from './_lib/catalog-edit-authorization.js';
import { CredentialAccessError } from './_lib/credential-access-state.js';
import { CatalogEditError, object } from './_lib/catalog-edit-policy.js';
import { prepareMedia, observeMedia, confirmMedia } from './_lib/catalog-media-service.js';

export default async function handler(req: CatalogEditRequest, res: AccessResponse) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
  let operationStarted = false;
  try {
    const host = req.headers.host, origin = req.headers.origin;
    if (typeof host !== 'string' || !['muttergames.com', 'www.muttergames.com'].includes(host)
      || origin !== undefined && origin !== `https://${host}`) throw new CatalogEditError(403, 'INVALID_ORIGIN', 'Origen no permitido.');
    const url = new URL(req.url ?? '', `https://${host}`);
    if (!req.url?.startsWith('/api/catalog-media') || url.origin !== `https://${host}` || url.hash || url.pathname !== '/api/catalog-media' || !['GET', 'POST'].includes(req.method ?? '')) throw new CatalogEditError(405, 'METHOD_NOT_ALLOWED', 'Operación no permitida.');
    const auth = getAuth(adminApp()), db = getFirestore(adminApp()), editor = await authenticateEditor(auth, db, req.headers.authorization);
    if (req.method === 'GET') {
      if ([...url.searchParams.keys()].sort().join(',') !== 'operationId,productId') throw new CatalogEditError(400, 'INVALID_QUERY', 'Consulta inválida.');
      return res.status(200).json(await observeMedia(auth, db, editor, url.searchParams.get('operationId'), url.searchParams.get('productId')));
    }
    if (url.search) throw new CatalogEditError(400, 'INVALID_QUERY', 'Consulta inválida.');
    const body: unknown = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!object(body) || !['prepare', 'confirm'].includes(String(body.intent))) throw new CatalogEditError(400, 'INVALID_MEDIA_INTENT', 'Operación inválida.');
    operationStarted = true;
    const result = body.intent === 'prepare' ? await prepareMedia(auth, db, editor, body) : await confirmMedia(auth, db, editor, body);
    return res.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof CatalogEditError || error instanceof CredentialAccessError) return res.status(error.status).json({ error: error.message, code: error.code,
      applied: error.status < 500 && !operationStarted ? false : null });
    return res.status(503).json({ code: 'MEDIA_RESULT_UNCERTAIN', error: 'No pudimos comprobar la imagen. No se reenviará automáticamente.', applied: operationStarted ? null : false });
  }
}
