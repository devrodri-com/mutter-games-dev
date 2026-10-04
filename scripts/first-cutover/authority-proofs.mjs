import { DATABASE, PLANNED_ACCOUNT, LEGACY_ACCOUNTS, demand, digest } from './common.mjs';
import { readSource, same, instant, PROJECT_RESOURCE, accountResource, OPERATOR } from './iam-evidence.mjs';

// Explicit IAM permission names, not a prefix conversion from deny permissions.
// Resource support must be captured and reviewed for each actual evaluation.
export const PROJECT_WRITE_PERMISSIONS = Object.freeze([
  'datastore.entities.create', 'datastore.entities.update', 'datastore.entities.delete',
  'firebaseauth.users.create', 'firebaseauth.users.update', 'firebaseauth.users.delete',
  'resourcemanager.projects.setIamPolicy', 'iam.serviceAccounts.create',
  'iam.roles.create', 'iam.roles.update', 'iam.roles.undelete',
]);
export const ACCOUNT_ESCAPE_PERMISSIONS = Object.freeze([
  'iam.serviceAccounts.getAccessToken', 'iam.serviceAccounts.getOpenIdToken',
  'iam.serviceAccounts.signBlob', 'iam.serviceAccounts.signJwt', 'iam.serviceAccounts.implicitDelegation',
  'iam.serviceAccounts.actAs', 'iam.serviceAccountKeys.create', 'iam.serviceAccounts.setIamPolicy',
]);

function testPermissions(source, principal, resource, required, granted, context) {
  const { request, response } = readSource(source, { method: 'testIamPermissions', principal, resource }, context);
  demand(same(request.body?.permissions, required) && same(response.permissions ?? [], granted), 'permission evaluation mismatch/grant remains');
}

/** Evidence validation only. No Google client or remote probe is executed here. */
export function verifyNegativeProofs(proofs, accounts, afterAt, context) {
  demand(Array.isArray(proofs) && proofs.length === LEGACY_ACCOUNTS.length, 'both legacy negative proofs required');
  const sources = []; let effectiveAt = afterAt;
  for (const principal of LEGACY_ACCOUNTS) {
    const proof = proofs.find(p => p.principal === principal);
    demand(proof, 'legacy proof principal missing');
    const authentication = readSource(proof.authentication, { method: 'databases.get', resource: DATABASE, principal }, context).response;
    demand(authentication.name === DATABASE && typeof authentication.uid === 'string'
      && Number.isFinite(Date.parse(authentication.createTime)) && Date.parse(authentication.createTime) > 0, 'legacy authentication/database-creation control missing');
    demand(proof.credential?.representedPrincipal === principal && typeof proof.credential.opaqueRef === 'string'
      && proof.credential.opaqueRef.length > 0 && same(proof.credential.oauthScopes, ['https://www.googleapis.com/auth/cloud-platform'])
      && proof.credential.authenticationSourceSha256 === digest(proof.authentication), 'probe credential identity/scope not bound');
    const sameCredential = capture => demand(capture.channel.credentialRef === proof.credential.opaqueRef,
      'negative/authentication/evaluation must use the same reviewed credential');
    sameCredential(proof.authentication); sameCredential(proof.update.negative);
    sources.push(proof.authentication);
    demand(proof.update?.representedPrincipal === principal && proof.update.positivePrincipal === OPERATOR, 'update represented principal mismatch');
    const { request: negative, response: denied } = readSource(proof.update.negative,
      { method: 'commit', resource: DATABASE, principal, httpStatus: 403 }, context);
    const { request: positive, response: precondition } = readSource(proof.update.positive,
      { method: 'commit', resource: DATABASE, principal: OPERATOR, httpStatus: 400 }, context);
    // Some transports expose HTTP 400 for FAILED_PRECONDITION. The gRPC status is
    // mandatory as well; no generic HTTP/network failure is proof of containment.
    demand(same(negative, positive) && denied.error?.status === 'PERMISSION_DENIED'
      && precondition.error?.status === 'FAILED_PRECONDITION', 'update is not a matched denial/precondition control');
    const writes = negative.body?.writes;
    demand(Array.isArray(writes) && writes.length === 1 && writes[0].update?.name?.startsWith(`${DATABASE}/documents/`)
      && !writes[0].delete && !writes[0].transform && !writes[0].update?.fields
      && same(writes[0].updateMask, { fieldPaths: [] }) && same(writes[0].currentDocument, { updateTime: '1970-01-01T00:00:00Z' }), 'only reviewed impossible-precondition update shape is supported');
    demand(proof.update.preconditionReview?.status === 'REVIEWED_IMPOSSIBLE_FOR_THIS_RESOURCE'
      && proof.update.preconditionReview.requestSha256 === proof.update.negative.requestSha256
      && proof.update.preconditionReview.databaseMetadataSha256 === digest(proof.authentication)
      && typeof proof.update.preconditionReview.reason === 'string' && proof.update.preconditionReview.reason.length >= 30, 'impossible precondition requires resource-specific review');
    sources.push(proof.update.negative, proof.update.positive);
    const expected = [[PROJECT_RESOURCE, PROJECT_WRITE_PERMISSIONS], ...accounts.map(a => [accountResource(a), ACCOUNT_ESCAPE_PERMISSIONS])];
    demand(Array.isArray(proof.evaluations) && proof.evaluations.length === expected.length, 'native permission coverage incomplete');
    for (const [resource, permissions] of expected) {
      const row = proof.evaluations.find(e => e.resource === resource);
      demand(row && typeof row.limitations === 'string' && row.limitations.length >= 30, 'native evaluation limitations missing');
      const fullResourceName = `//${resource === PROJECT_RESOURCE ? 'cloudresourcemanager' : 'iam'}.googleapis.com/${resource}`;
      demand(row.fullResourceName === fullResourceName && Array.isArray(row.support) && row.support.length > 0, 'permission/resource support missing');
      const supported = new Set(), seen = new Set(); let token = '';
      for (const [index, capture] of row.support.entries()) {
        const { request, response } = readSource(capture, { method: 'queryTestablePermissions', resource, principal: OPERATOR }, context);
        demand(request.body?.fullResourceName === fullResourceName && (request.body.pageToken ?? '') === token
          && Array.isArray(response.permissions), 'permission support pagination/source mismatch');
        for (const permission of response.permissions) {
          demand(typeof permission.name === 'string' && !supported.has(permission.name), 'permission support duplicate/unknown');
          supported.add(permission.name);
        }
        token = response.nextPageToken ?? '';
        demand(typeof token === 'string' && (!token || !seen.has(token)), 'permission support pagination cycle'); seen.add(token);
        demand(index === row.support.length - 1 ? !token : !!token, 'permission support not exhausted');
      }
      demand(permissions.every(p => supported.has(p)), 'permission/resource support unverified');
      sameCredential(row.denied);
      testPermissions(row.denied, principal, resource, [...permissions], [], context);
      demand(row.review?.status === 'REVIEWED_RESOURCE_AND_TEST_SEMANTICS'
        && same(row.review.sourceSha256, [...row.support.map(digest), digest(row.denied)])
        && row.review.unresolved === 0, 'unsupported or unreviewed native permission evaluation');
      sources.push(...row.support, row.denied);
    }
  }
  for (const source of sources) {
    demand(source.observedAtMs > afterAt, 'effectiveness proof predates allow readback');
    effectiveAt = Math.max(effectiveAt, source.observedAtMs);
  }
  return { sources, effectiveAt };
}

