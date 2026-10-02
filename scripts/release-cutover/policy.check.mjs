import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTS, closureDenies, closureProposal, verifyProposalBase, candidateSmokeProposal, reconciliationProposal, wafDenies } from './policy.mjs';
import { effectiveFunctions, evaluateDrain } from './drain.mjs';
import { verifyEvidenceFiles } from './evidence.mjs';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const request = (changes = {}) => ({ host: 'muttergames.com', method: 'POST', path: '/api/create-mp-preference', rawPath: '/api/create-mp-preference', headers: {}, ...changes });
const candidate = { host: 'mutter-candidate.vercel.app', deploymentId: 'dpl_candidate', head: 'a'.repeat(40), tree: 'b'.repeat(40), guardsClosed: true };
const evidence = { source: 'synthetic-positive-fixture', sha256: 'a'.repeat(64) };
const rule = (id, conditions) => ({ id, active: true, action: { mitigate: { action: 'deny' } }, conditionGroup: [{ conditions }] });
const firewall = () => ({ projectKey: `${PROJECTS.store}#active`, version: 4, firewallEnabled: true, rules: [
  rule('rule_mutter_noncanonical_host_deny_8vomr5', [{ type: 'host', op: 'ninc', value: ['muttergames.com', 'www.muttergames.com'] }]),
  rule('rule_mutter_api_get_deny_RGNeDu', [{ type: 'method', op: 'inc', value: ['GET', 'HEAD'] }, { type: 'path', op: 'pre', value: '/api/' }]),
  rule('orders-unchanged', [{ type: 'path', op: 'pre', value: '/api/orders' }]),
] });

for (const project of ['store', 'admin']) {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'TRACE', 'CONNECT']) {
    test(`initial closure denies ${project} ${method}, including forged smoke headers`, () => {
      assert.equal(closureDenies(request({ method, headers: { 'x-mutter-release-action': 'runtime-attestation' } }), { project }), true);
    });
  }
}
test('public catalog and read-only Admin methods survive additional closure', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(closureDenies(request({ method, path: '/', rawPath: '/' }), { project: 'store' }), false);
    assert.equal(closureDenies(request({ method, path: '/api/admin/products', rawPath: '/api/admin/products' }), { project: 'admin' }), false);
  }
});
test('GET signatures and reconciliation are writes for closure purposes', () => {
  for (const [project, path] of [['admin', '/api/imagekit-signature'], ['store', '/api/internal/web-stock-reconcile']]) {
    assert.equal(closureDenies(request({ method: 'GET', path, rawPath: path }), { project }), true);
    assert.equal(closureDenies(request({ method: 'GET', rawPath: path }), { project }), true);
  }
});
test('legacy projects remain closed on every host and path', () => {
  for (const project of ['storeLegacy', 'adminLegacy']) for (const method of ['GET', 'POST', 'OPTIONS']) {
    assert.equal(closureDenies(request({ host: candidate.host, method }), { project, candidate }), true);
  }
});
test('proposal preserves baseline and rejects drift', () => {
  const before = firewall(); const proposal = closureProposal(before, 'store');
  assert.equal(verifyProposalBase(proposal, before), true);
  assert.deepEqual(before, firewall());
  assert.throws(() => verifyProposalBase(proposal, { ...before, version: 5 }), /WAF drift/);
  proposal.after.rules[1].active = false;
  assert.throws(() => verifyProposalBase(proposal, before), /existing rules changed/);
});
test('candidate WAF delta limits host, method, normalized/raw path and discriminator', () => {
  const closed = closureProposal(firewall(), 'store').after;
  const proposal = candidateSmokeProposal(closed, candidate);
  assert.deepEqual(proposal.after.rules.find(r => r.id === 'orders-unchanged'), closed.rules.find(r => r.id === 'orders-unchanged'));
  for (const action of ['runtime-attestation', 'read-smoke']) {
    const valid = request({ host: candidate.host, headers: { 'x-mutter-release-action': action } });
    assert.equal(wafDenies(proposal.after, valid), false);
    for (const change of [{ host: 'muttergames.com' }, { host: 'other.vercel.app' }, { method: 'PUT' }, { headers: {} },
      { path: '/api/orders' }, { rawPath: '/api/create-mp-preference/' }, { rawPath: '/api/%63reate-mp-preference' }]) {
      assert.equal(wafDenies(proposal.after, { ...valid, ...change }), true, JSON.stringify(change));
    }
  }
  const cron = request({ host: candidate.host, method: 'GET', path: '/api/internal/web-stock-reconcile', rawPath: '/api/internal/web-stock-reconcile' });
  assert.equal(wafDenies(proposal.after, cron), true);
  assert.equal(wafDenies(proposal.after, { ...cron, headers: { 'x-mutter-release-action': 'runtime-attestation' } }), false);
  assert.throws(() => candidateSmokeProposal(closed, { ...candidate, guardsClosed: false }), /candidate identity/);
});
test('WAF operators are case-insensitive; handler remains the exact authentication boundary', () => {
  const after = candidateSmokeProposal(closureProposal(firewall(), 'store').after, candidate).after;
  assert.equal(wafDenies(after, request({ host: candidate.host, headers: { 'x-mutter-release-action': 'RUNTIME-ATTESTATION' } })), false);
});
test('reconciling phase permits exact Cron route while all buyers and Admin remain closed', () => {
  const before = closureProposal(firewall(), 'store').after;
  const phase = { controlState: 'reconciling', newPairVerified: true, revision: 'synthetic-close-20261002',
    hosts: [candidate.host], deploymentIds: [candidate.deploymentId] };
  const { after } = reconciliationProposal(before, phase);
  const cron = request({ host: candidate.host, method: 'GET', path: '/api/internal/web-stock-reconcile', rawPath: '/api/internal/web-stock-reconcile' });
  assert.equal(wafDenies(after, cron), false);
  for (const change of [{ host: 'other.vercel.app' }, { method: 'POST' }, { rawPath: '/api/internal/web-stock-reconcile/' }, { path: '/api/orders' }]) {
    assert.equal(wafDenies(after, { ...cron, ...change }), true);
  }
  assert.equal(wafDenies(after, request()), true);
  assert.deepEqual(after.rules.find(r => r.id === 'orders-unchanged'), before.rules.find(r => r.id === 'orders-unchanged'));
  assert.throws(() => reconciliationProposal(before, { ...phase, controlState: 'open' }), /phase/);
  assert.throws(() => reconciliationProposal(before, { ...phase, hosts: ['*.vercel.app'] }), /phase/);
});

