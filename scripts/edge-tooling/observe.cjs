const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { digest, inside, canonical, forbiddenLocation } = require('./observation-policy.cjs');

function inspectObservation({ events, rootToken, entry, exitCode }) {
  const failures = [];
  const uncovered = [];
  const scopes = new Map();
  for (const event of events) {
    if (!event || typeof event.scope !== 'string' || !Number.isInteger(event.sequence)) {
      uncovered.push('Malformed observation event');
      continue;
    }
    if (!scopes.has(event.scope)) scopes.set(event.scope, []);
    scopes.get(event.scope).push(event);
    if (event.type === 'violation') failures.push(event);
    if (event.type === 'uncovered') uncovered.push(event);
    if (['child-error', 'worker-error'].includes(event.type)) failures.push(event);
  }
  const starts = events.filter(event => event.type === 'start');
  const roots = starts.filter(event => event.token === rootToken && event.parentScope === null);
  if (roots.length !== 1) uncovered.push('Exactly one root preload handshake is required');
  for (const [scope, records] of scopes) {
    records.sort((a, b) => a.sequence - b.sequence);
    if (records.some((event, index) => event.sequence !== index)) uncovered.push(`Incomplete event sequence: ${scope}`);
    const start = records[0];
    if (start.type !== 'start') uncovered.push(`Missing initial preload event: ${scope}`);
    if (start.isMainThread && !records.some(event => event.type === 'exit')) uncovered.push(`Missing Node process exit observation: ${scope}`);
  }
  if (roots.length === 1 && !events.some(event => event.scope === roots[0].scope && event.type === 'module' && event.url === pathToFileURL(entry).href)) {
    uncovered.push('Authorized entrypoint was not observed loading');
  }
  const launches = events.filter(event => event.type === 'child-launch' || event.type === 'worker-launch');
  const coverage = [];
  for (const launch of launches) {
    if (launch.kind === 'native-esbuild') {
      coverage.push({ token: launch.token, kind: launch.kind, sha256: launch.sha256, executable: launch.executable, observation: launch.observation });
      continue;
    }
    const matches = starts.filter(start => start.token === launch.token && start.parentScope === launch.scope);
    if (matches.length !== 1) uncovered.push(`Missing or ambiguous descendant preload handshake: ${launch.token}`);
    else {
      const start = matches[0];
      const worker = launch.type === 'worker-launch';
      if (worker && (start.pid !== launch.pid || start.isMainThread)) uncovered.push(`Worker identity mismatch: ${launch.token}`);
      if (!worker && !start.isMainThread) uncovered.push(`Node child identity mismatch: ${launch.token}`);
      const descendantExit = events.find(event => event.scope === start.scope && event.type === 'exit');
      if (descendantExit && descendantExit.code !== 0) failures.push({ reason: 'Observed Node descendant exited unsuccessfully', scope: start.scope, exitCode: descendantExit.code });
      coverage.push({ token: launch.token, kind: worker ? 'Node-worker' : 'Node-child', scope: start.scope, pid: start.pid, threadId: start.threadId, exitObserved: events.some(event => event.scope === start.scope && event.type === 'exit'), lifetime: worker ? 'bounded by observed parent process; worker may be unrefed' : 'complete child process' });
    }
  }
  for (const start of starts.filter(item => item.token !== rootToken)) {
    if (!launches.some(launch => launch.token === start.token && launch.scope === start.parentScope)) uncovered.push(`Unattributed descendant: ${start.scope}`);
  }
  if (exitCode !== 0) failures.push({ reason: 'Observed command did not exit successfully', exitCode });
  return { status: uncovered.length ? 'NOT_VERIFIED' : failures.length ? 'FAIL' : 'PASS', failures, uncovered, coverage, scopes: scopes.size, modules: events.filter(event => event.type === 'module').length, root: roots[0] ?? null };
}