/** No finite key inventory proves absence of copied keys or foreign tokens. The
 * reviewer must close each credential family against bounded primary evidence.
 * Unknown issuance/validity remains PENDING, outside the accepted late-write risk.
 */
export function verifyCredentials(value, sourceHashes, effectiveAt, context) {
  const families = ['LEGACY_KEYS_AND_REPRESENTING_TOKENS', 'FOREIGN_ACCESS_TOKENS', 'SIGNED_JWT_AND_BLOB', 'OIDC_TOKENS', 'FIREBASE_SESSIONS'];
  demand(value?.status === 'REVIEWED_NO_UNRESOLVED_ROUTE' && value.noIntrusionOrIssuanceInferred === true
    && value.keyDeletionRevokesIssuedTokens === false && value.tokenCreatorRemovalRevokesIssuedTokens === false
    && value.unresolved === 0 && Array.isArray(value.families)
    && same(value.families.map(f => f.family).sort(), [...families].sort()), 'preexisting credential treatment incomplete');
  for (const family of value.families) {
    demand(['DESTINATION_AUTHORITY_CONTAINED', 'BOUNDED_VALIDITY_AND_ISSUANCE_CLOSED', 'NO_RELEVANT_AUTHORITY_WITH_EVIDENCE'].includes(family.disposition)
      && Array.isArray(family.representedPrincipals) && family.representedPrincipals.length > 0
      && typeof family.scope === 'string' && family.scope.length > 0
      && typeof family.validityBasis === 'string' && family.validityBasis.length >= 30
      && typeof family.reason === 'string' && family.reason.length >= 30
      && Array.isArray(family.sourceSha256) && family.sourceSha256.length > 0
      && family.sourceSha256.every(h => sourceHashes.includes(h)), 'credential route unresolved or unsupported');
    demand(instant(family.reviewedAtMs) && family.reviewedAtMs >= effectiveAt && family.reviewedAtMs <= context.nowMs, 'credential review chronology');
    if (family.disposition === 'BOUNDED_VALIDITY_AND_ISSUANCE_CLOSED') demand(
      instant(family.lastPossibleIssueAtMs) && instant(family.validUntilMs)
      && family.lastPossibleIssueAtMs <= family.validUntilMs && family.validUntilMs <= family.reviewedAtMs
      && typeof family.issuanceClosureBasis === 'string' && family.issuanceClosureBasis.length >= 30
      && family.familySpecificValidity === true, 'elapsed time/universal access-token TTL is insufficient');
    if (family.family === 'LEGACY_KEYS_AND_REPRESENTING_TOKENS') demand(
      family.disposition === 'DESTINATION_AUTHORITY_CONTAINED' && same([...family.representedPrincipals].sort(), [...LEGACY_ACCOUNTS].sort()), 'legacy keys rely on destination authority, not deletion');
    // The candidate must never be hidden among unidentified/untreated destinations.
    if (family.representedPrincipals.includes(PLANNED_ACCOUNT)) demand(family.disposition === 'BOUNDED_VALIDITY_AND_ISSUANCE_CLOSED', 'preexisting candidate credential authority unresolved');
  }
  return Math.max(...value.families.map(f => f.reviewedAtMs));
}
