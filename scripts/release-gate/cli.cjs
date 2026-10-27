'use strict';
const { path, read, write, assert } = require('./common.cjs');
const { verifyRun, verifyPair } = require('./verify.cjs');
const { publicationCheck, PublicationBlocked } = require('./publication.cjs');
function failureResult(error) {
  return { RELEASE_TECHNICAL_GATE_STATUS: error instanceof PublicationBlocked ? 'PASS' : error.code === 'ERR_ASSERTION' ? 'FAIL' : 'NOT_VERIFIED',
    ...(error instanceof PublicationBlocked ? { PUBLICATION_PREREQUISITES: 'NOT_VERIFIED' } : {}),
    PRODUCTION_APPLICATION_AUTHORIZED: false, error: error.message };
}
async function main(args) {
  const [command, ...rest] = args;
  if (command === 'verify-run') {
    assert.equal(rest.length, 5);
    const [role, root, run, attempt, output] = rest;
    const { result } = verifyRun(role, path.resolve(root), Number(run), Number(attempt), path.resolve(output));
    console.log(JSON.stringify(result, null, 2)); return result;
  }
  assert(['verify-pair', 'publication-check'].includes(command) && rest.length === 2,
    'Usage: verify-run <role> <root> <run> <attempt> <new-output>; verify-pair|publication-check <config.json> <new-output>');
  const config = read(rest[0]), output = path.resolve(rest[1]);
  for (const key of ['storeRoot', 'adminRoot']) assert(path.isAbsolute(config[key]), 'Absolute trusted checkout required');
  // No command accepts a hand-written or historical PASS receipt as proof.
  const technical = verifyPair(config, output);
  let result = technical;
  if (command === 'publication-check') {
    try { result = await publicationCheck(config, technical); }
    catch (error) { throw new PublicationBlocked(error); }
  }
  if (command === 'publication-check') write(path.join(output, 'publication-prerequisites.json'), result);
  console.log(JSON.stringify(result, null, 2)); return result;
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  console.error(JSON.stringify(failureResult(error)));
  process.exitCode = 1;
});
module.exports = { main, failureResult };
