import { execFileSync } from 'node:child_process';
import { PROJECTS, requireValue } from './policy.mjs';

// Read-only metadata collector. It never requests environment-variable endpoints or invokes an app.
// stdout is an allowlisted receipt; unselected deployment env values are neither used nor retained.
const teamId = 'team_zgY1367CSDsN9mxaF6EXpe3f';
const [file] = process.argv.slice(2);
const { readFile } = await import('node:fs/promises');
const ledger = [];
function get(path) {
  const args = ['api', `${path}${path.includes('?') ? '&' : '?'}teamId=${teamId}`, '--method', 'GET', '--raw'];
  const startedAt = new Date().toISOString();
  let text;
  try {
    text = execFileSync('vercel', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const is404 = error instanceof Error && 'stderr' in error && String(error.stderr).includes('(404)');
    ledger.push({ command: ['vercel', ...args], startedAt, finishedAt: new Date().toISOString(),
      exitCode: error && typeof error === 'object' && 'status' in error ? error.status : 1,
      providerStatus: is404 ? 404 : 'UNAVAILABLE' });
    if (is404 && path.endsWith('/files')) return null;
    throw error;
  }
  ledger.push({ command: ['vercel', ...args], startedAt, finishedAt: new Date().toISOString(), exitCode: 0 });
  return JSON.parse(text);
}
try {
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  requireValue(Array.isArray(manifest.deployments) && manifest.deployments.length >= 4, 'explicit deployment manifest required');
  const snapshots = [];
  for (const entry of manifest.deployments) {
    requireValue(Object.values(PROJECTS).includes(entry.projectId) && /^dpl_[a-zA-Z0-9]+$/.test(entry.deploymentId), 'deployment outside four-project scope');
    const remote = get(`/v13/deployments/${entry.deploymentId}`);
    requireValue(remote.id === entry.deploymentId && remote.projectId === entry.projectId, 'provider deployment identity mismatch');
    const builds = get(`/v11/deployments/${entry.deploymentId}/builds`);
    const tree = get(`/v6/deployments/${entry.deploymentId}/files`);
    const files = tree === null ? null : tree.filter(row => row.name === 'out');
    snapshots.push({
      deployment: { id: remote.id, projectId: remote.projectId, readyState: remote.readyState, url: remote.url, target: remote.target,
        lambdaNames: remote.lambdas.flatMap(build => build.output.map(output => output.functionName)) },
      builds: { builds: builds.builds.map(build => ({ id: build.id, deploymentId: build.deploymentId,
        readyState: build.readyState, output: build.output.map(output => ({ type: output.type, path: output.path,
          digest: output.digest, ...(output.type === 'lambda' ? { lambda: { functionName: output.lambda.functionName,
            timeout: output.lambda.timeout, runtime: output.lambda.runtime, deployedTo: output.lambda.deployedTo } } : {}) })) })) },
      files, ...(files === null ? { fileListUnavailableReason: 'API404_GIT_DEPLOYMENT' } : {}),
    });
  }
  console.log(JSON.stringify({ schema: 1, readOnly: true, applicationRequests: 0, collectedAt: new Date().toISOString(), snapshots, ledger }, null, 2));
} catch (error) {
  // Do not dump provider responses or environment values on errors.
  console.error(JSON.stringify({ status: 'NOT_VERIFIED', completedReads: ledger,
    error: error instanceof Error ? error.message.split('\n')[0] : 'Invalid metadata', exitCode: 1 }));
  process.exitCode = 1;
}
