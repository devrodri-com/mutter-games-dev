import { PROJECT, demand, digest, canonical } from './common.mjs';

export const PROJECT_RESOURCE = `projects/${PROJECT}`;
export const PROJECT_NUMBER = '26777776532';
export const OPERATOR = 'gamesmutter@gmail.com';
export const accountResource = email => `${PROJECT_RESOURCE}/serviceAccounts/${email}`;
export const same = (a, b) => canonical(a) === canonical(b);
export const instant = n => Number.isSafeInteger(n) && n >= 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A local transport envelope retains original JSON bytes and hashes. This proves
 * consistency only: channel identity/completeness require primary-source review.
 * No token, cookie, private key, request headers or business response belongs here.
 */
export function readSource(source, expected, context) {
  demand(source?.schema === 1 && ['SYNTHETIC', 'GOOGLE_OFFICIAL_CAPTURE', 'GOOGLE_PUBLIC_CAPTURE'].includes(source.origin), 'source provenance missing');
  demand(context.synthetic === true ? source.origin === 'SYNTHETIC' : source.origin === (expected.public ? 'GOOGLE_PUBLIC_CAPTURE' : 'GOOGLE_OFFICIAL_CAPTURE'), 'synthetic/remote source mismatch');
  demand(source.revision === context.revision && source.windowSha256 === digest(context.window), 'source window/revision mismatch');
  demand(instant(source.observedAtMs) && source.observedAtMs >= context.window.confirmedAtMs
    && source.observedAtMs < context.window.expiresAtMs && source.observedAtMs <= context.nowMs
    && context.nowMs - source.observedAtMs <= context.maxAgeMs, 'source stale/outside window');
  demand(source.channel?.principal === (expected.public ? null : expected.principal ?? OPERATOR)
    && source.channel.kind === (expected.public ? 'OFFICIAL_PUBLIC_REFERENCE' : 'OFFICIAL_AUTHENTICATED_API') && typeof source.channel.captureId === 'string'
    && source.channel.captureId.length > 0, 'source principal/channel mismatch');
  demand(typeof source.requestRaw === 'string' && typeof source.responseRaw === 'string'
    && digest(source.requestRaw) === source.requestSha256 && digest(source.responseRaw) === source.responseSha256, 'source raw integrity');
  const request = JSON.parse(source.requestRaw), response = JSON.parse(source.responseRaw);
  demand(record(request) && record(response), 'source JSON objects required');
  demand(request.method === expected.method && request.resource === expected.resource, 'source method/resource mismatch');
  demand(source.httpStatus === (expected.httpStatus ?? 200) && source.responseComplete === true
    && ['query', 'body'].every(field => !Object.hasOwn(request, field) || record(request[field]))
    && [request, request.query ?? {}, request.body ?? {}].every(part => record(part)
      && ['fields', 'readMask', 'filter'].every(field => !Object.hasOwn(part, field)))
    && source.projection === 'NONE', 'partial/failed source cannot establish absence');
  demand(!response.error || expected.httpStatus, 'error response cannot establish absence');
  return { request, response };
}

export function readPolicy(source, resource, context) {
  const { request, response } = readSource(source, { method: 'getIamPolicy', resource }, context);
  const account = resource.includes('/serviceAccounts/');
  demand(account ? request.query?.['options.requestedPolicyVersion'] === 3 && Object.keys(request.body ?? {}).length === 0
    : request.body?.options?.requestedPolicyVersion === 3, 'conditions must be requested with version 3 at the native location');
  if (source.origin === 'GOOGLE_OFFICIAL_CAPTURE' && (account || resource === PROJECT_RESOURCE)) {
    const transport = source.transport;
    const url = new URL(transport?.url);
    demand(transport.httpMethod === 'POST' && url.origin === (account ? 'https://iam.googleapis.com' : 'https://cloudresourcemanager.googleapis.com')
      && decodeURIComponent(url.pathname) === `/v1/${resource}:getIamPolicy` && !url.username && !url.password && !url.hash,
    'IAM native API/resource mismatch');
    demand(same([...url.searchParams].sort(), Object.entries(request.query ?? {}).map(([k, v]) => [k, String(v)]).sort()),
      'IAM transport query differs from captured request');
    demand(account ? transport.requestBodyRaw === '' : same(JSON.parse(transport.requestBodyRaw), request.body),
      'IAM transport body differs from captured request');
  }
  validateWirePolicy(response, { requestedPolicyVersion: 3, responseComplete: true });
  return response;
}