function snapshot(projectId, index) {
  const id = `dpl_fixture${index}`; const name = `function${index}`;
  return { deployment: { id, projectId, readyState: 'READY' },
    files: [{ name: 'out', type: 'directory', children: [{ name: 'writer', type: 'lambda', uid: name }] }],
    builds: { builds: [{ deploymentId: id, readyState: 'READY', output: [{ type: 'lambda', path: 'writer', digest: 'digest',
      lambda: { functionName: name, runtime: 'nodejs22.x', deployedTo: ['iad1'], timeout: 300 } }] }] } };
}
function drainEvidence() {
  const snapshots = Object.values(PROJECTS).map(snapshot);
  const functionIds = effectiveFunctions(snapshots).map(f => `${f.deploymentId}:${f.functionName}`);
  const scopes = [...Object.values(PROJECTS), 'firestore-direct', 'external-writers'];
  return { schema: 1, nowMs: 700_000, maxEvidenceAgeMs: 10_000, snapshots,
    control: { document: 'operations/webStockCutover', schema: 1, state: 'closed', revision: 'synthetic-close-20261002', serverCommitMs: 300_000, evidence },
    closures: scopes.map(scope => ({ scope, state: 'closed', revision: 'synthetic-close-20261002', effectiveAtMs: 300_000, allEntryPoints: true, unknownWriters: 0, evidence })),
    inventory: { functionIds, unknownWriters: 0, externalBounded: true, evidence },
    margin: { clockSkewMs: 1_000, terminationMs: 500, propagationMs: 1_000, justification: 'Synthetic measured clock and propagation evidence for evaluator test only', evidence },
    quiescence: { durationMs: 10_000, justification: 'Synthetic measured ingestion-delay bound for evaluator test only', evidence },
    observation: { fromMs: 0, toMs: 700_000, complete: true, sampled: false, functionIds, activeInvocations: 0,
      acceptedWriterAdmissionsAfterClose: 0, positiveClosureProbeScopes: scopes, evidence },
    writeObservation: { fromMs: 300_000, toMs: 700_000, complete: true, newWritesAfterDrain: 0, evidence } };
}
test('drain uses actual per-function timeout and latest effective closure', () => {
  const input = drainEvidence(); input.closures[0].effectiveAtMs = 310_000;
  const result = evaluateDrain(input);
  assert.equal(result.closedAtMs, 310_000); assert.equal(result.deadlineMs, 612_500); assert.equal(result.functionCount, 4);
  assert.equal(result.status, 'DRAIN_PLAN_CONSISTENT'); assert.equal(result.remoteDrainVerified, false);
});
test('legitimate work admitted before close may finish before the effective drain bound', () => {
  const input = drainEvidence(); input.writeObservation.writesBeforeDrain = 3;
  assert.equal(evaluateDrain(input).status, 'DRAIN_PLAN_CONSISTENT');
});
const bad = {
  'project default is not timeout': input => { delete input.snapshots[0].builds.builds[0].output[0].lambda.timeout; input.snapshots[0].deployment.config = { functionTimeout: 300 }; },
  'unknown output': input => { input.snapshots[0].builds.builds[0].output[0].type = 'edge'; },
  'inventory gap': input => { input.snapshots[0].files[0].children.push({ name: 'other', type: 'lambda', uid: 'other' }); },
  'wrong deployment': input => { input.snapshots[0].builds.builds[0].deploymentId = 'dpl_other'; },
  'unknown external writer': input => { input.inventory.unknownWriters = 1; },
  'absent direct writer closure': input => { input.closures.pop(); },
  'missing server timestamp': input => { delete input.control.serverCommitMs; },
  'not enough time': input => { input.nowMs = 600_000; },
  'unjustified margin': input => { input.margin.evidence = null; },
  'stale logs': input => { input.nowMs = 900_000; },
  'sampled logs': input => { input.observation.sampled = true; },
  'empty logs without positive closure probes': input => { input.observation.positiveClosureProbeScopes = []; },
  'missing function coverage': input => { input.observation.functionIds = []; },
  'new admission': input => { input.observation.acceptedWriterAdmissionsAfterClose = 1; },
  'active invocation': input => { input.observation.activeInvocations = 1; },
  'new write after drain': input => { input.writeObservation.newWritesAfterDrain = 1; },
  'unmeasured quiescence': input => { input.quiescence.evidence = null; },
};
for (const [name, mutate] of Object.entries(bad)) test(`drain fails closed: ${name}`, () => {
  const input = drainEvidence(); mutate(input); assert.throws(() => evaluateDrain(input), /NOT_VERIFIED/);
});

