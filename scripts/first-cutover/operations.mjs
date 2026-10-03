import { DATABASE, demand } from './common.mjs';

export const OPERATIONS_FIELDS = 'operations(name,done,error/code,metadata(@type,startTime,endTime,operationState)),nextPageToken,unreachable';
/** Official REST ListOperations, with origin-side projection. Inject an existing
 * authorized read channel; this module never obtains credentials or scopes.
 */
export async function readOperations(request) {
  const operations = []; const seen = new Set(); let token; let pages = 0;
  do {
    const query = new URLSearchParams({ pageSize: '100', fields: OPERATIONS_FIELDS });
    if (token) query.set('pageToken', token);
    const page = await request(`${DATABASE}/operations?${query}`); pages++;
    demand(Object.keys(page).every(k => ['operations', 'nextPageToken', 'unreachable'].includes(k)), 'unexpected operations payload');
    demand(Array.isArray(page.unreachable ?? []) && (page.unreachable ?? []).length === 0, 'unreachable administrative scope');
    demand(Array.isArray(page.operations ?? []), 'invalid operations page');
    for (const op of page.operations ?? []) {
      demand(typeof op.name === 'string' && op.name.startsWith(`${DATABASE}/operations/`)
        && Object.keys(op).every(k => ['name', 'done', 'error', 'metadata'].includes(k)), 'invalid operation projection');
      demand(!operations.some(o => o.name === op.name), 'duplicate operation');
      demand(!op.error || Object.keys(op.error).every(k => k === 'code') && Number.isInteger(op.error.code), 'unexpected error payload');
      demand(!op.metadata || Object.keys(op.metadata).every(k => ['@type', 'startTime', 'endTime', 'operationState'].includes(k)), 'unexpected metadata payload');
      operations.push(op);
    }
    token = page.nextPageToken;
    demand(!token || typeof token === 'string' && !seen.has(token), 'operations pagination loop');
    if (token) seen.add(token);
  } while (token);
  return { status: 'LIST_EXHAUSTED_NOT_CUTOVER_VERIFIED', resource: `${DATABASE}/operations`, pages, operations,
    nextPageToken: null, unreachable: [], active: operations.filter(o => o.done !== true).length,
    terminalErrorsRequiringTreatment: operations.filter(o => o.done === true && o.error?.code).length,
    commitWriteCoverage: false, historicalRetention: 'NOT_ESTABLISHED_BY_LIST_RESPONSE' };
}
