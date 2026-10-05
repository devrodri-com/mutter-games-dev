// Explicitly synthetic transport examples; never evidence about Google or Mutter.
import { PROJECT, DATABASE, LEGACY_ACCOUNTS, PLANNED_ACCOUNT, digest } from './common.mjs';
import { OPERATOR, PROJECT_RESOURCE, PROJECT_NUMBER, accountResource } from './iam-evidence.mjs';
import { containmentProposal, legacyAllowProposal, DENIED_PERMISSIONS, READER_ROLE, READER_PERMISSIONS,
  CANDIDATE_ROLE, CANDIDATE_PERMISSIONS } from './authority.mjs';
import { PROJECT_WRITE_PERMISSIONS, ACCOUNT_ESCAPE_PERMISSIONS } from './authority-proofs.mjs';
export function source(input, method, resource, response, { at = 100030, principal = OPERATOR, body = {}, query = {}, status = 200 } = {}) {
  const requestRaw = JSON.stringify({ method, resource, body, query });
  const responseRaw = JSON.stringify(response);
  return { schema: 1, origin: 'SYNTHETIC', revision: input.revision, windowSha256: digest(input.window), observedAtMs: at,
    channel: { kind: 'OFFICIAL_AUTHENTICATED_API', principal, captureId: 'synthetic-capture' },
    requestRaw, responseRaw, requestSha256: digest(requestRaw), responseSha256: digest(responseRaw),
    httpStatus: status, responseComplete: true, projection: 'NONE' };
}
export function editSource(s, which, edit) {
  const value = JSON.parse(s[`${which}Raw`]); edit(value);
  s[`${which}Raw`] = JSON.stringify(value); s[`${which}Sha256`] = digest(s[`${which}Raw`]);
}
export const policyRead = (input, resource, policy, at) => source(input, 'getIamPolicy', resource, policy,
  resource.includes('/serviceAccounts/') ? { at, query: { 'options.requestedPolicyVersion': 3 } }
    : { at, body: { options: { requestedPolicyVersion: 3 } } });
