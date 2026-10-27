'use strict';
const { pathToFileURL } = require('node:url');
const { assert, fs, path, sha, read } = require('./common.cjs');
class PublicationBlocked extends Error {
  constructor(cause) { super(cause.message, { cause }); this.name = 'PublicationBlocked'; }
}
function reviewEvidence(review, report, technical) {
  assert.equal(technical.RELEASE_TECHNICAL_GATE_STATUS, 'PASS', 'Technical gate missing');
  assert.equal(review?.status, 'PASS_EXACT_TARGET', 'Independent wiring review pending');
  assert.deepEqual(review.targets, technical.targets, 'Review belongs to another pair');
  assert.equal(review.reportSha256, sha(report), 'Independent report integrity');
  const text = report.toString('utf8');
  assert(text.includes('RODRI_AUDIT_STATUS=PASS_READY_FOR_OWNER_DECISION'), 'Report has no favorable independent verdict');
  for (const target of Object.values(technical.targets)) for (const value of [target.head, target.tree])
    assert(text.includes(value), 'Report does not identify the exact pair');
  assert.equal(review.artifactDigest, technical.artifact.officialDigest, 'Review artifact differs');
}
async function publicationCheck(config, technical) {
  assert(config.reviewFile && config.cutoverEvidenceFile && config.cutoverAuthorizationFile, 'Independent review and operational evidence required');
  const review = read(config.reviewFile);
  assert(typeof review.reportPath === 'string' && !path.isAbsolute(review.reportPath) && !review.reportPath.split(/[\\/]/).includes('..'));
  const report = fs.readFileSync(path.join(path.dirname(config.reviewFile), review.reportPath));
  reviewEvidence(review, report, technical);
  const input = read(config.cutoverEvidenceFile);
  assert.deepEqual(input.targets, technical.targets);
  assert.equal(input.artifact.sha256, technical.artifact.tarSha256, 'Cutover references another artifact');
  assert.equal(input.audit.evidenceSha256, review.reportSha256);
  assert(Math.abs(Date.now() - input.nowMs) <= 60000, 'Cutover evaluation time is stale');
  const authorization = fs.readFileSync(config.cutoverAuthorizationFile, 'utf8');
  // This is an identified operator-supplied authorization document, not inferred from CI.
  assert.equal(input.applicationAuthorization?.sha256, sha(authorization));
  assert.equal(input.applicationAuthorization?.status, 'EXPLICIT_CURRENT_CUTOVER_AUTHORIZATION');
  for (const target of Object.values(technical.targets)) assert(authorization.includes(target.head), 'Cutover authority lacks exact targets');
  const mod = await import(pathToFileURL(path.join(config.storeRoot, 'scripts/first-cutover/policy.mjs')).href);
  const operational = mod.evaluateFirstCutover(input), integrity = await mod.verifyReceiptFiles(input, config.cutoverEvidenceFile);
  return { RELEASE_TECHNICAL_GATE_STATUS: 'PASS', PUBLICATION_PREREQUISITES: 'EVIDENCE_CONSISTENT', operational, integrity,
    independentReviewReportSha256: review.reportSha256, authorizationSha256: sha(authorization),
    documentAuthorshipAndAuthorityRequireTrustedOperatorHandoff: true,
    PRODUCTION_APPLICATION_AUTHORIZED_BY_THIS_TOOL: false, remoteEnforcementAttestedByThisTool: false };
}
module.exports = { reviewEvidence, publicationCheck, PublicationBlocked };
