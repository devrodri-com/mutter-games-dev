import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticInstallation } from './fixtures.mjs';
import { bindContainment, editSource, syntheticSequenceClosure } from './containment-fixtures.mjs';
import { verifyInstallationIsolation, verifyContainment } from './containment.mjs';
import { evaluateFirstCutover } from './policy.mjs';
import { digest, LEGACY_ACCOUNTS } from './common.mjs';

for (const method of ['PROJECT_DENY', 'ALLOW_ABSENCE_V1']) test(`${method}: IAM grant precedes credential closure without claiming runtime readiness`, () => {
  const input = syntheticInstallation(method), original = structuredClone(input);
  assert.equal(input.identity.runtimeVerified, false);
  const receipt = verifyInstallationIsolation(input.containment, input);
  assert.equal(receipt.status, 'IAM_INSTALLATION_DOCUMENTS_CONSISTENT');
  assert.equal(receipt.credentialRoutesClosed, false);
  assert.equal(receipt.candidateRuntimeGranted, true);
  assert.equal(receipt.evidenceSha256, digest(input.containment));
  assert.equal(receipt.candidateGrantedAtMs > receipt.containedAtMs, true);
  assert.equal(receipt.remoteEnforcementAttestedByThisTool, false);
  assert.deepEqual(receipt.credentials, input.containment.credentials);
  assert.equal(receipt.credentials.unresolved, 2);
  assert.deepEqual(receipt.credentials.families.filter(f => f.disposition === 'PENDING_TREATMENT').map(f => f.family),
    ['SIGNED_JWT_AND_BLOB', 'FIREBASE_SESSIONS']);
  assert.deepEqual(input, original);
  assert.throws(() => verifyContainment(input.containment, input), /credential inventory must remain pending/);
  assert.throws(() => evaluateFirstCutover(input), /uncontained identity/);
  const runtimeChecked = structuredClone(input);
  runtimeChecked.identity.runtimeVerified = true;
  runtimeChecked.identity.noOtherUncontainedAuthority = true;
  assert.throws(() => evaluateFirstCutover(runtimeChecked), /credential inventory must remain pending/);
  const closed = syntheticSequenceClosure(input);
  assert.deepEqual(closed.containment.installationCredentials, input.containment.credentials);
  assert.equal(closed.containment.review.reviewedAtMs > receipt.candidateGrantedAtMs, true);
  assert.equal(closed.containment.review.reviewedAtMs > input.nowMs, true);
  assert.equal(verifyContainment(closed.containment, closed).status, 'CONTAINMENT_DOCUMENTS_CONSISTENT');
  assert.equal(evaluateFirstCutover(closed).status, 'FIRST_CUTOVER_EVIDENCE_CONSISTENT');
});

const rejectedInputs = {
  absentPhase: input => { delete input.phase; },
  unknownPhase: input => { input.phase = 'AUTO_FALLBACK'; },
  otherProject: input => { input.project = 'other-project'; },
  missingTarget: input => { delete input.targets.admin; },
  malformedTarget: input => { input.targets.store.tree = 'wrong'; },
  expiredWindow: input => { input.window.expiresAtMs = input.nowMs; },
  missingWindow: input => { delete input.window; },
  missingBarrier: input => { input.barriers.pop(); },
  openBarrier: input => { input.barriers[0].state = 'open'; },
  staleBarrier: input => { input.barriers[0].observedAtMs = input.nowMs - input.maxAgeMs - 1; },
  missingReadback: input => { input.barriers[0].readbackMatches = false; },
  missingEnforcement: input => { input.barriers[0].enforcementEvidence = false; },
  missingDelegation: input => { input.delegation.noUnresolvedEscape = false; },
  unboundDelegation: input => { input.delegation.candidateGrantedAtMs = 1; },
  pendingMarkedClosed: input => { input.containment.credentials.status = 'REVIEWED_NO_UNRESOLVED_ROUTE'; input.containment.credentials.unresolved = 0; },
  pendingCountWrong: input => { input.containment.credentials.unresolved = 1; },
  firebaseMarkedClosed: input => { input.containment.credentials.families.find(f => f.family === 'FIREBASE_SESSIONS').disposition = 'NO_RELEVANT_AUTHORITY_WITH_EVIDENCE'; input.containment.credentials.unresolved = 1; },
  signedClaimWithNoEvidence: input => { const family = input.containment.credentials.families.find(f => f.family === 'SIGNED_JWT_AND_BLOB'); family.disposition = 'BOUNDED_VALIDITY_AND_ISSUANCE_CLOSED'; input.containment.credentials.unresolved = 1; },
  pendingWithFinalReview: input => { input.containment.review = structuredClone(input.containment.installationReview); },
  missingIamReview: input => { delete input.containment.installationReview; },
  preexistingCandidate: input => { input.containment.credentials.families[1].representedPrincipals = [input.identity.candidate]; },
};
for (const [name, change] of Object.entries(rejectedInputs)) test(`controlled installation rejects ${name}`, () => {
  const input = syntheticInstallation(); change(input);
  assert.throws(() => verifyInstallationIsolation(input.containment, input), /BLOCKED/);
});

for (const method of ['PROJECT_DENY', 'ALLOW_ABSENCE_V1']) test(`${method}: pending install keeps all IAM source and grant restrictions`, () => {
  for (const change of [
    input => editSource(input.containment.resourcePolicies[0], 'response', policy => {
      policy.bindings.push({ role: 'roles/iam.serviceAccountTokenCreator', members: [`serviceAccount:${LEGACY_ACCOUNTS[0]}`] });
    }),
    input => editSource(input.containment.candidate.grantedProject, 'response', policy => {
      policy.bindings.push({ role: 'roles/editor', members: [`serviceAccount:${input.identity.candidate}`] });
    }),
    input => { input.containment.negativeProofs[0].update.negative.httpStatus = 401; },
    input => { input.containment.candidate.grantedProject.observedAtMs = input.containment.installationReview.reviewedAtMs; },
  ]) {
    const input = syntheticInstallation(method); change(input);
    assert.throws(() => verifyInstallationIsolation(input.containment, input), /BLOCKED/);
  }
});

test('final closure cannot be claimed by a direct-filter result or by dropping the IAM stage', () => {
  for (const change of [
    input => { input.containment.credentials = structuredClone(input.containment.installationCredentials);
      input.containment.credentials.status = 'REVIEWED_NO_UNRESOLVED_ROUTE'; input.containment.credentials.unresolved = 0; },
    input => { input.containment.credentials.families.find(f => f.family === 'FIREBASE_SESSIONS').disposition = 'CUSTOM_SIGN_IN_FILTER_APPLIED'; },
    input => { delete input.containment.installationReview; },
    input => { input.containment.credentials.families[2].validUntilMs = input.nowMs + 1; },
    input => { input.containment.credentials.families[2].sourceSha256 = ['f'.repeat(64)]; },
    input => { for (const family of input.containment.credentials.families) family.reviewedAtMs = input.containment.candidate.grantedProject.observedAtMs - 1; },
    input => { input.containment.installationCredentials.unresolved = 0; },
  ]) {
    const input = syntheticSequenceClosure(syntheticInstallation()); change(input); bindContainment(input);
    assert.throws(() => verifyContainment(input.containment, input), /BLOCKED/);
  }
});
