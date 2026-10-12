'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('./policy.json');
const { componentFiles } = require('./resolution.cjs');

test('current lock references preserve historical audit and every parser control', () => {
  const before = structuredClone(policy.audited);
  for (const role of ['frontend', 'admin']) {
    const files = componentFiles(policy, role);
    assert.equal(files['package-lock.json'], policy.resolutionReferences.files[role]['package-lock.json']);
    for (const [file, hash] of Object.entries(policy.audited[role].files)) {
      if (Object.hasOwn(policy.resolutionReferences.files[role], file) || Object.hasOwn(policy.candidateRevalidation.files[role], file)) continue;
      assert.equal(files[file], hash);
    }
  }
  assert.deepEqual(policy.audited, before);
});
for (const fault of ['parser', 'missing lock', 'foreign role', 'malformed hash', 'foreign task', 'audit status']) {
  test(`resolution reference rejects ${fault}`, () => {
    const changed = structuredClone(policy);
    const reference = changed.resolutionReferences;
    if (fault === 'parser') reference.files.frontend['scripts/braces-remediation/control.cjs'] = 'a'.repeat(64);
    if (fault === 'missing lock') delete reference.files.frontend['functions/package-lock.json'];
    if (fault === 'foreign role') reference.files.foreign = {};
    if (fault === 'malformed hash') reference.files.admin['package-lock.json'] = 'manual PASS';
    if (fault === 'foreign task') reference.task = 'another-task';
    if (fault === 'audit status') reference.status = 'PASS';
    assert.throws(() => componentFiles(changed, 'frontend'));
  });
}
for (const fault of ['parser', 'missing test', 'foreign role', 'foreign purpose', 'audit PASS']) {
  test(`pending candidate binding rejects ${fault}`, () => {
    const changed = structuredClone(policy);
    const candidate = changed.candidateRevalidation;
    if (fault === 'parser') candidate.files.frontend['scripts/braces-remediation/control.cjs'] = 'a'.repeat(64);
    if (fault === 'missing test') candidate.files.frontend = {};
    if (fault === 'foreign role') candidate.files.foreign = {};
    if (fault === 'foreign purpose') candidate.purpose = 'ANY_SOURCE_CHANGE';
    if (fault === 'audit PASS') candidate.status = 'PASS';
    assert.throws(() => componentFiles(changed, 'frontend'));
  });
}
