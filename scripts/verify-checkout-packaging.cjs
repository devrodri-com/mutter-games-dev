// Build and load the emitted checkout without linking, deploying or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { buildArtifact, createWorkspace, writeJson } = require('./checkout-packaging/artifact.cjs');
const { verifyNativeProcesses } = require('./checkout-packaging/sandbox.cjs');

(async () => {
  assert.equal(process.versions.node.split('.')[0], '22', 'Run under production Node 22');
  const source = await fs.realpath(path.resolve(__dirname, '..'));
  const workspace = await createWorkspace(source);
  const report = { node: process.version, startedAt: new Date().toISOString(), source, phase: 'build', status: 'RUNNING' };
  try {
    report.artifact = await buildArtifact(source, workspace);
    report.phase = 'native-processes';
    report.native = await verifyNativeProcesses(source, workspace, report.artifact.handler);
    assert(report.native.cases.every(result => result.passed), 'An emitted-handler cold process failed');
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.failure = { code: error.code ?? null, message: error.message };
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeJson(path.join(workspace.root, 'result.json'), report);
    console.log(JSON.stringify({ gate: 'checkout-emitted-native', ...report, evidence: workspace.preserve ? workspace.root : 'temporary output removed after gate' }));
    if (!workspace.preserve) await fs.rm(workspace.root, { recursive: true });
  }
})().catch(error => {
  console.error(JSON.stringify({ gate: 'checkout-emitted-native', status: 'HARNESS_FAILED', code: error.code ?? null, message: error.message }));
  process.exitCode = 1;
});