test('git deployment files 404 requires exact v13/v11 function correlation', () => {
  const input = snapshot(PROJECTS.store, 1);
  input.files = null; input.fileListUnavailableReason = 'API404_GIT_DEPLOYMENT'; input.deployment.lambdaNames = ['function1'];
  assert.equal(effectiveFunctions([input]).length, 1);
  input.deployment.lambdaNames.push('unexpected');
  assert.throws(() => effectiveFunctions([input]), /coverage mismatch/);
});

test('evidence integrity requires existing matching files bound to actual metadata, without claiming remote drain', async t => {
  const root = await mkdtemp(join(tmpdir(), 'mutter-release-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const snapshots = [snapshot(PROJECTS.store, 1)];
  const metadata = { readOnly: true, applicationRequests: 0, snapshots,
    ledger: [{ exitCode: 0, command: ['vercel', 'api', '/v11/deployments/dpl_fixture1/builds?teamId=synthetic', '--method', 'GET'] }] };
  const bytes = JSON.stringify(metadata);
  await writeFile(join(root, 'metadata.json'), bytes);
  const ref = { source: 'metadata.json', sha256: createHash('sha256').update(bytes).digest('hex') };
  const input = { metadataEvidence: ref, snapshots };
  assert.equal((await verifyEvidenceFiles(input, root)).remoteDrainVerified, false);
  await assert.rejects(verifyEvidenceFiles({ ...input, metadataEvidence: { ...ref, sha256: 'b'.repeat(64) } }, root), /hash mismatch/);
  await assert.rejects(verifyEvidenceFiles({ ...input, snapshots: [] }, root), /not bound/);
  await assert.rejects(verifyEvidenceFiles({ ...input, metadataEvidence: { ...ref, source: 'absent.json' } }, root), /ENOENT/);
  await assert.rejects(verifyEvidenceFiles({ ...input, metadataEvidence: { ...ref, source: '../outside' } }, root), /invalid evidence reference/);
  await symlink(tmpdir(), join(root, 'escape'));
  await assert.rejects(verifyEvidenceFiles({ ...input, metadataEvidence: { ...ref, source: 'escape' } }, root), /escapes package/);
});
