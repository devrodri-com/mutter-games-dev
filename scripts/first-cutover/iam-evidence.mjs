import { PROJECT, demand, digest, canonical } from './common.mjs';

export const PROJECT_RESOURCE = `projects/${PROJECT}`;
export const PROJECT_NUMBER = '26777776532';
export const OPERATOR = 'gamesmutter@gmail.com';
export const accountResource = email => `${PROJECT_RESOURCE}/serviceAccounts/${email}`;
export const same = (a, b) => canonical(a) === canonical(b);
export const instant = n => Number.isSafeInteger(n) && n >= 0;

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
  demand(request.method === expected.method && request.resource === expected.resource, 'source method/resource mismatch');
  demand(source.httpStatus === (expected.httpStatus ?? 200) && source.responseComplete === true
    && !Object.hasOwn(request, 'fields') && !request.query?.fields && !request.body?.fields
    && !request.query?.readMask && !request.body?.readMask && !request.query?.filter
    && source.projection === 'NONE', 'partial/failed source cannot establish absence');
  demand(!response.error || expected.httpStatus, 'error response cannot establish absence');
  return { request, response };
}

export function readPolicy(source, resource, context) {
  const { request, response } = readSource(source, { method: 'getIamPolicy', resource }, context);
  const account = resource.includes('/serviceAccounts/');
  demand(account ? request.query?.['options.requestedPolicyVersion'] === 3 && Object.keys(request.body ?? {}).length === 0
    : request.body?.options?.requestedPolicyVersion === 3, 'conditions must be requested with version 3 at the native location');
  validateWirePolicy(response, { requestedPolicyVersion: 3, responseComplete: true });
  return response;
}

export function validateWirePolicy(policy, readContext) {
  demand([1, 3].includes(policy?.version) && typeof policy.etag === 'string' && policy.etag.length > 0
    && Array.isArray(policy.bindings), 'versioned IAM source required');
  for (const b of policy.bindings) {
    demand(typeof b.role === 'string' && b.role.length > 0 && Array.isArray(b.members)
      && b.members.every(m => typeof m === 'string' && m.length > 0), 'invalid IAM binding');
    demand(!b.role.includes('_withcond_'), 'opaque condition role');
    if (b.condition) demand(policy.version === 3 && typeof b.condition.expression === 'string', 'condition representation incomplete');
  }
  if (policy.version === 1) demand(readContext?.requestedPolicyVersion === 3
    && readContext.responseComplete === true && policy.bindings.every(b => !Object.hasOwn(b, 'condition')), 'v1 requires complete v3 request evidence');
  return policy; // Do not change Google wire version or drop foreign fields.
}

export function sortedBindings(policy) {
  // IAM bindings/members are sets; compare every other field, including conditions,
  // auditConfigs and version. Only etag and semantically unordered bindings differ.
  const result = structuredClone(policy); delete result.etag;
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
