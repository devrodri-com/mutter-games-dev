import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from './_lib/firebase-server.js';
import type { AccessResponse } from './_lib/credential-access-handler.js';
import { CredentialAccessError } from './_lib/credential-access-state.js';
import { authenticateEditor, revalidateEditor } from './_lib/catalog-edit-authorization.js';
import { CatalogEditError, invalid, operationId, parseEditRequest, productId } from './_lib/catalog-edit-policy.js';
import { readEditProduct, readEditReceipt, saveEdit } from './_lib/catalog-edit-service.js';
import { parseCreateRequest } from './_lib/catalog-edit-create-policy.js';
import { createPublication } from './_lib/catalog-edit-create-service.js';

export type CatalogEditRequest = { url?: string; method?: string; headers: Record<string, unknown>; body?: unknown };
function target(req: CatalogEditRequest) {
  const host = req.headers.host, origin = req.headers.origin;
  if (host !== 'muttergames.com' && host !== 'www.muttergames.com') invalid('Destino inválido.');
  if (origin !== undefined && origin !== `https://${host}`) throw new CatalogEditError(403, 'FOREIGN_ORIGIN', 'Origen inválido.');
  if (!req.url?.startsWith('/api/catalog-edit?')) invalid('Ruta inválida.');
  const url = new URL(req.url, `https://${host}`);
  if (url.pathname !== '/api/catalog-edit' || url.hash || [...url.searchParams.keys()].some(key => !['id', 'operationId'].includes(key))
    || url.searchParams.getAll('id').length !== 1 || url.searchParams.getAll('operationId').length > 1) invalid('Consulta inválida.');
  const id = productId(url.searchParams.get('id')), rawOperation = url.searchParams.get('operationId');
  if (req.method !== 'GET' && rawOperation !== null) invalid('Consulta inválida.');
  return { id, operation: rawOperation === null ? null : operationId(rawOperation) };
}
export default async function handler(req: CatalogEditRequest, res: AccessResponse): Promise<unknown> {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.', applied: false });
  let commitStarted = false;
  try {
    const selected = target(req), app = adminApp(), auth = getAuth(app), db = getFirestore(app);
    const editor = await authenticateEditor(auth, db, req.headers.authorization);
    if (req.method === 'GET') {
      await revalidateEditor(auth, db, editor);
      return res.status(200).json(selected.operation ? await readEditReceipt(db, editor, selected.id, selected.operation)
        : await readEditProduct(db, selected.id));
    }
    if (req.method === 'POST') {
      const request = parseCreateRequest(req.body);
      commitStarted = true;
      return res.status(201).json(await createPublication(auth, db, editor, selected.id, request));
    }
    const request = parseEditRequest(req.body);
    commitStarted = true;
    return res.status(200).json(await saveEdit(auth, db, editor, selected.id, request));
  } catch (error: unknown) {
    if (error instanceof CatalogEditError || error instanceof CredentialAccessError) {
      // These errors below 500 are raised before any commit or on the original
      // read-only receipt. Unknown provider/transport errors are never "not applied".
      return res.status(error.status).json({ code: error.code, error: error.message,
        applied: error.status < 500 ? false : commitStarted ? null : false });
    }
    if (error instanceof SyntaxError && !commitStarted) return res.status(400).json({ code: 'INVALID_CATALOG_EDIT', error: 'Datos inválidos.', applied: false });
    return res.status(503).json({ code: 'EDIT_RESULT_UNCERTAIN', error: 'No pudimos confirmar el guardado. Consultá su estado sin volver a enviarlo.', applied: commitStarted ? null : false });
  }
}
