'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const policy = require('./policy.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
function identity(root) {
  return { head: git(root, 'rev-parse', 'HEAD'), tree: git(root, 'rev-parse', 'HEAD^{tree}') };
}
function components(root, role, clean = false) {
  assert(Object.hasOwn(policy.audited, role), 'Unknown repository role');
  const expected = policy.audited[role];
  for (const [file, hash] of Object.entries(expected.files))
    assert.equal(sha(fs.readFileSync(path.join(root, file))), hash, `Audited component changed: ${file}`);
  assert.equal(fs.readFileSync(path.join(root, 'scripts/release-gate/policy.json'), 'utf8'), fs.readFileSync(path.join(__dirname, 'policy.json'), 'utf8'), 'Different trust policy');
  if (clean) assert.equal(git(root, 'status', '--porcelain=v1', '--untracked-files=normal'), '', 'Exact source must be clean');
}
function trusted(root, role, clean = false) {
  components(root, role, clean);
  // Load only after the immutable audited source has been checked.
  return require(path.join(root, 'scripts/braces-remediation/control.cjs')).inspect(root);
}
function context(root, env = process.env) {
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) assert(/^[1-9][0-9]*$/.test(env[key]), `Missing ${key}`);
  assert(['push', 'pull_request'].includes(env.GITHUB_EVENT_NAME), 'Unsupported event');
  const event = read(env.GITHUB_EVENT_PATH), actual = identity(root);
  assert.equal(actual.head, env.GITHUB_SHA, 'Actual event checkout differs');
  const head = env.GITHUB_EVENT_NAME === 'pull_request' ? event.pull_request?.head?.sha : actual.head;
  assert(/^[a-f0-9]{40}$/.test(head));
  assert.equal(env.GITHUB_EVENT_NAME === 'pull_request' ? event.pull_request.head.ref : env.GITHUB_REF.replace(/^refs\/heads\//, ''), policy.branch);
  return { repository: env.GITHUB_REPOSITORY, event: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF,
    runId: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT), job: env.GITHUB_JOB,
    head, checkout: actual.head, tree: actual.tree,
    workflowSha256: sha(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'))) };
}
function sameContext(a, b, job) {
  for (const key of ['repository', 'event', 'ref', 'runId', 'attempt', 'head', 'checkout', 'tree', 'workflowSha256'])
    assert.equal(a?.[key], b?.[key], `Foreign evidence: ${key}`);
  if (job) assert.equal(a.job, job, 'Wrong evidence job');
}
function scopes(role) {
  return (role === 'frontend' ? ['root', 'functions'] : ['admin']).flatMap(directory => ['prod', 'all'].map(scope => ({ directory, scope })));
}
function audits(root, role, input, expected) {
  trusted(root, role);
  const evaluate = require(path.join(root, 'scripts/braces-remediation/evaluate.cjs')).evaluate;
  return scopes(role).map(({ directory, scope }) => {
    const name = `native-audit-${directory}-${scope}-${expected.attempt}`;
    const folder = path.join(input, name), binding = read(path.join(folder, 'context.json'));
    sameContext(binding.context, expected, 'security');
    assert.equal(binding.directory, directory); assert.equal(binding.scope, scope);
    assert.equal(binding.receiptSha256, sha(fs.readFileSync(path.join(folder, `${scope}.receipt.json`))));
    assert.equal(binding.stderrSha256, sha(fs.readFileSync(path.join(folder, `${scope}.stderr.log`))));
    const assessment = evaluate(directory === 'functions' ? path.join(root, 'functions') : root, folder, scope);
    return { directory, scope, ...assessment,
      SECURITY_DISPOSITION: assessment.nativeAuditExit ? 'VERIFIED_SOURCE_REMEDIATION' : 'NATIVE_AUDIT_CLEAN' };
  });
}
module.exports = { assert, fs, path, sha, read, write, git, policy, identity, components, trusted, context, sameContext, scopes, audits };
