'use strict';
const { assert, policy, sameContext } = require('./common.cjs');
function validateRun(run, role, head, attempt) {
  assert.equal(run.repository?.full_name, policy.audited[role].repository);
  assert.equal(run.path, '.github/workflows/ci.yml');
  assert.equal(run.head_sha, head); assert.equal(run.head_branch, policy.branch);
  assert.equal(run.run_attempt, attempt); assert.equal(run.status, 'completed', 'Run incomplete');
  assert(['push', 'pull_request'].includes(run.event));
  assert(['success', 'failure'].includes(run.conclusion), 'Cancelled/unknown run');
}
function validateCheckout(binding, run, headCommit, checkoutCommit, workflowSha256) {
  assert.equal(binding.repository, run.repository.full_name);
  assert.equal(binding.event, run.event); assert.equal(binding.runId, run.id);
  assert.equal(binding.attempt, run.run_attempt); assert.equal(binding.head, run.head_sha);
  assert.equal(binding.workflowSha256, workflowSha256);
  assert.equal(headCommit.sha, run.head_sha); assert.equal(checkoutCommit.sha, binding.checkout);
  assert.equal(binding.tree, checkoutCommit.commit.tree.sha);
  assert.equal(binding.tree, headCommit.commit.tree.sha, 'PR tested a different tree');
  if (run.event === 'push') {
    assert.equal(binding.ref, `refs/heads/${policy.branch}`); assert.equal(binding.checkout, binding.head);
  } else {
    assert(/^refs\/pull\/[1-9][0-9]*\/merge$/.test(binding.ref));
    assert.notEqual(binding.checkout, binding.head, 'PR merge confused with branch HEAD');
    assert.equal(checkoutCommit.parents.length, 2);
    assert.equal(checkoutCommit.parents[1].sha, binding.head);
    assert(run.pull_requests.some(p => binding.ref === `refs/pull/${p.number}/merge` && p.head.sha === binding.head
      && p.base.sha === checkoutCommit.parents[0].sha), 'PR parents not bound to run');
  }
}
function validateJobs(jobs, expected, native, run) {
  assert.equal(jobs.length, Object.keys(expected).length, 'Extra/missing CI jobs');
  assert.equal(new Set(jobs.map(j => j.name)).size, jobs.length, 'Duplicate jobs');
  for (const [name, definition] of Object.entries(expected)) {
    const job = jobs.find(j => j.name === name);
    assert(job, `Missing job: ${name}`);
    assert.equal(job.run_id, run.id); assert.equal(job.run_attempt, run.run_attempt);
    assert.equal(job.status, 'completed', `Job incomplete: ${name}`);
    const audit = definition.audit && native.find(n => n.directory === definition.audit.directory && n.scope === definition.audit.scope);
    const failure = audit?.nativeAuditExit === 1;
    assert.equal(job.conclusion, failure ? 'failure' : 'success', `Unexpected job result: ${name}`);
    for (const required of definition.steps) {
      const found = job.steps.filter(s => s.name === required);
      assert.equal(found.length, 1, `Missing/duplicate required step: ${name}/${required}`);
      assert.equal(found[0].status, 'completed');
      assert.equal(found[0].conclusion, failure && required === 'Native required dependency audit' ? 'failure' : 'success', `Step did not pass: ${name}/${required}`);
    }
    for (const step of job.steps) {
      if (definition.steps.includes(step.name)) continue;
      assert(['Set up job', 'Complete job'].includes(step.name) || step.name.startsWith('Post '), `Unclassified step: ${step.name}`);
      assert.equal(step.status, 'completed');
      assert(step.conclusion === 'success' || (step.name.startsWith('Post ') && step.conclusion === 'skipped'), 'Additional step failed');
    }
  }
  assert.equal(run.conclusion, native.some(n => n.nativeAuditExit === 1) ? 'failure' : 'success', 'Unexplained global result');
}
function validateAssessment(assessment, results, expected) {
  sameContext(assessment.context, expected, 'source-remediation');
  assert.deepEqual(assessment.results, results, 'Internal and external classification differ');
  assert.equal(assessment.NPM_AUDIT_RAW_STATUS, results.some(x => x.nativeAuditExit) ? 'FAIL' : 'PASS');
}
function validatePair(store, admin, workflow) {
  assert.deepEqual(store.paired, admin.target, 'Wrong paired Admin');
  assert.equal(workflow.match(/^      WEB_INVENTORY_ADMIN_SHA: ([a-f0-9]{40})$/m)?.[1], admin.target.head, 'Admin must be literally pinned');
  assert.equal(store.results.length, 4); assert.equal(admin.results.length, 2);
}
module.exports = { validateRun, validateCheckout, validateJobs, validateAssessment, validatePair };
