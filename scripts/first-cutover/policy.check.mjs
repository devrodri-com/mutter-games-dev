import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateFirstCutover, verifyReceiptFiles } from './policy.mjs';
import { containmentProposal, legacyAllowProposal, verifyAllowBase, DENIED_PERMISSIONS } from './authority.mjs';
import { syntheticEvidence } from './fixtures.mjs';
import { LEGACY_ACCOUNTS } from './common.mjs';

test('accepted old lost-response residual remains distinct from strict drain', () => {
  const result = evaluateFirstCutover(syntheticEvidence());
  assert.equal(result.status, 'FIRST_CUTOVER_EVIDENCE_CONSISTENT');
  assert.equal(result.globalTerminationProven, false);
  assert.equal(result.applicationAuthorizedByThisTool, false);
  assert.equal(result.strictDrainProof, 'NOT_VERIFIED_WITH_AVAILABLE_CHANNELS');
});
const negatives = {
  absentDecision: e => delete e.decision,
  foreignDecision: e => { e.decision.id = 'another-cutover'; },
  changedWaiver: e => { e.decision.residual = 'ALL_OLD_WRITES'; },
  strictPromoted: e => { e.strictDrainProof = 'PASS'; },
  unaudited: e => { e.audit.status = 'PENDING'; },
  wrongIdentity: e => { e.identity.candidate = LEGACY_ACCOUNTS[0]; },
  wrongBackup: e => { e.backup.project = 'other'; },
  incompleteBackup: e => { e.backup.complete = false; },
  oldAdmission: e => { e.admissions.observedOldAdmissionsAfterClose = 1; },
  mixedAuth: e => { e.admissions.unresolvedMixedAuthOperations = 1; },
  delegation: e => { e.delegation.containedBeforeCandidateGrant = false; },
  inheritedEscape: e => { e.delegation.resourceAndInheritedBindingsReviewed = false; },
  editorLeft: e => { e.delegation.legacyElevatedAllowsRemoved = false; },
  operationsUnknown: e => { e.operations.status = 'NOT_VERIFIED'; },
  operationsActive: e => { e.operations.active = 1; },
  operationsPage: e => { e.operations.nextPageToken = 'more'; },
  operationsUnreachable: e => { e.operations.unreachable = ['region']; },
  operationsBeforeClose: e => { e.operations.observedAtMs = 1; },
  artifactMissing: e => { e.artifact.complete = false; },
  artifactWrongTree: e => { e.artifact.tree = 'c'.repeat(40); },
  barrierContradiction: e => { e.barriers[0].revision = 'other'; },
  noEnforcement: e => { e.barriers[0].enforcementEvidence = false; },
  commercialMismatch: e => { e.comparison.unresolved = 1; },
  uncertainOrder: e => { e.comparison.uncertainOrdersUnresolved = 1; },
  unsafeRepair: e => { e.recovery.versionAndDependenciesChecked = false; },
  expiredCoordination: e => { e.window.expiresAtMs = 1; },
  onlyWait: e => { e.nowMs = 999999; e.barriers = []; },
  backupBeforeClose: e => { e.backup.finalCaptureStartedAtMs = 1; },
  missingFunctions: e => { e.functionSnapshots.pop(); },
};
for (const [name, mutate] of Object.entries(negatives)) test(`first cutover rejects ${name}`, () => {
  const e = structuredClone(syntheticEvidence()); mutate(e); assert.throws(() => evaluateFirstCutover(e), /BLOCKED/);
});
test('CLI evidence requires primary receipts, not synthetic fixture flags', async () => {
  await assert.rejects(verifyReceiptFiles(syntheticEvidence(), import.meta.filename), /synthetic cutover/);
});
test('strict verifier source and business targets stay outside new policy', async () => {
  const source = await readFile(new URL('../release-cutover/cli.mjs', import.meta.url), 'utf8');
  assert.match(source, /status: 'NOT_VERIFIED'/); assert.match(source, /process.exitCode = 1/);
  assert.doesNotMatch(source, /FIRST_CUTOVER|OWNER_ACCEPTED/);
});
test('deny schema has exact legacy principals, no Google-agent wildcard or permissions exception', () => {
  const p = containmentProposal(DENIED_PERMISSIONS);
  assert.equal(p.deny.rules.length, 1); assert.equal(p.deny.rules[0].denyRule.deniedPrincipals.length, 2);
  assert.ok(p.deny.rules[0].denyRule.deniedPermissions.includes('iam.googleapis.com/serviceAccounts.getAccessToken'));
  assert.equal(p.candidate.status, 'PLANNED_NOT_CREATED');
  assert.throws(() => containmentProposal(DENIED_PERMISSIONS.slice(1)), /support/);
});
test('versioned allow delta removes legacy escape, preserves unrelated members and rejects drift', () => {
  const before = { version: 3, etag: 'synthetic-etag', bindings: [
    { role: 'roles/editor', members: [`serviceAccount:${LEGACY_ACCOUNTS[1]}`, 'user:synthetic@example.invalid'] },
    { role: 'roles/iam.serviceAccountTokenCreator', members: [`serviceAccount:${LEGACY_ACCOUNTS[0]}`] },
  ], auditConfigs: [] };
  const p = legacyAllowProposal(before); assert.equal(verifyAllowBase(p, before), true);
  assert.deepEqual(p.after.bindings[0].members, ['user:synthetic@example.invalid']);
  assert.throws(() => verifyAllowBase(p, { ...before, etag: 'drift' }), /drift/);
  const unknown = structuredClone(before); unknown.bindings[0].role = 'roles/owner';
  assert.throws(() => legacyAllowProposal(unknown), /unreviewed/);
});