export function validateWirePolicy(policy, readContext) {
  demand(record(policy) && (!Object.hasOwn(policy, 'version') || [0, 1, 3].includes(policy.version))
    && typeof policy.etag === 'string' && policy.etag.trim().length > 0, 'versioned IAM source required');
  demand(!Object.hasOwn(policy, 'bindings') || Array.isArray(policy.bindings), 'invalid IAM bindings');
  demand(!Object.hasOwn(policy, 'auditConfigs') || Array.isArray(policy.auditConfigs), 'invalid IAM auditConfigs');
  const bindings = Object.hasOwn(policy, 'bindings') ? policy.bindings : [];
  for (const b of bindings) {
    demand(record(b) && typeof b.role === 'string' && b.role.length > 0 && Array.isArray(b.members) && b.members.length > 0
      && b.members.every(m => typeof m === 'string' && m.length > 0), 'invalid IAM binding');
    demand(!b.role.includes('_withcond_'), 'opaque condition role');
    if (Object.hasOwn(b, 'condition')) demand(policy.version === 3 && record(b.condition)
      && typeof b.condition.expression === 'string' && b.condition.expression.trim().length > 0, 'condition representation incomplete');
  }
  // Google Policy permits 0/1/3 or an omitted version without conditions. Missing
  // repeated fields represent an empty list, not a failed or partial API read.
  if (policy.version !== 3 || !Object.hasOwn(policy, 'bindings')) demand(readContext?.requestedPolicyVersion === 3
    && readContext.responseComplete === true && (policy.version === 3 || bindings.every(b => !Object.hasOwn(b, 'condition'))),
  'v1/0/omitted fields require complete v3 request evidence');
  return policy; // Do not change Google wire version or drop foreign fields.
}

/** Explicit derived view only. Never use it as the raw response or its digest.
 * Keep version, etag, conditions, auditConfigs and unknown fields byte-equivalent
 * after parsing. Only an absent bindings field receives a semantic empty list.
 */
export function policyView(policy, readContext) {
  validateWirePolicy(policy, readContext);
  const view = structuredClone(policy);
  if (!Object.hasOwn(view, 'bindings')) view.bindings = [];
  return view;
}

export function sortedBindings(policy, readContext) {
  // IAM bindings/members are sets; compare every other field, including conditions,
  // auditConfigs and version. Only etag and semantically unordered bindings differ.
  const result = policyView(policy, readContext); delete result.etag;
  result.bindings = result.bindings.map(b => ({ ...b, members: [...b.members].sort() }))
    .sort((a, b) => canonical(a).localeCompare(canonical(b)));
  return result;
}

export function requireReview(review, sources, context, categories) {
  demand(review?.status === 'REVIEWED_EXACT_SOURCES' && review.revision === context.revision
    && review.windowSha256 === digest(context.window) && typeof review.reviewer === 'string' && review.reviewer.length > 0
    && Array.isArray(review.unresolved) && review.unresolved.length === 0, 'authority review missing/unresolved');
  const hashes = sources.map(digest).sort();
  demand(same([...new Set(review.sourceSha256 ?? [])].sort(), [...new Set(hashes)].sort()), 'review not bound to complete source set');
  demand(Array.isArray(review.coverage) && same(review.coverage.map(r => r.category).sort(), [...categories].sort()), 'authority review coverage incomplete');
  for (const entry of review.coverage) demand(entry.disposition === 'NO_UNRESOLVED_ROUTE'
    && typeof entry.reason === 'string' && entry.reason.length >= 30 && Array.isArray(entry.sourceSha256)
    && entry.sourceSha256.length > 0 && entry.sourceSha256.every(h => hashes.includes(h)), 'unexplained authority route');
}