async function runObserved({ source, cwd = source, entry, args = [], evidenceDirectory }) {
  assert.equal(process.version, 'v22.23.3', 'Observed compilation requires the CI-pinned Node patch');
  source = canonical(source);
  cwd = canonical(cwd);
  entry = canonical(entry);
  evidenceDirectory = path.resolve(evidenceDirectory);
  assert(!inside(source, evidenceDirectory), 'Observation evidence must be outside source checkout');
  assert(Array.isArray(args) && args.every(arg => typeof arg === 'string'), 'Observed entry arguments must be strings');
  assert(!process.env.NODE_OPTIONS, 'Caller must not supply unverified Node loaders');
  fs.mkdirSync(evidenceDirectory, { mode: 0o700 });
  evidenceDirectory = canonical(evidenceDirectory);
  assert(!inside(source, evidenceDirectory), 'Canonical evidence path must be outside source checkout');
  const manifestPath = path.join(__dirname, 'exception.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(Array.isArray(manifest.files), 'Exception identities must be present');
  const forbiddenFileHashes = manifest.files.filter(file => forbiddenLocation(file.path)).map(file => file.sha256);
  assert(forbiddenFileHashes.length > 0 && forbiddenFileHashes.every(hash => /^[a-f0-9]{64}$/.test(hash)), 'Exception must identify forbidden module bytes');
  const preload = path.join(__dirname, 'preload.cjs');
  const rootToken = crypto.randomUUID();
  const configPath = path.join(evidenceDirectory, 'configuration.json');
  const config = { source, evidenceDirectory, node: process.version, rootToken, forbiddenFileHashes, manifestSha256: digest(fs.readFileSync(manifestPath)) };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const stdoutFile = path.join(evidenceDirectory, 'stdout.log');
  const stderrFile = path.join(evidenceDirectory, 'stderr.log');
  const stdout = fs.openSync(stdoutFile, 'wx', 0o600);
  const stderr = fs.openSync(stderrFile, 'wx', 0o600);
  const command = [process.execPath, '--require', preload, entry, ...args];
  const startedAt = new Date().toISOString();
  const termination = await new Promise(resolve => {
    const child = spawn(command[0], command.slice(1), { cwd, stdio: ['ignore', stdout, stderr], env: { ...process.env, MUTTER_EDGE_OBSERVATION_CONFIG: configPath, MUTTER_EDGE_CHILD_TOKEN: rootToken, MUTTER_EDGE_PARENT_SCOPE: '' } });
    let spawnError = null;
    child.once('error', error => { spawnError = { code: error.code ?? null, message: error.message }; });
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal, spawnError }));
  });
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  const events = [];
  const journals = [];
  const journalErrors = [];
  for (const name of fs.readdirSync(evidenceDirectory).filter(name => /^events-.*\.jsonl$/.test(name)).sort()) {
    const bytes = fs.readFileSync(path.join(evidenceDirectory, name));
    journals.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
    try {
      assert(bytes.toString().endsWith('\n'), 'Truncated journal');
      events.push(...bytes.toString().trimEnd().split('\n').map(line => JSON.parse(line)));
    } catch (error) { journalErrors.push({ path: name, message: error.message }); }
  }
  const inspection = inspectObservation({ events, rootToken, entry, exitCode: termination.exitCode });
  if (journalErrors.length || termination.spawnError) inspection.status = 'NOT_VERIFIED';
  const report = {
    ...inspection, ...termination, command, cwd, source, entry, entrySha256: digest(fs.readFileSync(entry)),
    node: process.version, executable: canonical(process.execPath), startedAt, finishedAt: new Date().toISOString(),
    exceptionManifestSha256: config.manifestSha256, journals, journalErrors,
    instrumentation: ['observe.cjs', 'preload.cjs', 'process-observation.cjs', 'observation-policy.cjs'].map(name => ({ path: name, sha256: digest(fs.readFileSync(path.join(__dirname, name))) })),
    stdout: { path: stdoutFile, sha256: digest(fs.readFileSync(stdoutFile)) },
    stderr: { path: stderrFile, sha256: digest(fs.readFileSync(stderrFile)) },
    events, limitations: ['Native esbuild Go binary is inventoried separately; Node hooks do not claim to instrument its internals.', 'This is bounded build instrumentation, not a sandbox against deliberate tampering with the observer.'],
  };
  fs.writeFileSync(path.join(evidenceDirectory, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return report;
}

module.exports = { runObserved, inspectObservation };
