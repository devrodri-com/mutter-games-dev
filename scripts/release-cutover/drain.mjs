import { requireValue, PROJECTS } from './policy.mjs';

const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const number = value => Number.isSafeInteger(value) && value >= 0;
const evidence = value => value && sha256(value.sha256) && typeof value.source === 'string' && value.source.length > 0;

/** Read the provider's per-function config, never project defaults or build wall time. */
export function effectiveFunctions(snapshots) {
  requireValue(Array.isArray(snapshots) && snapshots.length > 0, 'no deployment snapshots');
  const result = [];
  const deployments = new Set();
  for (const snapshot of snapshots) {
    const { deployment, builds, files } = snapshot;
    requireValue(deployment?.id && deployment.projectId && deployment.readyState === 'READY', 'deployment identity');
    requireValue(!deployments.has(deployment.id), 'duplicate deployment');
    deployments.add(deployment.id);
    requireValue(Array.isArray(builds?.builds) && (Array.isArray(files)
      || (files === null && snapshot.fileListUnavailableReason === 'API404_GIT_DEPLOYMENT'
        && Array.isArray(deployment.lambdaNames))), 'missing provider builds/files');
    const listed = new Set();
    const walk = (rows, parent = '') => rows.forEach(row => {
      const path = `${parent}/${row.name}`;
      if (row.type === 'lambda') listed.add(`${path.replace(/^\/out\//, '')}:${row.uid}`);
      if (Array.isArray(row.children)) walk(row.children, path);
    });
    if (files) walk(files);
    const produced = new Set();
    for (const build of builds.builds) {
      requireValue(build.deploymentId === deployment.id && build.readyState === 'READY', 'build identity/state');
      requireValue(Array.isArray(build.output), 'build output missing');
      for (const output of build.output) {
        requireValue(output.type === 'lambda' || ['file', 'directory'].includes(output.type), 'unknown/Edge output');
        if (output.type !== 'lambda') continue;
        const fn = output.lambda;
        requireValue(fn?.functionName && output.path && output.digest, 'function identity/digest');
        requireValue(Number.isSafeInteger(fn.timeout) && fn.timeout > 0 && fn.timeout <= 900, 'missing effective lambda.timeout');
        requireValue(/^nodejs[0-9]+\.x$/.test(fn.runtime) && Array.isArray(fn.deployedTo) && fn.deployedTo.length, 'function runtime/regions');
        const key = `${output.path}:${fn.functionName}`;
        // Old builder may list a function twice. A conflicting duplicate must not hide a longer timeout.
        const prior = result.find(r => r.deploymentId === deployment.id && r.path === output.path && r.functionName === fn.functionName);
        if (prior) requireValue(prior.timeoutSeconds === fn.timeout && prior.digest === output.digest, 'conflicting function duplicate');
        else result.push({ deploymentId: deployment.id, projectId: deployment.projectId, path: output.path,
          functionName: fn.functionName, digest: output.digest, timeoutSeconds: fn.timeout, regions: fn.deployedTo });
        produced.add(key);
      }
    }
    if (files) requireValue(listed.size > 0 && listed.size === produced.size && [...listed].every(k => produced.has(k)), 'files/builds coverage mismatch');
    else {
      const names = new Set(result.filter(fn => fn.deploymentId === deployment.id).map(fn => fn.functionName));
      const deployedNames = new Set(deployment.lambdaNames);
      requireValue(names.size > 0 && names.size === deployedNames.size && [...names].every(name => deployedNames.has(name)),
        'v13/v11 deployed function coverage mismatch');
    }
  }
  return result;
}

