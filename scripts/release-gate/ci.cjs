'use strict';
const { assert, fs, path, write, identity, trusted, context, audits, policy } = require('./common.cjs');
const [command, role, output, input] = process.argv.slice(2);
const root = path.resolve(__dirname, '../..');
const installed = trusted(root, role), binding = context(root);
fs.mkdirSync(output, { recursive: true });
if (command === 'build') {
  const paired = role === 'frontend' ? identity(path.join(root, 'paired-admin-api')) : identity(path.join(root, 'test-harness'));
  assert.equal(paired.head, role === 'frontend' ? process.env.WEB_INVENTORY_ADMIN_SHA : policy.harness);
  write(path.join(output, 'build.json'), { context: binding, installed, paired });
} else if (command === 'assess') {
  const needs = JSON.parse(process.env.RELEASE_NEEDS_JSON);
  assert.equal(needs.build.result, 'success');
  if (role === 'frontend') assert.equal(needs['first-cutover-controls'].result, 'success');
  const results = audits(root, role, input, binding);
  const rawFailed = results.some(r => r.nativeAuditExit !== 0);
  assert.equal(needs.security.result, rawFailed ? 'failure' : 'success', 'Unexpected security dependency state');
  write(path.join(output, 'assessment.json'), { context: binding, results, needs,
    SECURITY_DISPOSITION: rawFailed ? 'VERIFIED_SOURCE_REMEDIATION' : 'NATIVE_AUDIT_CLEAN',
    NPM_AUDIT_RAW_STATUS: rawFailed ? 'FAIL' : 'PASS',
    RELEASE_TECHNICAL_GATE_STATUS: 'NOT_VERIFIED_UNTIL_EXTERNAL_PAIR_VERIFICATION',
    PRODUCTION_APPLICATION_AUTHORIZED: false });
} else throw new Error('Unknown CI gate operation');
