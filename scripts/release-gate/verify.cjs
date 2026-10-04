'use strict';
const { execFileSync, spawnSync } = require('node:child_process');
const { assert, fs, path, sha, read, write, git, policy, identity, trusted, scopes, audits } = require('./common.cjs');
const { request, pages, download, artifact } = require('./github.cjs');
const { validateRun, validateCheckout, validateJobs, validateAssessment, validatePair } = require('./results.cjs');

function verifyRun(role, root, runId, attempt, output) {
  assert(Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(attempt) && attempt > 0);
  root = fs.realpathSync(root); output = path.resolve(output);
  assert(!output.startsWith(root + path.sep), 'Evidence must be outside source');
  const installed = trusted(root, role, true), target = identity(root);
  const repo = policy.audited[role].repository;
  assert([`https://github.com/${repo}.git`, `https://github.com/${repo}`, `git@github.com:${repo}.git`].includes(git(root, 'remote', 'get-url', 'origin')));
  fs.mkdirSync(output, { recursive: false });
  const base = `repos/${repo}/actions/runs/${runId}`;
  const current = request(base); write(path.join(output, 'current-run.json'), current);
  validateRun(current, role, target.head, attempt);
  const run = request(`${base}/attempts/${attempt}`); write(path.join(output, 'run.json'), run);
  validateRun(run, role, target.head, attempt);
  const jobPages = pages(`${base}/attempts/${attempt}/jobs`, 'jobs'); write(path.join(output, 'jobs-pages.json'), jobPages.records);
  const artifactPages = pages(`${base}/artifacts`, 'artifacts'); write(path.join(output, 'artifacts-pages.json'), artifactPages.records);
  const fetch = name => download(artifact(artifactPages.items, name), run, name, path.join(output, name));
  const buildDirectory = fetch(`release-build-${role}-${attempt}`), build = read(path.join(buildDirectory, 'build.json'));
  assert.deepEqual(fs.readdirSync(buildDirectory), ['build.json']);
  const headCommit = request(`repos/${repo}/commits/${target.head}`);
  const checkoutCommit = request(`repos/${repo}/commits/${build.context.checkout}`);
  write(path.join(output, 'head-commit.json'), headCommit); write(path.join(output, 'checkout-commit.json'), checkoutCommit);
  validateCheckout(build.context, run, headCommit, checkoutCommit, sha(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'))));
  assert.equal(build.context.tree, target.tree); assert.equal(build.context.job, 'build');
  assert.deepEqual(build.installed, installed);
  for (const { directory, scope } of scopes(role)) {
    const name = `native-audit-${directory}-${scope}-${attempt}`, extracted = fetch(name);
    assert.deepEqual(fs.readdirSync(extracted).sort(), ['context.json', `${scope}.json`, `${scope}.receipt.json`, `${scope}.stderr.log`].sort());
    // Same-run downloads are kept intact. Evaluator gets a directory of exact names.
    const input = path.join(output, 'audit-input'); fs.mkdirSync(input, { recursive: true });
    fs.cpSync(extracted, path.join(input, name), { recursive: true, errorOnExist: true, force: false });
  }
  const results = audits(root, role, path.join(output, 'audit-input'), build.context);
  const assessmentDirectory = fetch(`release-assessment-${role}-${attempt}`);
  assert.deepEqual(fs.readdirSync(assessmentDirectory), ['assessment.json']);
  const assessment = read(path.join(assessmentDirectory, 'assessment.json'));
  validateAssessment(assessment, results, build.context);
  const expected = read(path.join(root, 'scripts/release-gate/jobs.json'));
  validateJobs(jobPages.items, expected, results, run);
  const logs = path.join(output, 'logs.zip'), fd = fs.openSync(logs, 'wx'); let logResult;
  try { logResult = spawnSync('gh', ['api', '--method', 'GET', `${base}/attempts/${attempt}/logs`], { stdio: ['ignore', fd, 'pipe'], timeout: 120000 }); }
  finally { fs.closeSync(fd); }
  if (logResult.error) throw logResult.error;
  assert.equal(logResult.status, 0, 'Logs unavailable'); assert.equal(logResult.signal, null);
  if (role === 'admin') {
    assert.equal(build.paired.head, policy.harness);
    const harness = request(`repos/devrodri-com/mutter-games-dev/commits/${policy.harness}`);
    assert.equal(build.paired.tree, harness.commit.tree.sha); write(path.join(output, 'harness-commit.json'), harness);
  }
  const result = { role, repository: repo, target, context: build.context, paired: build.paired,
    runId, attempt, CI_GLOBAL_STATUS: run.conclusion, results, logsSha256: sha(fs.readFileSync(logs)),
    status: 'REPOSITORY_PREREQUISITES_VERIFIED', PRODUCTION_APPLICATION_AUTHORIZED: false };
  const after = request(base); write(path.join(output, 'run-after-verification.json'), after);
  validateRun(after, role, target.head, attempt);
  assert.equal(after.conclusion, run.conclusion, 'Run changed during verification');
  write(path.join(output, 'verified-run.json'), result);
  return { result, run, artifacts: artifactPages.items, fetch };
}
function loadedBytes(root, extracted) {
  const manifest = read(path.join(root, 'scripts/braces-remediation/manifest.json'));
  const proof = [];
  for (const stage of ['spa/vite', 'packaging/builder']) {
    const directory = path.join(extracted, 'receipts/edge', stage), modules = new Set();
    for (const file of fs.readdirSync(directory).filter(f => /^events-.*\.jsonl$/.test(f))) {
      for (const line of fs.readFileSync(path.join(directory, file), 'utf8').trim().split('\n')) {
        const e = JSON.parse(line); if (e.type !== 'module' || !e.url?.includes('/node_modules/braces/')) continue;
        const relative = e.url.split('/node_modules/braces/')[1];
        assert(Object.hasOwn(manifest.patchedFiles, relative), 'Unknown loaded braces source');
        assert.equal(e.sourceSha256, manifest.patchedFiles[relative]); assert.equal(e.fileSha256, manifest.patchedFiles[relative]);
        modules.add(relative);
      }
    }
    for (const f of ['index.js', 'lib/parse.js', 'lib/compile.js', 'lib/expand.js', 'lib/stringify.js', 'lib/constants.js', 'lib/utils.js']) assert(modules.has(f), `Missing actual loaded module: ${stage}/${f}`);
    proof.push({ stage, modules: [...modules].sort(), hashesVerified: true });
  }
  return proof;
}
function verifyPrebuilt(root, verification, output) {
  assert.equal(verification.run.event, 'push', 'Candidate artifact requires exact branch checkout; PR evidence is accepted separately for Admin');
  const name = `mutter-stock-prebuilt-CANDIDATE-PENDING-GATE-AUDIT-${verification.run.run_attempt}`;
  const meta = artifact(verification.artifacts, name), files = verification.fetch(name);
  assert.deepEqual(fs.readdirSync(files), ['mutter-prebuilt.tar.gz']);
  const tar = path.join(files, 'mutter-prebuilt.tar.gz'), extracted = path.join(output, 'prebuilt');
  execFileSync('python3', [path.join(__dirname, 'archive.py'), 'tar', tar, extracted], { stdio: 'pipe' });
  // Execute only the trusted source verifier, with no management/business environment.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  const child = spawnSync(process.execPath, [path.join(root, 'scripts/release-prebuilt/ci.cjs'), 'verify', extracted], { cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  fs.writeFileSync(path.join(output, 'prebuilt-verify.stdout.log'), child.stdout || '');
  fs.writeFileSync(path.join(output, 'prebuilt-verify.stderr.log'), child.stderr || '');
  if (child.error) throw child.error;
  write(path.join(output, 'prebuilt-verify.exit.json'), { exitCode: child.status, signal: child.signal });
  assert.equal(child.status, 0, 'Trusted prebuilt verification failed'); assert.equal(child.signal, null);
  const manifest = read(path.join(extracted, 'manifest.json'));
  assert.equal(manifest.identity.head, verification.result.target.head); assert.equal(manifest.identity.tree, verification.result.target.tree);
  for (const file of manifest.files) assert(!/(?:^|\/)node_modules\/(?:braces|micromatch|fast-glob|chokidar)\//.test(file.path), 'Unexpected repaired tooling emitted');
  return { id: meta.id, name, officialDigest: meta.digest, tarSha256: sha(fs.readFileSync(tar)),
    manifestSha256: sha(fs.readFileSync(path.join(extracted, 'manifest.json'))), identity: manifest.identity,
    loaded: loadedBytes(root, extracted), verificationExit: child.status, candidateStatus: 'PENDING_GATE_AUDIT' };
}
function verifyPair(config, output) {
  const { storeRoot, adminRoot, storeRun, adminRun, storeAttempt, adminAttempt } = config;
  fs.mkdirSync(output, { recursive: false });
  const admin = verifyRun('admin', adminRoot, adminRun, adminAttempt, path.join(output, 'admin'));
  const store = verifyRun('frontend', storeRoot, storeRun, storeAttempt, path.join(output, 'frontend'));
  const text = fs.readFileSync(path.join(storeRoot, '.github/workflows/ci.yml'), 'utf8');
  validatePair(store.result, admin.result, text);
  const prebuilt = verifyPrebuilt(storeRoot, store, path.join(output, 'frontend'));
  for (const [role, item] of [['admin', admin], ['frontend', store]]) {
    const after = request(`repos/${item.result.repository}/actions/runs/${item.result.runId}`);
    validateRun(after, role, item.result.target.head, item.result.attempt);
    assert.equal(after.conclusion, item.run.conclusion, 'Run changed during artifact verification');
    write(path.join(output, `${role}-final-run.json`), after);
  }
  const results = [...store.result.results, ...admin.result.results]; assert.equal(results.length, 6);
  const receipt = { schema: 1, policy: policy.id, auditReportSha256: policy.auditReportSha256,
    targets: { store: store.result.target, admin: admin.result.target }, runs: { store: store.result, admin: admin.result },
    artifact: prebuilt, SECURITY_DISPOSITION: results.some(r => r.nativeAuditExit) ? 'VERIFIED_SOURCE_REMEDIATION' : 'NATIVE_AUDIT_CLEAN',
    NPM_AUDIT_RAW_STATUS: results.some(r => r.nativeAuditExit) ? 'FAIL' : 'PASS',
    CI_GLOBAL_STATUS: { store: store.run.conclusion, admin: admin.run.conclusion },
    RELEASE_TECHNICAL_GATE_STATUS: 'PASS', INDEPENDENT_RELEASE_GATE_AUDIT: 'PENDING',
    PRODUCTION_APPLICATION_AUTHORIZED: false, PRE_CUTOVER_READY: false, STOCK_RELEASE_READY: false };
  write(path.join(output, 'technical-receipt.json'), receipt);
  return receipt;
}
module.exports = { verifyRun, verifyPair, verifyPrebuilt, loadedBytes };
