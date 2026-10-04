import { PROJECT, DATABASE, PLANNED_ACCOUNT, LEGACY_ACCOUNTS, demand, digest } from './common.mjs';
import { containmentProposal, legacyAllowProposal, verifyAllowBase, verifyAllowAfter,
  READER_ROLE, READER_PERMISSIONS, CANDIDATE_ROLE, CANDIDATE_PERMISSIONS } from './authority.mjs';
import { readSource, readPolicy, same, instant, requireReview, PROJECT_RESOURCE, PROJECT_NUMBER, accountResource, sortedBindings } from './iam-evidence.mjs';
import { verifyNegativeProofs, verifyCredentials } from './authority-proofs.mjs';

const policyOptions = { requestedPolicyVersion: 3, responseComplete: true };
const categories = ['DIRECT_AND_CONDITIONAL_GRANTS', 'INDIRECT_MEMBERSHIP_AND_RESOURCE_GRANTS',
  'SERVICE_LAUNCH_AND_EXISTING_WORKLOAD_AUTHORITY', 'AUTHORITY_RECOVERY_AND_DELEGATION', 'PREEXISTING_CREDENTIALS'];
const legacyMembers = LEGACY_ACCOUNTS.map(a => `serviceAccount:${a}`);
const candidateMember = `serviceAccount:${PLANNED_ACCOUNT}`;

function noLegacyResourceGrant(policy) {
  demand(policy.bindings.every(b => !b.members.some(m => legacyMembers.includes(m)
    || m === 'allUsers' || m === 'allAuthenticatedUsers')), 'legacy/public resource grant remains');
}
function noCandidateGrant(policy) {
  demand(policy.bindings.every(b => !b.members.includes(candidateMember)), 'candidate authority granted before containment');
}
function exactRoles(value, context) {
  demand(Array.isArray(value) && value.length === 2, 'two exact roles required');
  for (const [resource, permissions] of [[READER_ROLE, READER_PERMISSIONS], [CANDIDATE_ROLE, CANDIDATE_PERMISSIONS]]) {
    const source = value.find(s => JSON.parse(s.requestRaw).resource === resource);
    const { response } = readSource(source, { method: 'roles.get', resource }, context);
    demand(response.name === resource && response.stage === 'GA' && response.deleted !== true
      && same([...(response.includedPermissions ?? [])].sort(), [...permissions].sort()), 'custom role permissions differ');
  }
}
function accountsFromPages(pages, context) {
  demand(Array.isArray(pages) && pages.length > 0, 'service-account inventory missing');
  const emails = []; let token = ''; const seen = new Set();
  for (let index = 0; index < pages.length; index++) {
    const { request, response } = readSource(pages[index], { method: 'serviceAccounts.list', resource: PROJECT_RESOURCE }, context);
    demand((request.query?.pageToken ?? '') === token && Array.isArray(response.accounts), 'service-account pagination/response incomplete');
    for (const a of response.accounts) {
      demand(typeof a.email === 'string' && a.projectId === PROJECT && a.name === accountResource(a.email)
        && typeof a.uniqueId === 'string' && !emails.includes(a.email), 'service-account identity/duplicate');
      emails.push(a.email);
    }
    token = response.nextPageToken ?? '';
    demand(typeof token === 'string' && (!token || !seen.has(token)), 'service-account pagination cycle'); seen.add(token);
    demand(index === pages.length - 1 ? !token : !!token, 'service-account inventory not exhausted');
  }
  demand(LEGACY_ACCOUNTS.every(a => emails.includes(a)), 'legacy accounts absent from inventory');
  return emails;
}

/** Both methods are explicit, versioned documentary checks. Nothing here fetches
 * Google or proves provider authenticity. Missing evidence throws NOT_VERIFIED.
 */