export function bindContainment(input) {
  const e = input.containment, barrier = input.barriers.find(b => b.scope === 'legacy-authority');
  const authorityReview = e.installationReview ?? e.review;
  barrier.method = e.method; barrier.evidenceSha256 = digest(e); barrier.observedAtMs = Math.max(100090, e.review?.reviewedAtMs ?? 0);
  const delegation = input.barriers.find(b => b.scope === 'delegation'); delegation.observedAtMs = 100090;
  Object.assign(input.delegation, { containmentSha256: digest(e), containedAtMs: authorityReview.reviewedAtMs,
    candidateGrantedAtMs: e.candidate.grantedProject.observedAtMs });
  return input;
}
export function syntheticContainment(input, method = 'ALLOW_ABSENCE_V1', version = 3) {
  const before = { version, etag: 'synthetic-before', bindings: [
    { role: 'roles/editor', members: [`serviceAccount:${LEGACY_ACCOUNTS[1]}`, 'user:other@example.invalid'] },
    ...['roles/firebase.sdkAdminServiceAgent', 'roles/firebaseauth.admin', 'roles/iam.serviceAccountTokenCreator']
      .map(role => ({ role, members: [`serviceAccount:${LEGACY_ACCOUNTS[0]}`] })),
    { role: 'roles/owner', members: [`user:${OPERATOR}`] },
  ], auditConfigs: [{ service: 'allServices', auditLogConfigs: [{ logType: 'ADMIN_READ' }] }] };
  const proposal = legacyAllowProposal(before, { requestedPolicyVersion: 3, responseComplete: true });
  const after = { ...proposal.after, etag: 'synthetic-after' };
  const empty = { version, etag: 'synthetic-resource', bindings: [] };
  const e = { schema: 1, method, project: PROJECT, projectNumber: PROJECT_NUMBER, database: DATABASE,
    projectSource: source(input, 'projects.get', PROJECT_RESOURCE, { projectId: PROJECT, projectNumber: PROJECT_NUMBER }),
    roles: [[READER_ROLE, READER_PERMISSIONS], [CANDIDATE_ROLE, CANDIDATE_PERMISSIONS]].map(([name, includedPermissions]) =>
      source(input, 'roles.get', name, { name, stage: 'GA', includedPermissions }, { at: 99990 })),
    accountPages: [source(input, 'serviceAccounts.list', PROJECT_RESOURCE, { accounts: LEGACY_ACCOUNTS.map((email, i) =>
      ({ email, projectId: PROJECT, name: accountResource(email), uniqueId: `synthetic-${i}` })) })],
    allow: { proposal, before: policyRead(input, PROJECT_RESOURCE, before, 99990),
      freshBase: policyRead(input, PROJECT_RESOURCE, before, 100010),
      application: source(input, 'setIamPolicy', PROJECT_RESOURCE, after, { at: 100020, body: { policy: proposal.after } }),
      readback: policyRead(input, PROJECT_RESOURCE, after, 100030) },
    resourcePolicies: LEGACY_ACCOUNTS.map(email => policyRead(input, accountResource(email), empty, 100031)),
    reviewSources: [],
  };
  e.negativeProofs = LEGACY_ACCOUNTS.map(principal => {
    const body = { writes: [{ update: { name: `${DATABASE}/documents/products/synthetic-never-send` },
      updateMask: { fieldPaths: [] }, currentDocument: { updateTime: '1970-01-01T00:00:00Z' } }] };
    const negative = source(input, 'commit', DATABASE, { error: { status: 'PERMISSION_DENIED' } }, { at: 100040, principal, body, status: 403 });
    const proof = { principal,
      authentication: source(input, 'databases.get', DATABASE, { name: DATABASE, uid: 'synthetic-database-uid', createTime: '2025-01-01T00:00:00Z' }, { at: 100040, principal }),
      update: { representedPrincipal: principal, positivePrincipal: OPERATOR, negative,
        positive: source(input, 'commit', DATABASE, { error: { status: 'FAILED_PRECONDITION' } }, { at: 100040, body, status: 400 }),
        preconditionReview: { status: 'REVIEWED_IMPOSSIBLE_FOR_THIS_RESOURCE', requestSha256: negative.requestSha256,
          reason: 'Synthetic resource created after 1970; this is not a real database creation proof.' } },
      evaluations: [[PROJECT_RESOURCE, PROJECT_WRITE_PERMISSIONS], ...LEGACY_ACCOUNTS.map(a => [accountResource(a), ACCOUNT_ESCAPE_PERMISSIONS])]
        .map(([resource, permissions]) => {
          const fullResourceName = `//${resource === PROJECT_RESOURCE ? 'cloudresourcemanager' : 'iam'}.googleapis.com/${resource}`;
          const support = source(input, 'queryTestablePermissions', resource, { permissions: permissions.map(name => ({ name })) },
            { at: 100040, body: { fullResourceName } });
          const denied = source(input, 'testIamPermissions', resource, { permissions: [] }, { at: 100040, principal, body: { permissions } });
          return { resource, fullResourceName, support: [support], denied, limitations: 'Synthetic test semantics only. Native resource support must be independently established before use.',
            review: { status: 'REVIEWED_RESOURCE_AND_TEST_SEMANTICS', sourceSha256: [digest(support), digest(denied)], unresolved: 0 } };
        }),
    };
    const opaqueRef = `synthetic-credential-${principal}`;
    for (const capture of [proof.authentication, proof.update.negative, ...proof.evaluations.map(v => v.denied)]) capture.channel.credentialRef = opaqueRef;
    for (const row of proof.evaluations) row.review.sourceSha256 = [...row.support.map(digest), digest(row.denied)];
    proof.credential = { representedPrincipal: principal, opaqueRef, oauthScopes: ['https://www.googleapis.com/auth/cloud-platform'],
      authenticationSourceSha256: digest(proof.authentication) };
    proof.update.preconditionReview.databaseMetadataSha256 = digest(proof.authentication);
    return proof;
  });
  if (method === 'PROJECT_DENY') {
    const p = containmentProposal(DENIED_PERMISSIONS), resource = `policies/${encodeURIComponent(p.attachmentPoint)}/denypolicies/${p.policyId}`;
    e.deny = { proposal: p, supportedPermissions: [...DENIED_PERMISSIONS], readback: source(input, 'denyPolicies.get', resource,
      { name: resource, etag: 'synthetic-deny', ...p.deny }, { at: 100015 }) };
    e.inheritedReview = { status: 'NO_UNRESOLVED_INHERITED_AUTHORITY', projectSourceSha256: digest(e.projectSource) };
  }
  const apiSurface = source(input, 'discovery.get', 'https://firestore.googleapis.com/$discovery/rest?version=v1',
    { name: 'firestore', version: 'v1', resources: { projects: { resources: { databases: { methods: { get: { httpMethod: 'GET' }, list: { httpMethod: 'GET' } } } } } } }, { at: 100031 });
  apiSurface.channel.kind = 'OFFICIAL_PUBLIC_REFERENCE'; apiSurface.channel.principal = null;
  e.databasePolicy = { mode: 'PROJECT_POLICY_ONLY_V1_API', apiSurface, review: { status: 'REVIEWED_PROJECT_POLICY_APPLIES',
    apiSurfaceSha256: digest(apiSurface), projectPolicySha256: digest(e.allow.readback),
    limitations: 'Synthetic Firestore v1 surface only; exact production surface and effective project conditions still need review.' } };
  const sources = [e.projectSource, ...e.roles, ...e.accountPages, e.allow.before, e.allow.freshBase, e.allow.application,
    e.allow.readback, ...e.resourcePolicies, e.databasePolicy.apiSurface, ...(e.deny ? [e.deny.readback] : []),
    ...e.negativeProofs.flatMap(p => [p.authentication, p.update.negative, p.update.positive, ...p.evaluations.flatMap(v => [...v.support, v.denied])])];
  const hashes = sources.map(digest);
  e.credentials = { status: 'REVIEWED_NO_UNRESOLVED_ROUTE', noIntrusionOrIssuanceInferred: true,
    keyDeletionRevokesIssuedTokens: false, tokenCreatorRemovalRevokesIssuedTokens: false, unresolved: 0,
    families: ['LEGACY_KEYS_AND_REPRESENTING_TOKENS', 'FOREIGN_ACCESS_TOKENS', 'SIGNED_JWT_AND_BLOB', 'OIDC_TOKENS', 'FIREBASE_SESSIONS']
      .map((family, i) => ({ family, disposition: i === 0 ? 'DESTINATION_AUTHORITY_CONTAINED' : 'NO_RELEVANT_AUTHORITY_WITH_EVIDENCE',
        representedPrincipals: i === 0 ? [...LEGACY_ACCOUNTS] : ['synthetic-destination@example.invalid'],
        scope: 'synthetic-only authority review', validityBasis: 'Synthetic bounded evidence, not universal token expiration or absence of emission.',
        reason: 'Fixture models a completed independent review; there is no real credential or provider guarantee.',
        sourceSha256: hashes, reviewedAtMs: 100050 })) };
  e.review = { status: 'REVIEWED_EXACT_SOURCES', method, revision: input.revision, windowSha256: digest(input.window),
    reviewer: 'synthetic-reviewer-not-an-auditor', unresolved: [], sourceSha256: hashes, reviewedAtMs: 100060,
    coverage: ['DIRECT_AND_CONDITIONAL_GRANTS', 'INDIRECT_MEMBERSHIP_AND_RESOURCE_GRANTS', 'SERVICE_LAUNCH_AND_EXISTING_WORKLOAD_AUTHORITY',
      'AUTHORITY_RECOVERY_AND_DELEGATION', 'PREEXISTING_CREDENTIALS'].map(category => ({ category, disposition: 'NO_UNRESOLVED_ROUTE',
      reason: 'Synthetic primary review coverage only; not evidence of any live project or provider state.', sourceSha256: hashes })) };
  e.candidate = { noGrantProject: policyRead(input, PROJECT_RESOURCE, after, 100070),
    restrictedPolicy: policyRead(input, accountResource(PLANNED_ACCOUNT), empty, 100080),
    grantedProject: policyRead(input, PROJECT_RESOURCE, { ...after, etag: 'synthetic-grant', bindings: [...after.bindings,
      { role: CANDIDATE_ROLE, members: [`serviceAccount:${PLANNED_ACCOUNT}`] }] }, 100085) };
  input.containment = e;
  return bindContainment(input);
}

