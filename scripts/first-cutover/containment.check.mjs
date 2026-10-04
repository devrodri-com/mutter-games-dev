import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { evaluateFirstCutover, verifyReceiptFiles } from './policy.mjs';
import { syntheticEvidence } from './fixtures.mjs';
import { syntheticContainment, editSource, policyRead } from './containment-fixtures.mjs';
import { legacyAllowProposal, verifyAllowBase, verifyAllowAfter, READER_ROLE } from './authority.mjs';
import { readPolicy, PROJECT_RESOURCE, OPERATOR } from './iam-evidence.mjs';
import { digest, LEGACY_ACCOUNTS, DATABASE } from './common.mjs';
const require = createRequire(import.meta.url);
const { publicationCheck, PublicationBlocked } = require('../release-gate/publication.cjs');
const { failureResult } = require('../release-gate/cli.cjs');
const clone = value => structuredClone(value);
const options = { requestedPolicyVersion: 3, responseComplete: true };
const context = e => ({ synthetic: true, revision: e.revision, window: e.window, nowMs: e.nowMs, maxAgeMs: e.maxAgeMs });

for (const method of ['ALLOW_ABSENCE_V1', 'PROJECT_DENY']) for (const version of [1, 3]) test(`${method} wire v${version}: documentary success never claims real enforcement`, () => {
  const e = syntheticContainment(syntheticEvidence(), method, version), result = evaluateFirstCutover(e);
  assert.equal(result.containment.method, method);
  assert.equal(result.containment.remoteEnforcementAttestedByThisTool, false);
  assert.equal(result.applicationAuthorizedByThisTool, false);
  assert.equal(result.globalTerminationProven, false);
  assert.equal(e.containment.candidate.grantedProject.observedAtMs > e.containment.review.reviewedAtMs, true);
});

