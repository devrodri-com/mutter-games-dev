import { createHash } from 'node:crypto';

export const PROJECTS = Object.freeze({
  store: 'prj_MMfug8FP68f5DcbqzmNngveqn1si',
  storeLegacy: 'prj_3Xi2Q7qWjWugCHZMKoF2shl3Gzkf',
  admin: 'prj_yDpdKjGlllr9Xs0EisirMiWCj62T',
  adminLegacy: 'prj_NccOdaqJZwzgJa144y4cF6LizIMS',
});
export const CONTROL_DOCUMENT = 'operations/webStockCutover';
export const RELEASE_HEADER = 'x-mutter-release-action';
const readMethods = ['GET', 'HEAD', 'OPTIONS'];
const checkout = '/api/create-mp-preference';
const reconcile = '/api/internal/web-stock-reconcile';
const signature = '/api/imagekit-signature';

export function requireValue(condition, reason) {
  if (!condition) throw new Error(`NOT_VERIFIED: ${reason}`);
}

export function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function literalHost(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value)
    && value.includes('.') && !value.includes('*');
}

/** A routing discriminator is not authorization. The handler still checks the secret. */
export function isCandidateSmoke(request, candidate) {
  if (!candidate || !literalHost(candidate.host) || !candidate.deploymentId
    || candidate.guardsClosed !== true || request.host !== candidate.host) return false;
  if (request.path !== request.rawPath) return false;
  const action = request.headers?.[RELEASE_HEADER];
  return (request.method === 'POST' && request.path === checkout
      && ['runtime-attestation', 'read-smoke'].includes(action))
    || (request.method === 'GET' && request.path === reconcile && action === 'runtime-attestation');
}

/** Models ONLY the additional closure rule, never an allow overriding another rule. */
export function closureDenies(request, { project, candidate = null }) {
  requireValue(['store', 'admin', 'storeLegacy', 'adminLegacy'].includes(project), 'unknown project');
  if (project.endsWith('Legacy')) return true;
  if (project === 'store' && isCandidateSmoke(request, candidate)) return false;
  if (!readMethods.includes(request.method)) return true;
  const blocked = project === 'admin' ? signature : reconcile;
  return request.path.startsWith(blocked) || request.rawPath.startsWith(blocked);
}

/** Supported subset of the actual Vercel condition model. Unknown operators fail closed. */
export function matchesCondition(condition, request) {
  const raw = condition.type === 'raw_path' ? request.rawPath
    : condition.type === 'header' ? request.headers?.[condition.key] ?? '' : request[condition.type];
  requireValue(typeof raw === 'string', `missing request field ${condition.type}`);
  // Vercel documents case-insensitive operators; the application boundary remains strict.
  const actual = raw.toLowerCase();
  const value = Array.isArray(condition.value) ? condition.value.map(v => v.toLowerCase()) : condition.value.toLowerCase();
  let result;
  switch (condition.op) {
    case 'eq': result = actual === value; break;
    case 'neq': result = actual !== value; break;
    case 'inc': requireValue(Array.isArray(value), 'inc requires array'); result = value.includes(actual); break;
    case 'ninc': requireValue(Array.isArray(value), 'ninc requires array'); result = !value.includes(actual); break;
    case 'pre': result = actual.startsWith(value); break;
    case 'sub': result = actual.includes(value); break;
    case 're': result = new RegExp(condition.value, 'i').test(raw); break;
    default: throw new Error(`NOT_VERIFIED: unsupported WAF operator ${condition.op}`);
  }
  return condition.neg ? !result : result;
}

export function wafDenies(snapshot, request) {
  requireValue(snapshot?.firewallEnabled === true && Array.isArray(snapshot.rules), 'firewall snapshot missing');
  return snapshot.rules.some(rule => rule.active && rule.action?.mitigate?.action === 'deny'
    && rule.conditionGroup.some(group => group.conditions.every(c => matchesCondition(c, request))));
}

export function closureProposal(snapshot, project) {
  requireValue(PROJECTS[project] && snapshot.projectKey === `${PROJECTS[project]}#active`, 'wrong firewall project');
  requireValue(Number.isInteger(snapshot.version) && snapshot.firewallEnabled === true, 'inactive/versionless firewall');
  const mutating = { conditions: [{ type: 'method', op: 'ninc', value: readMethods }] };
  const blocked = project === 'admin' ? signature : reconcile;
  const groups = project.endsWith('Legacy') ? [{ conditions: [{ type: 'path', op: 'pre', value: '/' }] }]
    : [mutating, ...['path', 'raw_path'].map(type => ({ conditions: [{ type, op: 'pre', value: blocked }] }))];
  const rule = {
    id: `rule_mutter_cutover_${project}`, name: `mutter-cutover-${project}`, active: true,
    description: 'Temporary cutover closure. Proposal only; no header bypass for old code.',
    action: { mitigate: { action: 'deny' } }, conditionGroup: groups,
  };
  requireValue(!snapshot.rules.some(r => r.id === rule.id), 'closure rule already exists; inspect drift');
  return {
    schema: 1, status: 'PROPOSAL_ONLY_NOT_APPLIED', projectId: PROJECTS[project],
    beforeVersion: snapshot.version, beforeSha256: hashJson(snapshot),
    operation: 'prepend_rule_preserving_every_existing_field', rule,
    after: { ...structuredClone(snapshot), rules: [rule, ...structuredClone(snapshot.rules)] },
    candidateExemptions: [],
  };
}

