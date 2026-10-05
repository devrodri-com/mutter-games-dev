// Synthetic observations only. Never accepted by the production-evidence CLI.
import { PROJECT, DATABASE, ROOT, DECISION, DECISION_CONTRACT_SHA256, PLANNED_ACCOUNT, LEGACY_ACCOUNTS, digest } from './common.mjs';
import { PROJECTS } from '../release-cutover/policy.mjs';
import { syntheticContainment, pendingInstallation } from './containment-fixtures.mjs';
import { REQUIRED_BARRIERS } from './policy.mjs';
export function syntheticEvidence() {
  const h = 'a'.repeat(64); const target = { head: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const revision = 'synthetic-risk-cutover-only';
  return syntheticContainment({ synthetic: true, schema: 1, policy: 'FIRST_CUTOVER_RISK_MANAGED_V1', project: PROJECT, database: DATABASE,
    nowMs: 900000, maxAgeMs: 1000000, revision, strictDrainProof: 'NOT_VERIFIED_WITH_AVAILABLE_CHANNELS',
    decision: { id: DECISION, residual: 'PRE_BARRIER_ADMITTED_WRITE_WITH_LOST_RESPONSE', acceptedBy: 'Rodrigo', firstCutoverOnly: true, sourceSha256: DECISION_CONTRACT_SHA256 },
    targets: { store: target, admin: target }, audit: { status: 'PASS_EXACT_TARGET', evidenceSha256: h, store: target, admin: target },
    artifact: { complete: true, verified: true, sha256: h, ...target },
    identity: { candidate: PLANNED_ACCOUNT, legacy: [...LEGACY_ACCOUNTS], runtimeVerified: true, noOtherUncontainedAuthority: true },
    window: { confirmedAtMs: 0, expiresAtMs: 1000000, johnNotEditing: true, otherHumanWritersStopped: true },
    barriers: REQUIRED_BARRIERS.map(scope => ({ scope, state: 'closed', revision, version: 'synthetic', observedAtMs: 100000, readbackMatches: true, enforcementEvidence: true, evidenceSha256: h })),
    delegation: { containedBeforeCandidateGrant: true, resourceAndInheritedBindingsReviewed: true, legacyElevatedAllowsRemoved: true, noUnresolvedEscape: true },
    admissions: { observedOldAdmissionsAfterClose: 0, unresolvedMixedAuthOperations: 0, unexplainedCandidateErrors: 0 },
    operations: { status: 'VERIFIED', resource: `${DATABASE}/operations`, pages: 1, nextPageToken: null, unreachable: [], active: 0, unresolved: 0, observedAtMs: 850000 },
    functionSnapshots: Object.values(PROJECTS).map((projectId, i) => ({
      deployment: { id: `dpl_synthetic${i}`, projectId, readyState: 'READY' },
      files: [{ name: 'out', type: 'directory', children: [{ name: 'writer', type: 'lambda', uid: `fn${i}` }] }],
      builds: { builds: [{ deploymentId: `dpl_synthetic${i}`, readyState: 'READY', output: [{ type: 'lambda', path: 'writer', digest: h,
        lambda: { functionName: `fn${i}`, runtime: 'nodejs22.x', deployedTo: ['iad1'], timeout: 300 } }] }] },
    })),
    margin: { milliseconds: 300000, justification: 'Synthetic mitigation margin; not a universal provider completion deadline.' },
    backup: { project: PROJECT, database: '(default)', complete: true, verifiedHashes: true, localRecoveryVerified: true,
      finalCaptureStartedAtMs: 710000, finalCaptureFinishedAtMs: 800000, readbackStable: true, manifestSha256: h },
    comparison: { unresolved: 0, uncertainOrdersUnresolved: 0, reservationSafe: true, checkedAtMs: 820000 },
    recovery: { selectiveOnly: true, noBlindRecreate: true, versionAndDependenciesChecked: true, rollbackPreservesReservations: true },
  });
}
export function syntheticInstallation(method = 'ALLOW_ABSENCE_V1') {
  const input = syntheticEvidence();
  // One synthetic window spans installation, simulated treatment and the
  // unchanged operational mitigation required by the final cutover evaluator.
  input.window.expiresAtMs = 2000000;
  input.maxAgeMs = 2000000;
  return pendingInstallation(input, method);
}
export function product(overrides = {}) {
  return { name: `${ROOT}/products/synthetic`, createTime: '2026-10-01T00:00:00Z', updateTime: '2026-10-01T00:00:00Z',
    fields: { stockTotal: { integerValue: '5' }, active: { booleanValue: true }, webReservations: { mapValue: { fields: {} } } }, ...overrides };
}
export function incident(before, current) {
  return { schema: 1, classification: 'ACCREDITED_LEGACY_LATE_WRITE', reviewedLoss: true,
    evidenceSha256: 'a'.repeat(64), authorizationSha256: 'b'.repeat(64), explanation: 'Synthetic separately reviewed loss; does not represent a production finding.',
    path: 'products/synthetic', backupDocumentSha256: digest(before), currentDocumentSha256: current ? digest(current) : null,
    admittedAtMs: 1, barrierAtMs: 2, absenceCause: 'ACCREDITED_LOSS_NOT_LEGITIMATE_DELETE' };
}
