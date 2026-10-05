import { PROJECT, PLANNED_ACCOUNT, LEGACY_ACCOUNTS, demand, canonical, digest } from './common.mjs';

import { validateWirePolicy, policyView, sortedBindings } from './iam-evidence.mjs';

export const DENIED_PERMISSIONS = Object.freeze([
  'datastore.googleapis.com/entities.create', 'datastore.googleapis.com/entities.update', 'datastore.googleapis.com/entities.delete',
  'iam.googleapis.com/serviceAccounts.getAccessToken', 'iam.googleapis.com/serviceAccounts.getOpenIdToken',
  'iam.googleapis.com/serviceAccounts.signBlob', 'iam.googleapis.com/serviceAccounts.signJwt',
  'iam.googleapis.com/serviceAccounts.implicitDelegation', 'iam.googleapis.com/serviceAccounts.actAs',
  'iam.googleapis.com/serviceAccountKeys.create', 'iam.googleapis.com/serviceAccounts.setIamPolicy',
  'iam.googleapis.com/serviceAccounts.create', 'cloudresourcemanager.googleapis.com/projects.setIamPolicy',
  'iam.googleapis.com/roles.create', 'iam.googleapis.com/roles.update', 'iam.googleapis.com/roles.undelete',
]);
export const READER_PERMISSIONS = Object.freeze(['datastore.entities.get', 'datastore.entities.list', 'datastore.databases.get', 'firebaseauth.users.get']);
export const CANDIDATE_PERMISSIONS = Object.freeze([...READER_PERMISSIONS,
  'datastore.entities.create', 'datastore.entities.update', 'datastore.entities.delete',
  'firebaseauth.users.create', 'firebaseauth.users.update', 'firebaseauth.users.delete']);
export const READER_ROLE = `projects/${PROJECT}/roles/mutterLegacyReadOnly`;
export const CANDIDATE_ROLE = `projects/${PROJECT}/roles/mutterStockRuntime`;

export function containmentProposal(supported) {
  demand(Array.isArray(supported) && DENIED_PERMISSIONS.every(p => supported.includes(p)), 'deny permission support unverified');
  return { schema: 1, status: 'PROPOSAL_ONLY_NOT_APPLIED', project: PROJECT, projectNumber: '26777776532',
    candidate: { email: PLANNED_ACCOUNT, status: 'PLANNED_NOT_CREATED' },
    deny: { displayName: 'Mutter first cutover legacy containment', rules: [{ denyRule: {
      deniedPrincipals: LEGACY_ACCOUNTS.map(email => `principal://iam.googleapis.com/projects/-/serviceAccounts/${email}`),
      deniedPermissions: [...DENIED_PERMISSIONS],
    } }] },
    attachmentPoint: 'cloudresourcemanager.googleapis.com/projects/26777776532', policyId: 'mutter-first-cutover-legacy',
    customRoles: [
      { name: READER_ROLE, title: 'Mutter legacy read only', stage: 'GA', includedPermissions: [...READER_PERMISSIONS] },
      { name: CANDIDATE_ROLE, title: 'Mutter stock runtime', stage: 'GA', includedPermissions: [...CANDIDATE_PERMISSIONS] },
    ],
    requiredOrder: ['deny-delegation-and-data-write', 'remove-legacy-elevated-allows', 'verify-no-inherited-or-resource-escape',
      'create-candidate-without-keys-or-authority', 'restrict-candidate-resource-policy', 'grant-exact-runtime-role', 'configure-audited-deployments'],
    note: 'Removing Editor/SDK/Auth-write/TokenCreator is required, not optional: it closes service launch and permissions outside deny support. Preserve only the exact reader role. No Google service agent is a deny principal.' };
}

/** Version-bound surgical allow-policy delta. Unknown roles/conditions stop review.
 * Never send this to setIamPolicy from preparation or CI.
 */
export function legacyAllowProposal(before, readContext) {
  validateWirePolicy(before, readContext);
  const members = new Set(LEGACY_ACCOUNTS.map(a => `serviceAccount:${a}`));
  const known = new Map([
    [LEGACY_ACCOUNTS[0], new Set(['roles/firebase.sdkAdminServiceAgent', 'roles/firebaseauth.admin', 'roles/iam.serviceAccountTokenCreator', READER_ROLE])],
    [LEGACY_ACCOUNTS[1], new Set(['roles/editor', READER_ROLE])],
  ]);
  const found = new Set();
  const after = policyView(before, readContext);
  after.bindings = after.bindings.flatMap(binding => {
    demand(typeof binding.role === 'string' && Array.isArray(binding.members), 'invalid IAM binding');
    if (!binding.members.some(m => members.has(m))) return [binding];
    demand(!binding.condition && binding.members.filter(m => members.has(m))
      .every(m => known.get(m.slice('serviceAccount:'.length)).has(binding.role)), 'unreviewed legacy role/condition');
    binding.members.forEach(m => { if (members.has(m)) found.add(m); });
    const remaining = binding.members.filter(m => !members.has(m));
    return remaining.length ? [{ ...binding, members: remaining }] : [];
  });
  demand(found.size === members.size, 'both legacy principals must be identified');
  const existingReader = after.bindings.find(b => b.role === READER_ROLE && !b.condition);
  if (existingReader) existingReader.members = [...new Set([...existingReader.members, ...members])];
  else after.bindings.push({ role: READER_ROLE, members: [...members] });
  return { schema: 2, status: 'PROPOSAL_ONLY_NOT_APPLIED', beforeSha256: digest(before), etag: before.etag, after,
    inheritedResourceBindingsMustBeVerifiedSeparately: true, candidateAuthorityGranted: false };
}
export function verifyAllowBase(proposal, fresh, readContext) {
  demand(proposal.etag === fresh.etag && proposal.beforeSha256 === digest(fresh)
    && canonical(proposal) === canonical(legacyAllowProposal(fresh, readContext)), 'IAM drift or proposal tampering');
  return true;
}

/** Fresh GET after setIamPolicy, never the mutation response or verifyAllowBase. */
export function verifyAllowAfter(proposal, before, fresh, readContext) {
  verifyAllowBase(proposal, before, readContext);
  validateWirePolicy(fresh, readContext);
  demand(fresh.etag !== proposal.etag && canonical(sortedBindings(fresh, readContext)) === canonical(sortedBindings(proposal.after, readContext)),
    'IAM after drift, stale etag or unauthorized delta');
  return true;
}
