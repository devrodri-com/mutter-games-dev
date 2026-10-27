import { createHash } from 'node:crypto';
import { catalogCreateHashPayload, canonicalJson } from './catalog-edit-fields.js';
import { normalizeCatalogCreate } from './catalog-edit-create.js';
import { imageOperations, invalid, object, operationId } from './catalog-edit-policy.js';

export type CreateRequest = { intent: 'create'; operationId: string; product: Record<string, unknown>; imageOperationIds?: string[] };
export function parseCreateRequest(value: unknown): CreateRequest {
  const body: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!object(body) || body.intent !== 'create' || !object(body.product)
    || Object.keys(body).some(key => !['intent', 'operationId', 'product', 'imageOperationIds'].includes(key))) invalid();
  const id = operationId(body.operationId);
  try { normalizeCatalogCreate(body.product, id); }
  catch (error: unknown) { invalid(error instanceof Error ? error.message : 'Publicación inválida.'); }
  return { intent: 'create', operationId: id, product: structuredClone(body.product),
    ...(body.imageOperationIds === undefined ? {} : { imageOperationIds: imageOperations(body.imageOperationIds) }) };
}
export function creationProductId(request: CreateRequest): string { return `admin-${request.operationId}`; }
export function createRequestHash(id: string, request: CreateRequest): string {
  return createHash('sha256').update(canonicalJson(catalogCreateHashPayload(id, request))).digest('hex');
}