export function verifyProposalBase(proposal, current) {
  requireValue(proposal.beforeVersion === current.version && proposal.beforeSha256 === hashJson(current), 'WAF drift');
  requireValue(JSON.stringify(proposal.after.rules.slice(1)) === JSON.stringify(current.rules), 'existing rules changed');
  const withoutRules = obj => Object.fromEntries(Object.entries(obj).filter(([key]) => key !== 'rules'));
  requireValue(hashJson(withoutRules(proposal.after)) === hashJson(withoutRules(current)), 'unrelated firewall field changed');
  return true;
}

function inverse(condition) {
  return { ...condition, neg: !condition.neg };
}

function exceptSmoke(groups, conditions) {
  // DNF: deny AND NOT(A AND B...) == OR(deny AND NOT A, deny AND NOT B...).
  return groups.flatMap(group => conditions.map(condition => ({ conditions: [...group.conditions, inverse(condition)] })));
}

/** Candidate-only delta. Old canonical hosts keep the closure without a bypass. */
export function candidateSmokeProposal(snapshot, candidate) {
  requireValue(snapshot?.projectKey === `${PROJECTS.store}#active`, 'candidate belongs to store project');
  requireValue(candidate?.guardsClosed === true && literalHost(candidate.host)
    && candidate.host.endsWith('.vercel.app') && /^dpl_[a-zA-Z0-9]+$/.test(candidate.deploymentId)
    && /^[a-f0-9]{40}$/.test(candidate.head) && /^[a-f0-9]{40}$/.test(candidate.tree), 'candidate identity/closed guards');
  const common = path => [{ type: 'host', op: 'eq', value: candidate.host },
    { type: 'path', op: 'eq', value: path }, { type: 'raw_path', op: 'eq', value: path }];
  const checkoutSmoke = [...common(checkout), { type: 'method', op: 'eq', value: 'POST' },
    { type: 'header', key: RELEASE_HEADER, op: 'inc', value: ['runtime-attestation', 'read-smoke'] }];
  const reconcileSmoke = [...common(reconcile), { type: 'method', op: 'eq', value: 'GET' },
    { type: 'header', key: RELEASE_HEADER, op: 'eq', value: 'runtime-attestation' }];
  const hostId = 'rule_mutter_noncanonical_host_deny_8vomr5';
  const getId = 'rule_mutter_api_get_deny_RGNeDu';
  const closureId = 'rule_mutter_cutover_store';
  const ids = [hostId, getId, closureId];
  requireValue(snapshot.firewallEnabled === true && ids.every(id => snapshot.rules.some(r => r.id === id && r.active)), 'expected active rules missing');
  const after = structuredClone(snapshot);
  for (const rule of after.rules) {
    if (rule.id === hostId) rule.conditionGroup = exceptSmoke(exceptSmoke(rule.conditionGroup, checkoutSmoke), reconcileSmoke);
    if (rule.id === getId) rule.conditionGroup = exceptSmoke(rule.conditionGroup, reconcileSmoke);
    if (rule.id === closureId) rule.conditionGroup = rule.conditionGroup.flatMap(group =>
      exceptSmoke([group], group.conditions[0].type === 'method' ? checkoutSmoke : reconcileSmoke));
  }
  return { schema: 1, status: 'PROPOSAL_ONLY_NOT_APPLIED', projectId: PROJECTS.store,
    beforeVersion: snapshot.version, beforeSha256: hashJson(snapshot), candidate,
    modifiedRuleIds: ids, after,
    note: 'Header is a discriminator only. Secret verified in exact candidate handlers. Existing unrelated denies remain effective; provider validation/readback required.' };
}

/** Deliberate post-drain phase: permit authenticated reconciler, keep buyers/Admin closed. */
export function reconciliationProposal(snapshot, phase) {
  requireValue(snapshot?.projectKey === `${PROJECTS.store}#active` && snapshot.firewallEnabled === true, 'reconciliation firewall project');
  requireValue(phase?.controlState === 'reconciling' && phase.newPairVerified === true
    && /^[a-zA-Z0-9_-]{16,100}$/.test(phase.revision) && Array.isArray(phase.hosts)
    && phase.hosts.length > 0 && phase.hosts.length <= 2 && new Set(phase.hosts).size === phase.hosts.length
    && phase.hosts.every(literalHost), 'reconciliation phase/host identity');
  requireValue(Array.isArray(phase.deploymentIds) && phase.deploymentIds.length === phase.hosts.length
    && phase.deploymentIds.every(id => /^dpl_[a-zA-Z0-9]+$/.test(id)), 'reconciliation deployments');
  const ids = ['rule_mutter_noncanonical_host_deny_8vomr5', 'rule_mutter_api_get_deny_RGNeDu', 'rule_mutter_cutover_store'];
  requireValue(ids.every(id => snapshot.rules.some(rule => rule.id === id && rule.active)), 'reconciliation rules missing');
  const allowed = [{ type: 'host', op: 'inc', value: phase.hosts }, { type: 'method', op: 'eq', value: 'GET' },
    { type: 'path', op: 'eq', value: reconcile }, { type: 'raw_path', op: 'eq', value: reconcile }];
  const after = structuredClone(snapshot);
  for (const rule of after.rules) if (ids.includes(rule.id)) rule.conditionGroup = exceptSmoke(rule.conditionGroup, allowed);
  return { schema: 1, status: 'PROPOSAL_ONLY_NOT_APPLIED', projectId: PROJECTS.store,
    beforeVersion: snapshot.version, beforeSha256: hashJson(snapshot), phase, modifiedRuleIds: ids, after,
    note: 'No authentication bypass. Reconciler verifies CRON_SECRET and control state. All purchase/Admin/direct-client writers remain closed until state open.' };
}