const cases = {
  missingMethod: e => delete e.containment.method,
  foreignMethod: e => { e.containment.method = 'AUTO_FALLBACK'; },
  booleanOnly: e => { delete e.containment; },
  otherProject: e => { e.containment.projectNumber = '1'; },
  hiddenParent: e => editSource(e.containment.projectSource, 'request', v => { v.query.fields = 'projectId,projectNumber'; }),
  parentOrganization: e => editSource(e.containment.projectSource, 'response', v => { v.parent = { type: 'organization', id: '123' }; }),
  projection: e => { e.containment.allow.before.responseComplete = false; },
  conditionProjection: e => editSource(e.containment.allow.before, 'request', v => { v.body.readMask = 'bindings.role'; }),
  absentEtag: e => editSource(e.containment.allow.before, 'response', v => { delete v.etag; }),
  concurrentEtag: e => editSource(e.containment.allow.freshBase, 'response', v => { v.etag = 'concurrent'; }),
  wrongResource: e => editSource(e.containment.allow.before, 'request', v => { v.resource = 'projects/other'; }),
  otherOperator: e => { e.containment.projectSource.channel.principal = 'other@example.invalid'; },
  noProvenance: e => { delete e.containment.projectSource.channel; },
  failedRead: e => { e.containment.resourcePolicies[0].httpStatus = 403; },
  unknownSource: e => { e.containment.projectSource.origin = 'UI_TABLE'; },
  rawTamper: e => { e.containment.allow.before.responseRaw += ' '; },
  missingRequestV3: e => editSource(e.containment.allow.before, 'request', v => { delete v.body.options; }),
  unknownWire: e => editSource(e.containment.allow.before, 'response', v => { v.version = 2; }),
  extraRole: e => editSource(e.containment.allow.before, 'response', v => { v.bindings.push({ role: 'roles/owner', members: [`serviceAccount:${LEGACY_ACCOUNTS[0]}`] }); }),
  roleForWrongLegacy: e => editSource(e.containment.allow.before, 'response', v => { v.bindings[0].members.push(`serviceAccount:${LEGACY_ACCOUNTS[0]}`); }),
  relevantCondition: e => editSource(e.containment.allow.before, 'response', v => { v.bindings[0].condition = { expression: 'true' }; }),
  staleAfterEtag: e => editSource(e.containment.allow.readback, 'response', v => { v.etag = 'synthetic-before'; }),
  readbackContradiction: e => editSource(e.containment.allow.readback, 'response', v => { v.etag = 'another-after'; }),
  loseAuditConfigs: e => editSource(e.containment.allow.readback, 'response', v => { v.auditConfigs = []; }),
  foreignMembershipLost: e => editSource(e.containment.allow.readback, 'response', v => { v.bindings.shift(); }),
  resourceGrant: e => editSource(e.containment.resourcePolicies[0], 'response', v => { v.bindings.push({ role: 'roles/iam.serviceAccountTokenCreator', members: [`serviceAccount:${LEGACY_ACCOUNTS[1]}`] }); }),
  fireStorePolicyGrant: e => { e.containment.databasePolicy = { ...e.containment.databasePolicy, mode: 'RESOURCE_POLICY', readback: policyRead(e, DATABASE,
    { version: 3, etag: 'synthetic', bindings: [{ role: 'roles/datastore.user', members: [`serviceAccount:${LEGACY_ACCOUNTS[0]}`] }] }, 100031) }; editSource(e.containment.databasePolicy.apiSurface, 'response', v => { Object.assign(v.resources.projects.resources.databases.methods, { getIamPolicy: {}, setIamPolicy: {} }); }); },
  missingDatabaseSurface: e => { delete e.containment.databasePolicy; },
  databaseIamNowExists: e => editSource(e.containment.databasePolicy.apiSurface, 'response', v => { v.resources.projects.resources.databases.methods.getIamPolicy = {}; }),
  unexhaustedAccounts: e => editSource(e.containment.accountPages[0], 'response', v => { v.nextPageToken = 'next'; }),
  extraAccountUnreviewed: e => editSource(e.containment.accountPages[0], 'response', v => { v.accounts.push({ ...v.accounts[0], uniqueId: 'extra', email: 'extra@mutter-games.iam.gserviceaccount.com', name: 'projects/mutter-games/serviceAccounts/extra@mutter-games.iam.gserviceaccount.com' }); }),
  broadenRole: e => editSource(e.containment.roles[0], 'response', v => { v.includedPermissions.push('datastore.entities.update'); }),
  wrongCredentialScope: e => { e.containment.negativeProofs[0].credential.oauthScopes = ['readonly']; },
  mixedCredential: e => { e.containment.negativeProofs[0].update.negative.channel.credentialRef = 'different-token'; },
  negativeOwner: e => { e.containment.negativeProofs[0].update.negative.channel.principal = OPERATOR; },
  negative401: e => { e.containment.negativeProofs[0].update.negative.httpStatus = 401; },
  timeout: e => { e.containment.negativeProofs[0].update.negative.httpStatus = null; },
  negativePrecondition: e => editSource(e.containment.negativeProofs[0].update.negative, 'response', v => { v.error.status = 'FAILED_PRECONDITION'; }),
  positiveDenied: e => editSource(e.containment.negativeProofs[0].update.positive, 'response', v => { v.error.status = 'PERMISSION_DENIED'; }),
  positiveDifferentRequest: e => editSource(e.containment.negativeProofs[0].update.positive, 'request', v => { v.body.writes[0].update.name += 'x'; }),
  nativeGrantRemains: e => editSource(e.containment.negativeProofs[0].evaluations[1].denied, 'response', v => { v.permissions = ['iam.serviceAccounts.getAccessToken']; }),
  unsupportedPermission: e => editSource(e.containment.negativeProofs[0].evaluations[0].support[0], 'response', v => { v.permissions.pop(); }),
  permissionTailOnly: e => editSource(e.containment.negativeProofs[0].evaluations[0].support[0], 'request', v => { v.body.pageToken = 'unseen-first-page'; }),
  permissionNextPage: e => editSource(e.containment.negativeProofs[0].evaluations[0].support[0], 'response', v => { v.nextPageToken = 'unread'; }),
  unknownNativeEvaluation: e => { e.containment.negativeProofs[0].evaluations[0].review.unresolved = 1; },
  grantBeforeContainment: e => { e.containment.candidate.grantedProject.observedAtMs = 100001; },
  candidateRestoreGrant: e => editSource(e.containment.candidate.restrictedPolicy, 'response', v => { v.bindings.push({ role: 'roles/iam.serviceAccountAdmin', members: ['group:unknown@example.invalid'] }); }),
  earlyCandidate: e => editSource(e.containment.candidate.noGrantProject, 'response', v => { v.bindings.push({ role: READER_ROLE, members: ['serviceAccount:mutter-stock-runtime-v1@mutter-games.iam.gserviceaccount.com'] }); }),
  delegationChronologyUnbound: e => { e.delegation.candidateGrantedAtMs = 1; },
  keyDeletionRevokesAll: e => { e.containment.credentials.keyDeletionRevokesIssuedTokens = true; },
  tokenCreatorRevokesAll: e => { e.containment.credentials.tokenCreatorRemovalRevokesIssuedTokens = true; },
  untreatedForeignTokens: e => { e.containment.credentials.families[1].disposition = 'UNKNOWN'; },
  onlyWait: e => { e.containment.credentials.families[1].disposition = 'WAITED_ONE_HOUR'; },
  universalTtl: e => { e.containment.credentials.families[2].disposition = 'BOUNDED_VALIDITY_AND_ISSUANCE_CLOSED'; },
  indirectRoute: e => { e.containment.review.unresolved = ['unreviewed group membership']; },
  missingServiceLaunch: e => { e.containment.review.coverage.splice(2, 1); },
  staleReview: e => { e.containment.review.windowSha256 = 'a'.repeat(64); },
  notBoundToSources: e => { e.containment.review.sourceSha256.pop(); },
  beforeEntriesClosed: e => { e.containment.allow.freshBase.observedAtMs = 99999; },
  mutationResponseOnly: e => { e.containment.allow.readback = clone(e.containment.allow.application); },
};
for (const [name, mutate] of Object.entries(cases)) test(`reject ${name}`, () => {
  const e = syntheticEvidence(); mutate(e);
  assert.throws(() => evaluateFirstCutover(e), /BLOCKED/);
});