/** Changes a synthetic completed example into the honest installation stage. */
export function pendingInstallation(input, method = 'ALLOW_ABSENCE_V1') {
  syntheticContainment(input, method);
  input.phase = 'CONTROLLED_INSTALL_PENDING_CLOSURE';
  input.identity.runtimeVerified = false;
  input.identity.noOtherUncontainedAuthority = false;
  const evidence = input.containment;
  evidence.installationReview = structuredClone(evidence.review);
  evidence.installationReview.coverage = evidence.installationReview.coverage.filter(row => row.category !== 'PREEXISTING_CREDENTIALS');
  delete evidence.review;
  evidence.credentials.status = 'PENDING_CLOSURE';
  evidence.credentials.unresolved = 2;
  for (const family of evidence.credentials.families) if (['FIREBASE_SESSIONS', 'SIGNED_JWT_AND_BLOB'].includes(family.family)) {
    family.disposition = 'PENDING_TREATMENT';
    family.reason = 'Synthetic issuance and Firebase sessions remain untreated; IAM installation does not close this family.';
  }
  return bindContainment(input);
}

/** Explicit simulated treatment after migration. Never a provider receipt. */
export function syntheticSequenceClosure(input, afterAtMs = input.nowMs + 10) {
  const result = structuredClone(input), evidence = result.containment;
  evidence.installationCredentials = structuredClone(evidence.credentials);
  evidence.credentials.status = 'REVIEWED_NO_UNRESOLVED_ROUTE';
  evidence.credentials.unresolved = 0;
  for (const family of evidence.credentials.families) {
    family.reviewedAtMs = afterAtMs;
    if (family.disposition === 'PENDING_TREATMENT') {
      Object.assign(family, { disposition: 'BOUNDED_VALIDITY_AND_ISSUANCE_CLOSED', lastPossibleIssueAtMs: afterAtMs - 2,
        validUntilMs: afterAtMs - 1, familySpecificValidity: true,
        issuanceClosureBasis: 'Explicit synthetic simulated treatment and expiry only; no production closure or provider authenticity is asserted.' });
    }
  }
  evidence.review = structuredClone(evidence.installationReview);
  evidence.review.reviewedAtMs = afterAtMs + 1;
  evidence.review.coverage.push({ category: 'PREEXISTING_CREDENTIALS', disposition: 'NO_UNRESOLVED_ROUTE',
    reason: 'Explicitly simulated synthetic treatment completed after candidate migration; not a production credential closure.',
    sourceSha256: [...evidence.review.sourceSha256] });
  result.identity.runtimeVerified = true;
  result.identity.noOtherUncontainedAuthority = true;
  bindContainment(result);
  // Advance only the synthetic operational observations past the same required
  // mitigation interval. This does not wait for or attest a real provider.
  const finalBarrierAt = Math.max(...result.barriers.map(barrier => barrier.observedAtMs));
  const quietAt = finalBarrierAt + 600001;
  result.operations.observedAtMs = quietAt;
  result.backup.finalCaptureStartedAtMs = quietAt;
  result.backup.finalCaptureFinishedAtMs = quietAt + 1;
  result.comparison.checkedAtMs = quietAt + 2;
  result.nowMs = Math.max(result.nowMs, quietAt + 3);
  return result;
}