/** Validate a proposed timeline, not the truth of operator-supplied provider counters. */
export function evaluateDrain(input) {
  requireValue(input?.schema === 1, 'drain schema');
  const functions = effectiveFunctions(input.snapshots);
  requireValue(Object.values(PROJECTS).every(id => functions.some(fn => fn.projectId === id)), 'four-project function coverage missing');
  requireValue(number(input.nowMs), 'evaluation time');
  requireValue(number(input.maxEvidenceAgeMs) && input.maxEvidenceAgeMs > 0, 'evidence freshness policy');
  const control = input.control;
  requireValue(control?.document === 'operations/webStockCutover' && control.schema === 1 && control.state === 'closed'
    && typeof control.revision === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(control.revision) && number(control.serverCommitMs)
    && evidence(control.evidence), 'authoritative control close receipt');
  requireValue(Array.isArray(input.closures), 'closure ledger missing');
  const expected = [...Object.values(PROJECTS), 'firestore-direct', 'external-writers'];
  requireValue(input.closures.length === expected.length && new Set(input.closures.map(c => c.scope)).size === expected.length,
    'closure scope duplicated/incomplete');
  let closedAtMs = control.serverCommitMs;
  for (const scope of expected) {
    const closure = input.closures.find(c => c.scope === scope);
    requireValue(closure?.state === 'closed' && closure.revision === control.revision && evidence(closure.evidence)
      && number(closure.effectiveAtMs) && closure.effectiveAtMs <= input.nowMs, `closure not verified: ${scope}`);
    requireValue(closure.allEntryPoints === true && closure.unknownWriters === 0, `unknown writer/entry point: ${scope}`);
    closedAtMs = Math.max(closedAtMs, closure.effectiveAtMs);
  }
  requireValue(input.inventory?.unknownWriters === 0 && input.inventory.externalBounded === true
    && evidence(input.inventory.evidence), 'writer inventory incomplete');
  const coveredIds = functions.map(f => `${f.deploymentId}:${f.functionName}`).sort();
  requireValue(Array.isArray(input.inventory.functionIds)
    && JSON.stringify([...input.inventory.functionIds].sort()) === JSON.stringify(coveredIds), 'writer/function inventory mismatch');
  const margin = input.margin;
  requireValue(number(margin?.clockSkewMs) && number(margin?.terminationMs) && number(margin?.propagationMs)
    && margin.clockSkewMs + margin.terminationMs + margin.propagationMs > 0
    && typeof margin.justification === 'string' && margin.justification.length >= 20 && evidence(margin.evidence), 'unjustified technical margin');
  const maxTimeoutMs = Math.max(...functions.map(f => f.timeoutSeconds)) * 1000;
  const deadlineMs = closedAtMs + maxTimeoutMs + margin.clockSkewMs + margin.terminationMs + margin.propagationMs;
  requireValue(input.nowMs >= deadlineMs, 'effective timeout and technical margin not elapsed');
  requireValue(number(input.quiescence?.durationMs) && input.quiescence.durationMs > 0
    && evidence(input.quiescence.evidence) && typeof input.quiescence.justification === 'string'
    && input.quiescence.justification.length >= 20, 'quiescence interval lacks measured evidence');
  const quietUntilMs = deadlineMs + input.quiescence.durationMs;
  requireValue(input.nowMs >= quietUntilMs, 'post-drain quiescence not elapsed');
  const observation = input.observation;
  requireValue(observation?.fromMs <= closedAtMs - maxTimeoutMs && observation.toMs >= deadlineMs
    && observation.toMs <= input.nowMs && input.nowMs - observation.toMs <= input.maxEvidenceAgeMs
    && observation.complete === true && observation.sampled === false && evidence(observation.evidence), 'logs missing/incomplete/stale');
  requireValue(JSON.stringify([...observation.functionIds].sort()) === JSON.stringify(coveredIds), 'logs do not cover every function');
  requireValue(observation.activeInvocations === 0 && observation.acceptedWriterAdmissionsAfterClose === 0,
    'active invocation/new writer admission');
  requireValue(observation.positiveClosureProbeScopes?.length === expected.length
    && expected.every(scope => observation.positiveClosureProbeScopes.includes(scope)), 'empty logs alone do not prove closure');
  const writes = input.writeObservation;
  requireValue(writes?.fromMs <= deadlineMs && writes.toMs >= quietUntilMs && writes.complete === true
    && writes.newWritesAfterDrain === 0 && evidence(writes.evidence), 'post-drain absence of new writes not verified');
  return { schema: 1, status: 'DRAIN_PLAN_CONSISTENT', remoteDrainVerified: false,
    revision: control.revision, closedAtMs, maxTimeoutMs, deadlineMs, quietUntilMs,
    functionCount: functions.length, deploymentIds: [...new Set(functions.map(f => f.deploymentId))],
    note: 'Input counters/booleans are not provider attestation. Primary runtime/admission/write coverage must be verified independently before cutover; this module never declares remote drain PASS.' };
}
