const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Finite synthetic inputs, isolated heaps and a hard process deadline. These
// bounds are containment and test budgets, not a proof of asymptotic complexity.
function boundedCase(test, worker, root, scenario) {
  test(`${path.basename(root)} / ${scenario}`, () => {
    assert.equal(process.versions.node.split('.')[0], '22');
    const fixture = worker === 'compression.cjs'
      ? fs.mkdtempSync(path.join(__dirname, '.fixture-')) : undefined;
    try {
      const result = spawnSync(process.execPath, [
        '--max-old-space-size=192', path.join(__dirname, worker), root, scenario,
        ...(fixture ? [fixture] : []),
      ], {
        timeout: 5000, killSignal: 'SIGKILL', encoding: 'utf8',
        maxBuffer: 1024 * 1024, cwd: root, env: { PATH: process.env.PATH, LANG: 'C' },
      });
      assert.equal(result.error, undefined, `${result.error?.message}\n${result.stderr}`);
      assert.equal(result.signal, null, result.stderr);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const receipt = JSON.parse(result.stdout.trim());
      assert.equal(receipt.scenario, scenario);
      assert.ok(receipt.maxRssKiB <= 192 * 1024, 'synthetic child must remain within 192 MiB RSS');
      console.log(JSON.stringify(receipt));
    } finally {
      // Supervisor owns this exact temporary directory, including after SIGKILL.
      if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
}

function workerMain(exercise) {
  const root = path.resolve(process.argv[2]);
  const scenario = process.argv[3];
  Promise.resolve().then(() => exercise(root, scenario)).then(receipt => {
    console.log(JSON.stringify({ ...receipt, scenario, node: process.version,
      maxRssKiB: process.resourceUsage().maxRSS }));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { boundedCase, workerMain };
