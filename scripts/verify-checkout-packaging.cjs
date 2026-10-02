// Build and load the exact two emitted functions without linking or deploying.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createWorkspace, writeJson } = require('./checkout-packaging/artifact.cjs');
const { verifyNativeProcesses } = require('./checkout-packaging/sandbox.cjs');
const { verifyInstalled } = require('./edge-tooling/inventory.cjs');
const { verifyOperationalSources } = require('./edge-tooling/operational.cjs');
const { runObserved } = require('./edge-tooling/observe.cjs');
const { inspectNodeArtifacts } = require('./edge-tooling/emission.cjs');
const { identity, createEvidence, writeReport, readEvidence, requirePass, failureStatus } = require('./edge-tooling/context.cjs');

(async () => {
  assert.equal(process.versions.node.split('.')[0], '22', 'Run under production Node 22');
  const source = await fs.realpath(path.resolve(__dirname, '..'));
  const workspace = await createWorkspace(source);
  const report = { node: process.version, startedAt: new Date().toISOString(), source, phase: 'build', status: 'RUNNING' };
  let evidence;
  try {
    evidence = await createEvidence(source, 'packaging');
    report.identity = await identity(source);
    report.installed = await verifyInstalled(source);
    requirePass(report.installed, 'Installed exception identity');
    report.operational = await verifyOperationalSources(source);
    requirePass(report.operational, 'Operational consumers');
    const config = JSON.parse(await fs.readFile(path.join(source, 'vercel.json'), 'utf8'));
    const schedulerPath = '/api/internal/web-stock-reconcile';
    assert.deepEqual(config.crons, [{ path: schedulerPath, schedule: '*/5 * * * *' }], 'Unexpected prepared scheduler topology');
    const routeIndex = config.routes.findIndex(route => route.src === schedulerPath);
    assert(routeIndex >= 0 && routeIndex < config.routes.findIndex(route => route.handle === 'filesystem'), 'Scheduler must precede filesystem/SPA fallback');
    assert.deepEqual(config.routes[routeIndex], { src: schedulerPath, dest: `${schedulerPath}.ts` }, 'Scheduler route must be exact');
    const indexConfig = JSON.parse(await fs.readFile(path.join(source, 'firebase.web-stock-indexes.json'), 'utf8'));
    assert.deepEqual(indexConfig, { firestore: { indexes: 'firestore.web-stock.indexes.json' } });
    const indexes = JSON.parse(await fs.readFile(path.join(source, indexConfig.firestore.indexes), 'utf8'));
    assert.deepEqual(indexes, { indexes: [{ collectionGroup: 'orders', queryScope: 'COLLECTION', fields: [
      { fieldPath: 'commerceVersion', order: 'ASCENDING' }, { fieldPath: 'reconciliation.nextCheckAt', order: 'ASCENDING' },
    ] }], fieldOverrides: [] }, 'Prepared index must match the bounded queue query');
    report.preparedConfiguration = { schedulerPath, schedule: config.crons[0].schedule, index: indexes.indexes[0], appliedRemotely: false };
    const artifactResult = path.join(workspace.root, 'observed-artifact.json');
    report.observation = await runObserved({ source, entry: path.join(source, 'scripts/checkout-packaging/build-observed.cjs'),
      args: [source, workspace.root, artifactResult], evidenceDirectory: path.join(evidence.directory, 'builder') });
    requirePass(report.observation, 'Observed official function builder');
    report.artifact = await readEvidence(artifactResult);
    report.emission = await inspectNodeArtifacts(source, workspace, report.artifact.entries);
    requirePass(report.emission, 'Final written function inspection');
    report.phase = 'native-processes';
    report.native = await verifyNativeProcesses(source, workspace, report.artifact.entries);
    assert(report.native.cases.every(result => result.passed), 'An emitted-handler cold process failed');
    report.status = 'PASS';
  } catch (error) {
    report.status = failureStatus(error);
    report.failure = { code: error.code ?? null, message: error.message };
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeJson(path.join(workspace.root, 'result.json'), report);
    if (evidence) await writeReport(path.join(evidence.directory, 'result.json'), report);
    console.log(JSON.stringify({ gate: 'checkout-emitted-native', ...report, evidence: workspace.preserve ? workspace.root : 'temporary output removed after gate' }));
    if (!workspace.preserve) await fs.rm(workspace.root, { recursive: true });
    if (evidence && !evidence.preserve) await fs.rm(evidence.root, { recursive: true });
  }
})().catch(error => {
  console.error(JSON.stringify({ gate: 'checkout-emitted-native', status: 'HARNESS_FAILED', code: error.code ?? null, message: error.message }));
  process.exitCode = 1;
});
