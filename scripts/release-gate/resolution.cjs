'use strict';
const assert = require('node:assert/strict');
const permitted = {
  frontend: ['functions/package-lock.json', 'package-lock.json', 'scripts/edge-tooling/exception.json'],
  admin: ['package-lock.json'],
};

function componentFiles(policy, role) {
  assert(Object.hasOwn(permitted, role), 'Unknown repository role');
  const historical = policy.audited[role].files;
  const references = policy.resolutionReferences;
  if (references === undefined) {
    assert.equal(policy.candidateRevalidation, undefined, 'Candidate binding cannot replace resolution references');
    return historical;
  }
  assert(references && typeof references === 'object' && !Array.isArray(references), 'Malformed resolution references');
  assert.equal(references.schema, 1);
  assert.equal(references.task, 'MUTTER_GUEST_REENTRY_AND_SIX_DEPENDENCY_REMEDIATION_20261012');
  assert.equal(references.authorizationContractSha256, '76b6bf46e8e0051d2d9cd944dfc64235db194abf3e50f1979da9ce6fffaf12dc');
  assert.equal(references.status, 'RESOLUTION_REFERENCE_ONLY_NOT_INDEPENDENT_AUDIT');
  assert(references.files && typeof references.files === 'object' && !Array.isArray(references.files));
  assert.deepEqual(Object.keys(references.files).sort(), ['admin', 'frontend']);
  for (const [scope, files] of Object.entries(references.files)) {
    assert(files && typeof files === 'object' && !Array.isArray(files));
    assert.deepEqual(Object.keys(files).sort(), permitted[scope]);
    for (const [file, hash] of Object.entries(files)) {
      assert(Object.hasOwn(policy.audited[scope].files, file), 'Foreign protected component');
      assert(typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash), 'Malformed resolution hash');
    }
  }
  const candidate = policy.candidateRevalidation;
  assert(candidate && typeof candidate === 'object' && !Array.isArray(candidate));
  assert.equal(candidate.schema, 1);
  assert.equal(candidate.task, references.task);
  assert.equal(candidate.authorizationContractSha256, references.authorizationContractSha256);
  assert.equal(candidate.status, 'PENDING_INDEPENDENT_REVALIDATION');
  assert.equal(candidate.purpose, 'TEMP_SYNTHETIC_RECEIPT_LOCK_BINDING');
  assert(candidate.files && typeof candidate.files === 'object' && !Array.isArray(candidate.files));
  assert.deepEqual(Object.keys(candidate.files).sort(), ['admin', 'frontend']);
  for (const [scope, files] of Object.entries(candidate.files)) {
    assert(files && typeof files === 'object' && !Array.isArray(files));
    assert.deepEqual(Object.keys(files), ['scripts/braces-remediation/evaluate.check.cjs']);
    const file = 'scripts/braces-remediation/evaluate.check.cjs';
    assert(Object.hasOwn(policy.audited[scope].files, file));
    assert(typeof files[file] === 'string' && /^[a-f0-9]{64}$/.test(files[file]));
  }
  return { ...historical, ...references.files[role], ...candidate.files[role] };
}
module.exports = { componentFiles };
