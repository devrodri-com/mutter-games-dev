import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { PROJECT, DATABASE, PLANNED_ACCOUNT, LEGACY_ACCOUNTS, DECISION, DECISION_CONTRACT_SHA256, demand, digest, isHash, canonical } from './common.mjs';
import { PROJECTS } from '../release-cutover/policy.mjs';
import { verifyContainment } from './containment.mjs';
import { effectiveFunctions } from '../release-cutover/drain.mjs';
import { REQUIRED_BARRIERS } from './installation-isolation.mjs';

export { REQUIRED_BARRIERS } from './installation-isolation.mjs';
const ms = v => Number.isSafeInteger(v) && v >= 0;
const sha = v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
/** Evaluates evidence consistency, not provider enforcement. The CLI additionally
 * binds every receipt to private source files. Strict drain remains untouched.
 */
export function evaluateFirstCutover(input) {
  demand(input?.schema === 1 && input.policy === 'FIRST_CUTOVER_RISK_MANAGED_V1', 'first cutover policy identity');
  demand(input.decision?.id === DECISION && input.decision.residual === 'PRE_BARRIER_ADMITTED_WRITE_WITH_LOST_RESPONSE'
    && input.decision.acceptedBy === 'Rodrigo' && input.decision.firstCutoverOnly === true && input.decision.sourceSha256 === DECISION_CONTRACT_SHA256, 'missing/foreign risk decision');
  demand(input.project === PROJECT && input.database === DATABASE && ms(input.nowMs) && ms(input.maxAgeMs) && input.maxAgeMs > 0, 'project/time identity');
  demand(input.strictDrainProof === 'NOT_VERIFIED_WITH_AVAILABLE_CHANNELS', 'strict proof cannot be promoted by waiver');
  demand(input.audit?.status === 'PASS_EXACT_TARGET' && isHash(input.audit.evidenceSha256), 'independent audit required for application evidence');
  for (const key of ['store', 'admin']) {
    const t = input.targets?.[key];
    demand(sha(t?.head) && sha(t.tree) && t.head === input.audit[key]?.head && t.tree === input.audit[key]?.tree, 'target/audit mismatch');
  }
  demand(input.artifact?.complete === true && input.artifact.verified === true && isHash(input.artifact.sha256)
    && input.artifact.head === input.targets.store.head && input.artifact.tree === input.targets.store.tree, 'incomplete/wrong artifact');
  demand(input.identity?.candidate === PLANNED_ACCOUNT && input.identity.runtimeVerified === true
    && canonical([...input.identity.legacy].sort()) === canonical([...LEGACY_ACCOUNTS].sort())
    && input.identity.noOtherUncontainedAuthority === true, 'wrong or uncontained identity');
  demand(ms(input.window?.confirmedAtMs) && input.window.confirmedAtMs <= input.nowMs
    && input.nowMs < input.window.expiresAtMs && input.window.johnNotEditing === true
    && input.window.otherHumanWritersStopped === true, 'coordination expired/missing');
  demand(Array.isArray(input.barriers) && input.barriers.length === REQUIRED_BARRIERS.length
    && new Set(input.barriers.map(b => b.scope)).size === REQUIRED_BARRIERS.length, 'barrier coverage');
  let closedAt = 0;
  for (const scope of REQUIRED_BARRIERS) {
    const b = input.barriers.find(b => b.scope === scope);
    demand(b?.state === 'closed' && b.revision === input.revision && typeof b.version === 'string' && b.version
      && ms(b.observedAtMs) && b.observedAtMs <= input.nowMs && input.nowMs - b.observedAtMs <= input.maxAgeMs
      && b.readbackMatches === true && b.enforcementEvidence === true && isHash(b.evidenceSha256), `barrier missing/contradictory: ${scope}`);
    closedAt = Math.max(closedAt, b.observedAtMs);
  }
  demand(typeof input.revision === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(input.revision), 'revision');
  demand(input.delegation?.containedBeforeCandidateGrant === true && input.delegation.resourceAndInheritedBindingsReviewed === true
    && input.delegation.legacyElevatedAllowsRemoved === true && input.delegation.noUnresolvedEscape === true, 'delegation not contained');
  const containment = verifyContainment(input.containment, input);
  demand(input.admissions?.observedOldAdmissionsAfterClose === 0 && input.admissions.unresolvedMixedAuthOperations === 0
    && input.admissions.unexplainedCandidateErrors === 0, 'unaccepted admission/Auth/candidate problem');
  const ops = input.operations;
  demand(ops?.status === 'VERIFIED' && ops.resource === `${DATABASE}/operations` && ops.pages >= 1
    && ops.nextPageToken === null && Array.isArray(ops.unreachable) && ops.unreachable.length === 0
    && ops.active === 0 && ops.unresolved === 0 && ms(ops.observedAtMs) && ops.observedAtMs >= closedAt
    && ops.observedAtMs <= input.nowMs && input.nowMs - ops.observedAtMs <= input.maxAgeMs, 'administrative operations unknown/active');
  const functions = effectiveFunctions(input.functionSnapshots);
  demand(Object.values(PROJECTS).every(p => functions.some(f => f.projectId === p)), 'effective writer durations incomplete');
  demand(ms(input.margin?.milliseconds) && input.margin.milliseconds > 0 && input.margin.justification?.length >= 30, 'operational margin unjustified');
  const waitUntil = closedAt + Math.max(...functions.map(f => f.timeoutSeconds)) * 1000 + input.margin.milliseconds;
  demand(input.nowMs >= waitUntil, 'operational mitigation interval not elapsed');
  const b = input.backup;
  demand(b?.project === PROJECT && b.database === '(default)' && b.complete === true && b.verifiedHashes === true
    && b.localRecoveryVerified === true && b.finalCaptureStartedAtMs >= closedAt && b.finalCaptureFinishedAtMs <= input.nowMs
    && b.finalCaptureFinishedAtMs >= b.finalCaptureStartedAtMs && b.readbackStable === true && isHash(b.manifestSha256), 'backup/final readback incomplete');
  demand(input.comparison?.unresolved === 0 && input.comparison.uncertainOrdersUnresolved === 0
    && input.comparison.reservationSafe === true && input.comparison.checkedAtMs >= b.finalCaptureFinishedAtMs
    && input.comparison.checkedAtMs <= input.nowMs, 'unresolved commercial discrepancy');
  demand(input.recovery?.selectiveOnly === true && input.recovery.noBlindRecreate === true && input.recovery.versionAndDependenciesChecked === true
    && input.recovery.rollbackPreservesReservations === true, 'unsafe repair/rollback');
  return { status: 'FIRST_CUTOVER_EVIDENCE_CONSISTENT', containment, strictDrainProof: input.strictDrainProof,
    residual: 'OWNER_ACCEPTED_FIRST_CUTOVER_ONLY_WITH_CONDITIONS', waitUntilMs: waitUntil,
    globalTerminationProven: false, remoteEnforcementAttestedByThisTool: false, applicationAuthorizedByThisTool: false };
}

