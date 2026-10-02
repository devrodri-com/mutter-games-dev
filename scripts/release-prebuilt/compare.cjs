const assert = require('node:assert/strict');
const path = require('node:path');
const { verifyPrebuilt } = require('./verify.cjs');

async function compareBuilds(source, first, second) {
  assert.notEqual(path.resolve(first), path.resolve(second), 'Reproducibility requires two independent builds');
  const a = await verifyPrebuilt(source, first);
  const b = await verifyPrebuilt(source, second);
  assert.deepEqual(a.identity, b.identity, 'Build inputs differ');
  assert.deepEqual(a.buildHost, b.buildHost, 'Cross-platform reproducibility is outside this comparison gate');
  assert.equal(a.outputContentSha256, b.outputContentSha256, 'Repeated build output bytes/modes/files differ');
  return { status: 'PASS', identity: a.identity, buildHost: a.buildHost,
    distinctCheckoutRoots: a.buildSourceRoot !== b.buildSourceRoot, outputContentSha256: a.outputContentSha256,
    boundary: 'Two complete independent builds on the same platform/architecture with the same source/public configuration/Node/builder/locks; all output bytes, modes and symlink targets match. Only generated map sources are normalized. Execution receipts retain original paths, timestamps and process identities.' };
}
if (require.main === module) {
  const [first, second] = process.argv.slice(2);
  if (!first || !second || process.argv.length !== 4) throw new Error('Usage: node scripts/release-prebuilt/compare.cjs <first-artifact> <second-artifact>');
  compareBuilds(path.resolve(__dirname, '../..'), path.resolve(first), path.resolve(second)).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(JSON.stringify({ status: 'FAIL', message: error.message })); process.exitCode = 1; });
}
module.exports = { compareBuilds };