export function verifyContainment(evidence, input) {
  demand(evidence?.schema === 1 && ['PROJECT_DENY', 'ALLOW_ABSENCE_V1'].includes(evidence.method), 'explicit containment method required');
  demand(evidence.project === PROJECT && evidence.projectNumber === PROJECT_NUMBER && evidence.database === DATABASE,
    'containment project identity');
  const context = { synthetic: input.synthetic, revision: input.revision, window: input.window,
    nowMs: input.nowMs, maxAgeMs: input.maxAgeMs };
  const sources = [];
  const add = s => { sources.push(s); return s; };
  const project = readSource(add(evidence.projectSource), { method: 'projects.get', resource: PROJECT_RESOURCE }, context).response;
  demand(project.projectId === PROJECT && project.projectNumber === PROJECT_NUMBER, 'project identity mismatch');
  if (evidence.method === 'ALLOW_ABSENCE_V1') demand(!Object.hasOwn(project, 'parent') || project.parent === null, 'ALLOW_ABSENCE requires no parent in complete response');
  else demand(evidence.inheritedReview?.status === 'NO_UNRESOLVED_INHERITED_AUTHORITY'
    && evidence.inheritedReview.projectSourceSha256 === digest(evidence.projectSource), 'deny inheritance review missing');

  exactRoles(evidence.roles, context); sources.push(...evidence.roles);
  const accountNames = accountsFromPages(evidence.accountPages, context); sources.push(...evidence.accountPages);
  demand(!accountNames.includes(PLANNED_ACCOUNT), 'candidate must have no identity/authority at pre-containment inventory');
  const before = readPolicy(add(evidence.allow.before), PROJECT_RESOURCE, context);
  const fresh = readPolicy(add(evidence.allow.freshBase), PROJECT_RESOURCE, context);
  noCandidateGrant(before);
  const proposal = legacyAllowProposal(before, policyOptions);
  demand(same(evidence.allow.proposal, proposal), 'allow proposal differs from exact source');
  verifyAllowBase(proposal, fresh, policyOptions);
  const entryClose = Math.max(...input.barriers.filter(b => !['legacy-authority', 'delegation'].includes(b.scope)).map(b => b.observedAtMs));
  demand(Number.isFinite(entryClose) && evidence.roles.every(r => r.observedAtMs <= entryClose)
    && evidence.allow.freshBase.observedAtMs >= entryClose && evidence.allow.freshBase.observedAtMs >= evidence.allow.before.observedAtMs,
  'roles/base must precede withdrawal under closed entries');
  const applied = readSource(add(evidence.allow.application), { method: 'setIamPolicy', resource: PROJECT_RESOURCE }, context);
  demand(same(applied.request.body, { policy: proposal.after }) && applied.response.etag !== proposal.etag, 'wrong applied proposal/concurrency token');
  verifyAllowAfter(proposal, before, applied.response, policyOptions);
  const after = readPolicy(add(evidence.allow.readback), PROJECT_RESOURCE, context);
  verifyAllowAfter(proposal, before, after, policyOptions);
  demand(same(applied.response, after) && evidence.allow.application.observedAtMs > evidence.allow.freshBase.observedAtMs
    && evidence.allow.readback.observedAtMs > evidence.allow.application.observedAtMs, 'allow readback contradictory/not fresh');

  demand(Array.isArray(evidence.resourcePolicies) && evidence.resourcePolicies.length === accountNames.length, 'resource policy coverage incomplete');
  for (const email of accountNames) {
    const resource = accountResource(email);
    const source = evidence.resourcePolicies.find(s => JSON.parse(s.requestRaw).resource === resource);
    noLegacyResourceGrant(readPolicy(add(source), resource, context));
    demand(source.observedAtMs >= evidence.allow.readback.observedAtMs, 'resource policy predates withdrawal');
  }
  // Database policy applicability is explicit and bound to the complete official
  // API surface. A 403 or an unavailable source is never an empty policy.
  const database = evidence.databasePolicy;
  demand(database && ['RESOURCE_POLICY', 'PROJECT_POLICY_ONLY_V1_API'].includes(database.mode), 'database policy applicability missing');
  const api = readSource(add(database.apiSurface), { method: 'discovery.get',
    resource: 'https://firestore.googleapis.com/$discovery/rest?version=v1', public: true }, context).response;
  const methods = api.resources?.projects?.resources?.databases?.methods;
  demand(api.name === 'firestore' && api.version === 'v1' && methods?.get && methods.list, 'database IAM API surface unknown');
  let databaseObservedAt = evidence.allow.readback.observedAtMs;
  if (database.mode === 'RESOURCE_POLICY') {
    demand(methods.getIamPolicy && methods.setIamPolicy, 'database policy method not in captured API surface');
    noLegacyResourceGrant(readPolicy(add(database.readback), DATABASE, context));
    demand(database.readback.observedAtMs >= databaseObservedAt, 'database policy predates withdrawal');
    databaseObservedAt = database.readback.observedAtMs;
  } else {
    demand(!methods.getIamPolicy && !methods.setIamPolicy, 'database IAM API surface changed/unknown');
    demand(database.review?.status === 'REVIEWED_PROJECT_POLICY_APPLIES'
      && database.review.apiSurfaceSha256 === digest(database.apiSurface)
      && database.review.projectPolicySha256 === digest(evidence.allow.readback)
      && typeof database.review.limitations === 'string' && database.review.limitations.length >= 30,
    'database project-policy scope not reviewed');
  }

  if (evidence.method === 'PROJECT_DENY') {
    const deny = evidence.deny, proposed = containmentProposal(deny?.supportedPermissions);
    demand(same(deny.proposal, proposed), 'deny proposal tampering');
    const resource = `policies/${encodeURIComponent(proposed.attachmentPoint)}/denypolicies/${proposed.policyId}`;
    const { response } = readSource(add(deny.readback), { method: 'denyPolicies.get', resource }, context);
    demand(response.name === resource && typeof response.etag === 'string' && response.etag.length > 0
      && same(response.rules, proposed.deny.rules) && response.displayName === proposed.deny.displayName
      && deny.readback.observedAtMs <= evidence.allow.application.observedAtMs, 'deny readback differs from containmentProposal/order');
  } else demand(!evidence.deny, 'ALLOW_ABSENCE must not pretend a deny was applied');

  const negative = verifyNegativeProofs(evidence.negativeProofs, accountNames,
    Math.max(evidence.allow.readback.observedAtMs, databaseObservedAt, ...evidence.resourcePolicies.map(s => s.observedAtMs)), context);
  sources.push(...negative.sources);
  // Additional bounded primary captures substantiate route/credential review;
  // they may not be UI tables, 403, a projected response or opaque hash alone.
  demand(Array.isArray(evidence.reviewSources), 'authority review sources missing');
  for (const source of evidence.reviewSources) {
    const request = JSON.parse(source.requestRaw);
    demand(['roles.get', 'getIamPolicy', 'queryTestablePermissions', 'serviceAccounts.list', 'projects.get', 'databases.get'].includes(request.method), 'unknown review source method');
    demand(request.resource === PROJECT_RESOURCE || request.resource === DATABASE || request.resource.startsWith(`${PROJECT_RESOURCE}/`), 'foreign review resource');
    if (request.method === 'getIamPolicy') readPolicy(add(source), request.resource, context);
    else readSource(add(source), { method: request.method, resource: request.resource }, context);
  }
  const credentialsAt = verifyCredentials(evidence.credentials, sources.map(digest), negative.effectiveAt, context);
  requireReview(evidence.review, sources, context, categories);
  demand(evidence.review.method === evidence.method && instant(evidence.review.reviewedAtMs)
    && evidence.review.reviewedAtMs >= credentialsAt && evidence.review.reviewedAtMs <= input.nowMs, 'review method/chronology');

  const candidate = evidence.candidate;
  const noGrant = readPolicy(candidate?.noGrantProject, PROJECT_RESOURCE, context);
  verifyAllowAfter(proposal, before, noGrant, policyOptions); noCandidateGrant(noGrant);
  demand(candidate.noGrantProject.observedAtMs > evidence.review.reviewedAtMs, 'no-grant proof must follow effective containment');
  const candidateResource = accountResource(PLANNED_ACCOUNT);
  const resourcePolicy = readPolicy(candidate.restrictedPolicy, candidateResource, context); noLegacyResourceGrant(resourcePolicy);
  demand(resourcePolicy.bindings.length === 0, 'new candidate requires empty direct policy; inherited operator/agents remain in project policy');
  demand(candidate.restrictedPolicy.observedAtMs > candidate.noGrantProject.observedAtMs, 'candidate resource policy must follow no-grant proof');
  const granted = readPolicy(candidate.grantedProject, PROJECT_RESOURCE, context);
  const expectedGrant = structuredClone(noGrant);
  const existingGrant = expectedGrant.bindings.find(b => b.role === CANDIDATE_ROLE && !b.condition);
  if (existingGrant) existingGrant.members.push(candidateMember);
  else expectedGrant.bindings.push({ role: CANDIDATE_ROLE, members: [candidateMember] });
  // Compare the full final project policy except its new etag; do not feed the
  // post-grant policy into the earlier before/after verification.
  demand(granted.etag !== noGrant.etag && same(sortedBindings(granted), sortedBindings(expectedGrant)), 'candidate grant not exact/preserved');
  demand(candidate.grantedProject.observedAtMs > candidate.restrictedPolicy.observedAtMs, 'candidate grant precedes containment/restriction');
  for (const s of [candidate.noGrantProject, candidate.restrictedPolicy, candidate.grantedProject])
    demand(s.observedAtMs <= input.barriers.find(b => b.scope === 'delegation').observedAtMs, 'candidate timeline beyond barrier receipt');
  demand(input.delegation?.containedBeforeCandidateGrant === true
    && input.delegation.containmentSha256 === digest(evidence)
    && input.delegation.containedAtMs === evidence.review.reviewedAtMs
    && input.delegation.candidateGrantedAtMs === candidate.grantedProject.observedAtMs, 'delegation chronology not bound to containment');
  const barrier = input.barriers.find(b => b.scope === 'legacy-authority');
  demand(barrier?.evidenceSha256 === digest(evidence) && barrier.method === evidence.method
    && barrier.observedAtMs >= evidence.review.reviewedAtMs, 'legacy-authority barrier not bound to method/readbacks');
  return { method: evidence.method, status: 'CONTAINMENT_DOCUMENTS_CONSISTENT', remoteEnforcementAttestedByThisTool: false,
    providerAuthenticityRequiresIndependentReview: true, containedAtMs: evidence.review.reviewedAtMs };
}
