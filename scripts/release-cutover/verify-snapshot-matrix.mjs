import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PROJECTS, closureProposal, verifyProposalBase, wafDenies, candidateSmokeProposal, reconciliationProposal, hashJson } from './policy.mjs';
import { effectiveFunctions } from './drain.mjs';

const [firewallsFile, functionsFile] = process.argv.slice(2);
try {
  assert(firewallsFile && functionsFile, 'Usage: node scripts/release-cutover/verify-snapshot-matrix.mjs <four-project-waf-snapshots.json> <provider-snapshots.json>');
  const data = JSON.parse(await readFile(firewallsFile, 'utf8'));
  assert.equal(data.readOnly, true);
  assert.deepEqual(data.projects.map(row => row.id).sort(), Object.values(PROJECTS).sort());
  let checks = 0;
  const projects = [];
  for (const row of data.projects) {
    const project = Object.keys(PROJECTS).find(key => PROJECTS[key] === row.id);
    const proposal = closureProposal(row.waf, project);
    assert(verifyProposalBase(proposal, row.waf)); checks++;
    const hosts = [...new Set([...row.aliases.map(alias => alias.alias), row.production.url, 'not-an-allowed-host.invalid'])];
    const canonical = project === 'store' ? ['muttergames.com', 'www.muttergames.com']
      : project === 'admin' ? ['mutter-games-admin-api-prod.vercel.app'] : [];
    for (const host of hosts) {
      for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH', 'PUT', 'DELETE']) {
        for (const path of ['/api/create-mp-preference', '/api/internal/web-stock-reconcile', '/api/imagekit-signature', '/api/admin/products', '/api/orders', '/']) {
          const request = { host, method, path, rawPath: path, headers: {} };
          if (!canonical.includes(host)) { assert.equal(wafDenies(row.waf, request), true); checks++; }
          if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) { assert.equal(wafDenies(proposal.after, request), true); checks++; }
        }
      }
    }
    projects.push({ id: row.id, name: row.name, aliasCount: row.aliases.length, testedHostCount: hosts.length,
      activeWafVersion: row.waf.version, baselineSha256: hashJson(row.waf) });
    if (project === 'store') {
      const candidate = { host: 'synthetic-readiness-candidate.vercel.app', deploymentId: 'dpl_synthetic',
        head: 'a'.repeat(40), tree: 'b'.repeat(40), guardsClosed: true };
      const plan = candidateSmokeProposal(proposal.after, candidate);
      for (const method of ['POST', 'GET', 'HEAD', 'PUT']) for (const action of ['runtime-attestation', 'read-smoke', 'start', 'verify', '']) {
        for (const path of ['/api/create-mp-preference', '/api/internal/web-stock-reconcile', '/api/orders']) {
          const request = { host: candidate.host, method, path, rawPath: path, headers: { 'x-mutter-release-action': action } };
          const allowed = (method === 'POST' && path === '/api/create-mp-preference' && ['runtime-attestation', 'read-smoke'].includes(action))
            || (method === 'GET' && path === '/api/internal/web-stock-reconcile' && action === 'runtime-attestation');
          assert.equal(wafDenies(plan.after, request), !allowed); checks++;
        }
      }
      const phase = { controlState: 'reconciling', newPairVerified: true, revision: 'synthetic-close-20261002',
        hosts: [candidate.host, 'www.muttergames.com'], deploymentIds: [candidate.deploymentId, candidate.deploymentId] };
      const reconcilePlan = reconciliationProposal(proposal.after, phase);
      for (const host of [...phase.hosts, 'other.vercel.app']) for (const method of ['GET', 'POST', 'PUT']) {
        for (const path of ['/api/internal/web-stock-reconcile', '/api/create-mp-preference', '/api/orders']) {
          const request = { host, method, path, rawPath: path, headers: {} };
          const allowed = phase.hosts.includes(host) && method === 'GET' && path === '/api/internal/web-stock-reconcile';
          assert.equal(wafDenies(reconcilePlan.after, request), !allowed); checks++;
        }
      }
    }
  }
  const provider = JSON.parse(await readFile(functionsFile, 'utf8'));
  assert.equal(provider.readOnly, true);
  const functions = effectiveFunctions(provider.snapshots);
  const projectsWithFunctions = new Set(functions.map(fn => fn.projectId));
  assert(Object.values(PROJECTS).every(project => projectsWithFunctions.has(project))); checks++;
  console.log(JSON.stringify({ schema: 1, status: 'LOCAL_MATRIX_PASS', remoteApplied: false, remoteDrainVerified: false,
    checks, projects, effectiveFunctions: functions.length,
    effectiveMaximumTimeoutSeconds: Math.max(...functions.map(fn => fn.timeoutSeconds)), at: new Date().toISOString(),
    limits: ['Local WAF operator model, not remote engine validation', 'No application calls, closure or drain performed',
      'Synthetic candidate is not a deployment; current provider timeouts must be refreshed before the cutover'] }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'NOT_VERIFIED: Invalid snapshot');
  process.exitCode = 1;
}
