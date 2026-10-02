const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EXPECTED_NATIVE_CASE_LABELS } = require('../checkout-packaging/sandbox.cjs');

const BACKENDS = new Set(['macos-sandbox-exec', 'inherited-macos-sandbox-with-effective-denial-check',
  'linux-unprivileged-network-namespace', 'linux-sudo-network-namespace']);
function verifyNativeMatrix(native, expectedIdentity) {
  assert(native && BACKENDS.has(native.backend), 'Unverified native network backend');
  assert.deepEqual(native.attestationIdentity, expectedIdentity, 'Native identity is not the expected build identity');
  for (const [key, value] of Object.entries({ eachInvocationHasFreshProcess: true, nativeLoader: true, graphMocks: false,
    apiReplacements: false, credentialsInherited: false, homePreservedNotRepurposed: true })) assert.equal(native[key], value, `Native guarantee missing: ${key}`);
  assert(Array.isArray(native.cases), 'Native cases missing');
  const labels = native.cases.map(row => row.label);
  assert.equal(new Set(labels).size, labels.length, 'Duplicate native case');
  assert.deepEqual([...labels].sort(), [...EXPECTED_NATIVE_CASE_LABELS].sort(), 'Incomplete native case matrix');
  for (const row of native.cases) {
    assert.equal(row.backend, native.backend);
    assert.equal(row.exitCode, 0); assert.equal(row.signal, null); assert.equal(row.spawnError, null);
    assert.equal(row.passed, true); assert.equal(row.observation?.passed, true);
    assert.equal(row.observation.node, 'v22.23.3');
    assert(row.observation.network && Object.values(row.observation.network).every(value => value === 0), 'Native business I/O was attempted');
  }
  for (const handler of ['checkout', 'reconcile']) {
    const authorized = native.cases.find(row => row.label === `attestation-${handler}-authorized`).observation;
    const retry = native.cases.find(row => row.label === `attestation-${handler}-retry`).observation;
    const missing = native.cases.find(row => row.label === `attestation-${handler}-missing-undici`).observation;
    for (const sample of [authorized, retry]) {
      assert.equal(sample.verification.status, expectedIdentity ? 'VERIFIED' : 'NOT_VERIFIED');
      assert.equal(sample.receipt.handler, handler); assert.equal(sample.receipt.node, 'v22.23.3');
      assert.equal(sample.receipt.nativeUndici, '6.28.1');
      assert.deepEqual(sample.receipt.buildIdentity, expectedIdentity);
      assert.equal(typeof sample.receipt.coldStartId, 'string');
    }
    assert.notEqual(authorized.receipt.coldStartId, retry.receipt.coldStartId);
    assert.equal(missing.verification.status, 'NOT_VERIFIED');
    assert.equal(missing.nativeUndiciRemovedForNegativeControl, true);
    assert.equal(missing.receipt.nativeUndici, null);
  }
  assert(Array.isArray(native.networkCanaries) && native.networkCanaries.length > 0, 'Network canary evidence missing');
  const selected = native.networkCanaries.filter(row => row.passed);
  assert.equal(selected.length, 1, 'Ambiguous effective network denial');
  const canary = selected[0];
  assert.equal(native.networkCanaries.at(-1), canary);
  assert.equal(canary.backend, native.backend); assert.equal(canary.exitCode, 0);
  assert.equal(canary.signal, null); assert.equal(canary.spawnError, null); assert.equal(canary.observation?.passed, true);
  assert.equal(canary.observation.mode, 'canary'); assert.equal(canary.observation.node, 'v22.23.3');
  const codes = native.backend.startsWith('linux-') ? ['ENETUNREACH', 'EHOSTUNREACH', 'EPERM', 'EACCES'] : ['EPERM', 'EACCES'];
  assert(codes.includes(canary.observation.denialCode), 'No effective network denial');
  assert(canary.observation.network && Object.values(canary.observation.network).some(value => Number.isInteger(value) && value > 0), 'Network observer did not detect the canary attempt');
  if (native.backend.startsWith('linux-')) assert.equal(canary.observation.networkNamespaceIsolated, true);
  return { status: 'PASS', cases: labels.length, backend: native.backend };
}

async function verifyNativeEvidence(native, root, expectedIdentity) {
  const matrix = verifyNativeMatrix(native, expectedIdentity);
  const isolation = JSON.parse(await fs.readFile(path.join(root, 'network-isolation.json'), 'utf8'));
  assert.equal(isolation.selected, native.backend);
  assert.equal(isolation.unrestrictedFallback, false);
  assert.equal(isolation.credentialEnvironmentInherited, false);
  assert.equal(isolation.homePreservedNotRepurposed, true);
  assert.deepEqual(isolation.attempts, native.networkCanaries);
  for (const row of [...native.cases, ...native.networkCanaries])
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, `${row.label}.json`), 'utf8')), row, 'Native summary differs from original case receipt');
  return matrix;
}
module.exports = { verifyNativeMatrix, verifyNativeEvidence };
