require('./braces-remediation/control.cjs').inspect(require('node:path').resolve(__dirname, '..'));
const fs = require('node:fs/promises');
const path = require('node:path');
const { verifyInstalled } = require('./edge-tooling/inventory.cjs');
const { verifyOperationalSources } = require('./edge-tooling/operational.cjs');
const { runObserved } = require('./edge-tooling/observe.cjs');
const { inspectSpaArtifacts } = require('./edge-tooling/emission.cjs');
const { identity, createEvidence, writeReport, readEvidence, requirePass, failureStatus } = require('./edge-tooling/context.cjs');

async function main() {
  const source = await fs.realpath(path.resolve(__dirname, '..'));
  const mode = process.argv[2];
  if (!['inventory', 'build'].includes(mode)) throw new Error('Expected inventory or build');
  const report = { gate: 'edge-tooling', mode, status: 'NOT_VERIFIED', startedAt: new Date().toISOString() };
  let evidence;
  try {
    if (mode === 'build') evidence = await createEvidence(source, 'spa');
    report.identity = await identity(source);
    report.installed = await verifyInstalled(source);
    requirePass(report.installed, 'Installed exception identity');
    report.operational = await verifyOperationalSources(source);
    requirePass(report.operational, 'Operational consumers');
    if (mode === 'build') {
      report.typescript = await runObserved({ source, cwd: source,
        entry: path.join(source, 'node_modules/typescript/bin/tsc'), args: ['-b'],
        evidenceDirectory: path.join(evidence.directory, 'typescript') });
      requirePass(report.typescript, 'Observed TypeScript compilation');
      const inventoryPath = path.join(evidence.directory, 'spa-inventory.json');
      report.vite = await runObserved({ source, cwd: source,
        entry: path.join(source, 'scripts/edge-tooling/build-spa.mjs'),
        args: [source, path.join(source, 'dist'), inventoryPath],
        evidenceDirectory: path.join(evidence.directory, 'vite') });
      requirePass(report.vite, 'Observed Vite compilation');
      const inventory = await readEvidence(inventoryPath);
      report.emission = await inspectSpaArtifacts(source, path.join(source, 'dist'), inventory);
      requirePass(report.emission, 'Final written SPA inspection');
    }
    report.status = 'PASS';
  } catch (error) {
    report.status = failureStatus(error);
    report.failure = { code: error.code ?? null, message: error.message };
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    if (evidence) await writeReport(path.join(evidence.directory, 'result.json'), report);
    console.log(JSON.stringify({ ...report, evidence: evidence?.preserve ? evidence.directory : 'temporary evidence removed' }));
    if (evidence && !evidence.preserve) await fs.rm(evidence.root, { recursive: true });
  }
}

main().catch(error => {
  console.error(JSON.stringify({ gate: 'edge-tooling', status: 'NOT_VERIFIED', failure: error.message }));
  process.exitCode = 1;
});