export async function verifyReceiptFiles(input, file) {
  demand(input.synthetic !== true, 'synthetic cutover cannot be published');
  const root = await realpath(dirname(file));
  demand(Array.isArray(input.receipts) && input.receipts.length > 0, 'primary receipts missing');
  const required = ['decision', 'audit', 'artifact', 'identity', 'window', 'containment', 'barriers', 'delegation', 'admissions', 'operations', 'functionSnapshots', 'margin', 'backup', 'comparison', 'recovery'];
  demand(input.receipts.length === required.length && new Set(input.receipts.map(r => r.section)).size === required.length, 'receipt sections incomplete');
  for (const key of required) {
    const r = input.receipts.find(r => r.section === key);
    demand(r && typeof r.path === 'string' && !isAbsolute(r.path) && !r.path.split(/[\\/]/).includes('..') && isHash(r.sha256), 'unsafe receipt reference');
    const path = await realpath(resolve(root, r.path)); const local = relative(root, path);
    demand(local && !local.startsWith('..') && !isAbsolute(local), 'receipt outside package');
    const bytes = await readFile(path); demand(digest(bytes) === r.sha256, 'receipt integrity');
    const receipt = JSON.parse(bytes);
    demand(receipt.synthetic !== true && receipt.provenanceReviewed === true && typeof receipt.primarySource === 'string'
      && receipt.primarySource.length > 0 && canonical(receipt.observation) === canonical(input[key]), 'unbound/synthetic receipt');
  }
  return { status: 'LOCAL_RECEIPT_INTEGRITY_ONLY', providerAuthenticityRequiresIndependentReview: true };
}