test('wire v1 requires v3 request, never masks conditions or rewrites original bytes', () => {
  const e = syntheticContainment(syntheticEvidence(), 'ALLOW_ABSENCE_V1', 1), receipt = e.containment.allow.before;
  const raw = receipt.responseRaw, hash = receipt.responseSha256;
  assert.equal(readPolicy(receipt, PROJECT_RESOURCE, context(e)).version, 1);
  legacyAllowProposal(JSON.parse(raw), options); assert.equal(receipt.responseRaw, raw); assert.equal(receipt.responseSha256, hash);
  const noContext = JSON.parse(raw); assert.throws(() => legacyAllowProposal(noContext), /complete v3 request/);
  for (const change of [p => { p.bindings[0].role += '_withcond_deadbeef'; }, p => { p.bindings[0].condition = { expression: 'true' }; }]) {
    const bad = clone(receipt); editSource(bad, 'response', change); assert.throws(() => readPolicy(bad, PROJECT_RESOURCE, context(e)), /condition/);
  }
});
test('foreign conditional grants and auditConfigs survive exactly; before/after are distinct', () => {
  const e = syntheticEvidence(), before = JSON.parse(e.containment.allow.before.responseRaw);
  before.bindings.push({ role: 'roles/viewer', members: ['user:third@example.invalid'], condition: { title: 'keep', expression: 'true' } });
  const p = legacyAllowProposal(before), after = { ...clone(p.after), etag: 'new-etag' };
  assert.equal(verifyAllowBase(p, before), true); assert.equal(verifyAllowAfter(p, before, after), true);
  assert.deepEqual(after.auditConfigs, before.auditConfigs); assert.deepEqual(after.bindings.find(b => b.condition), before.bindings.at(-1));
  assert.throws(() => verifyAllowBase(p, after), /drift/); assert.throws(() => verifyAllowAfter(p, before, before), /after drift/);
  const tampered = clone(p); tampered.after.auditConfigs = []; assert.throws(() => verifyAllowBase(tampered, before), /tampering/);
});
test('PROJECT_DENY cannot pass altered rules, absent readback or relabelled allow', () => {
  for (const change of [e => { delete e.containment.deny; }, e => editSource(e.containment.deny.readback, 'response', r => { r.rules = []; })]) {
    const e = syntheticContainment(syntheticEvidence(), 'PROJECT_DENY'); change(e); assert.throws(() => evaluateFirstCutover(e), /BLOCKED/);
  }
});
test('receipt integrity rejects synthetic observations even when outer receipt looks reviewed', async () => {
  await assert.rejects(verifyReceiptFiles(syntheticEvidence(), import.meta.filename), /synthetic cutover/);
});
test('native location for service-account v3 options is mandatory', () => {
  const e = syntheticEvidence(), receipt = clone(e.containment.resourcePolicies[0]);
  editSource(receipt, 'request', r => { r.body.options = { requestedPolicyVersion: 3 }; delete r.query['options.requestedPolicyVersion']; });
  assert.throws(() => readPolicy(receipt, JSON.parse(receipt.requestRaw).resource, context(e)), /native location/);
});
test('CLI produces versioned proposal and separately verifies before/after; never applies', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'mutter-allow-cli-'));
  try {
    const e = syntheticEvidence(), bundle = { context: context(e), before: e.containment.allow.before,
      fresh: e.containment.allow.freshBase, proposal: e.containment.allow.proposal }, file = join(temp, 'input.json');
    await writeFile(file, JSON.stringify(bundle));
    const run = command => spawnSync(process.execPath, [resolve('scripts/first-cutover/cli.mjs'), command, file], { encoding: 'utf8' });
    const proposed = run('propose-allow'); assert.equal(proposed.status, 0, proposed.stderr);
    assert.deepEqual(JSON.parse(proposed.stdout).proposal, bundle.proposal);
    assert.equal(run('verify-allow-base').status, 0);
    bundle.fresh = e.containment.allow.readback; await writeFile(file, JSON.stringify(bundle));
    assert.equal(run('verify-allow-after').status, 0); assert.equal(run('verify-allow-base').status, 1);
    assert.equal(run('apply').status, 1);
    const evaluate = run('evaluate'); assert.equal(evaluate.status, 1); assert.match(evaluate.stderr, /publication-config/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('publication requires new exact review and operational containment; technical PASS remains distinct', async () => {
  const technical = { RELEASE_TECHNICAL_GATE_STATUS: 'PASS' };
  await assert.rejects(publicationCheck({}, technical), /Independent review/);
  const temp = await mkdtemp(join(tmpdir(), 'mutter-allow-publication-'));
  try {
    const e = syntheticEvidence(); e.nowMs = Date.now();
    const report = `RODRI_AUDIT_STATUS=PASS_READY_FOR_OWNER_DECISION\n${e.targets.store.head}\n${e.targets.store.tree}\nSynthetic entrypoint exercise only`;
    technical.targets = e.targets; technical.artifact = { tarSha256: e.artifact.sha256, officialDigest: 'sha256:synthetic' };
    const review = { status: 'PASS_EXACT_TARGET', targets: e.targets, reportPath: 'report.md', reportSha256: digest(report), artifactDigest: technical.artifact.officialDigest };
    e.audit.evidenceSha256 = review.reportSha256;
    const authorization = `Synthetic only ${e.targets.store.head}`;
    e.applicationAuthorization = { sha256: digest(authorization), status: 'EXPLICIT_CURRENT_CUTOVER_AUTHORIZATION' };
    const config = { storeRoot: resolve('.'), reviewFile: join(temp, 'review.json'), cutoverEvidenceFile: join(temp, 'evidence.json'), cutoverAuthorizationFile: join(temp, 'authority.txt') };
    await writeFile(join(temp, 'report.md'), report); await writeFile(config.reviewFile, JSON.stringify(review));
    await writeFile(config.cutoverAuthorizationFile, authorization);
    // A stale review is rejected before operational evidence is interpreted.
    review.targets = { ...e.targets, store: { ...e.targets.store, head: 'f'.repeat(40) } };
    await writeFile(config.reviewFile, JSON.stringify(review)); await writeFile(config.cutoverEvidenceFile, JSON.stringify(e));
    await assert.rejects(publicationCheck(config, technical), /another pair/);
    review.targets = e.targets; await writeFile(config.reviewFile, JSON.stringify(review));
    // Freshly time-bind the synthetic evidence but remove its new containment.
    e.window.expiresAtMs = e.nowMs + 60000; e.maxAgeMs = e.nowMs; delete e.containment;
    await writeFile(config.cutoverEvidenceFile, JSON.stringify(e));
    try { await publicationCheck(config, technical); assert.fail('missing containment accepted'); }
    catch (err) {
      assert.match(err.message, /explicit containment method/);
      const result = failureResult(new PublicationBlocked(err));
      assert.equal(result.RELEASE_TECHNICAL_GATE_STATUS, 'PASS'); assert.equal(result.PUBLICATION_PREREQUISITES, 'NOT_VERIFIED');
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
});
