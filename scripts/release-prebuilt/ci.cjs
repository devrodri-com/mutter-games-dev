// A narrow process boundary, not a deployment command or token exception in build.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isolatedCiEnvironment } = require('./environment.cjs');
const publicConfig = require('./public-production.json');

const [operation, ...args] = process.argv.slice(2);
const entries = { build: 'build.cjs', verify: 'verify.cjs', negative: 'test-output.cjs', compare: 'compare.cjs' };
assert(Object.hasOwn(entries, operation), 'Unknown prebuilt CI operation');
assert.equal(args.length, operation === 'compare' ? 2 : 1, 'Expected exact artifact paths');
assert.equal(process.version, 'v22.23.3');
const boundary = isolatedCiEnvironment(process.env, publicConfig);
console.log(JSON.stringify({ gate: 'prebuilt-ci-isolation', operation, removedInfrastructureNames: boundary.removedInfrastructureNames,
  inheritedEnvironmentNames: Object.keys(boundary.env).sort(), credentialValuesLogged: false, businessCredentialRejectionPreserved: true }));
const result = spawnSync(process.execPath, [path.join(__dirname, entries[operation]), ...args], {
  env: boundary.env, cwd: path.resolve(__dirname, '../..'), stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.signal) console.error(JSON.stringify({ gate: 'prebuilt-ci-child', signal: result.signal, exitCode: result.status }));
process.exitCode = result.status ?? 1;
