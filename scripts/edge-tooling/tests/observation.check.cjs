const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { runObserved, inspectObservation } = require('../observe.cjs');

const source = fs.realpathSync(path.resolve(__dirname, '../../..'));
const root = process.env.EDGE_CONTROL_TEST_EVIDENCE_DIR
  ? path.resolve(process.env.EDGE_CONTROL_TEST_EVIDENCE_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'mutter-edge-observation-tests-'));
if (process.env.EDGE_CONTROL_TEST_EVIDENCE_DIR) fs.mkdirSync(root, { mode: 0o700 });
console.log(JSON.stringify({ gate: 'edge-observation-tests', evidenceDirectory: root }));

async function run(name, code, extension = 'cjs') {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { mode: 0o700 });
  const entry = path.join(directory, `entry.${extension}`);
  fs.writeFileSync(entry, code, { flag: 'wx', mode: 0o600 });
  const result = await runObserved({ source, entry, cwd: source, evidenceDirectory: path.join(directory, 'observation') });
  console.log(JSON.stringify({ case: name, status: result.status, commandExitCode: result.exitCode, modules: result.modules, scopes: result.scopes, violationCount: result.failures.length, uncoveredCount: result.uncovered.length }));
  return result;
}

function prohibited(result) {
  assert.notEqual(result.status, 'PASS');
  assert(result.events.some(event => event.type === 'violation' && event.code === 'FORBIDDEN_LOAD'));
  assert(!result.events.some(event => event.type === 'module' && /@edge-runtime\/primitives/.test(event.url)));
}

test('installed Edge remains present while benign CJS and ESM execution passes', async () => {
  const before = fs.readFileSync(path.join(source, 'node_modules/@edge-runtime/primitives/dist/fetch.js.text.js'));
  const cjs = await run('allowed-cjs', "const assert = require('node:assert/strict'); assert.equal(2 + 3, 5);\n");
  const esm = await run('allowed-esm', "import assert from 'node:assert/strict'; assert.equal(2 + 3, 5);\n", 'mjs');
  assert.equal(cjs.status, 'PASS');
  assert.equal(esm.status, 'PASS');
  assert.deepEqual(fs.readFileSync(path.join(source, 'node_modules/@edge-runtime/primitives/dist/fetch.js.text.js')), before);
});

test('CJS require and ESM import are rejected before forbidden module evaluation', async () => {
  prohibited(await run('blocked-cjs', "require('@edge-runtime/primitives');\n"));
  prohibited(await run('blocked-esm', "await import('@edge-runtime/primitives');\n", 'mjs'));
});

test('caught forbidden-load errors remain sticky and prevent a successful gate', async () => {
  const result = await run('caught-blocked-load', "try { require('@edge-runtime/primitives'); } catch (error) { if (error.code !== 'EDGE_OBSERVATION_FORBIDDEN_LOAD') throw error; }\n");
  assert.equal(result.exitCode, 0);
  prohibited(result);
});

test('absolute paths, symlinks and renamed identified payloads cannot bypass the guard', async () => {
  const forbidden = path.join(source, 'node_modules/@edge-runtime/primitives/dist/index.js');
  prohibited(await run('blocked-absolute', `require(${JSON.stringify(forbidden)});\n`));
  const link = path.join(root, 'primitives-link.cjs');
  fs.symlinkSync(forbidden, link);
  prohibited(await run('blocked-symlink', `require(${JSON.stringify(link)});\n`));
  const copy = path.join(root, 'renamed-payload.cjs');
  fs.copyFileSync(path.join(source, 'node_modules/@edge-runtime/primitives/dist/fetch.js.text.js'), copy, fs.constants.COPYFILE_EXCL);
  prohibited(await run('blocked-renamed-payload', `require(${JSON.stringify(copy)});\n`));
});

test('official dev-server entrypoint is rejected before its imports execute', async () => {
  const url = pathToFileURL(path.join(source, 'node_modules/@vercel/node/dist/dev-server.mjs')).href;
  prohibited(await run('blocked-dev-server', `await import(${JSON.stringify(url)});\n`, 'mjs'));
});

test('Node child has a separate observed scope; caught child violations cannot pass', async () => {
  const allowed = await run('allowed-node-child', "const { spawnSync } = require('node:child_process'); const result = spawnSync(process.execPath, ['-e', 'require(\"node:assert/strict\").equal(2+3,5)']); if (result.status !== 0) throw new Error('child failed');\n");
  assert.equal(allowed.status, 'PASS');
  assert(allowed.coverage.some(item => item.kind === 'Node-child'));
  const blocked = await run('blocked-node-child', "const { spawnSync } = require('node:child_process'); spawnSync(process.execPath, ['-e', 'try { require(\"@edge-runtime/primitives\"); } catch (error) { if (error.code !== \"EDGE_OBSERVATION_FORBIDDEN_LOAD\") throw error; }']);\n");
  assert.equal(blocked.exitCode, 0);
  prohibited(blocked);
});

test('Worker execArgv empty preserves its observation and blocks forbidden imports', async () => {
  const allowed = await run('allowed-worker', "const { Worker } = require('node:worker_threads'); const worker = new Worker('require(\"node:assert/strict\").equal(2+3,5)', { eval: true, execArgv: [] }); worker.on('error', error => { throw error; });\n");
  assert.equal(allowed.status, 'PASS');
  assert(allowed.coverage.some(item => item.kind === 'Node-worker'));
  const blocked = await run('blocked-worker', "const { Worker } = require('node:worker_threads'); const worker = new Worker('try { require(\"@edge-runtime/primitives\"); } catch (error) { if (error.code !== \"EDGE_OBSERVATION_FORBIDDEN_LOAD\") throw error; }', { eval: true, execArgv: [] }); worker.on('error', error => { throw error; });\n");
  assert.equal(blocked.exitCode, 0);
  prohibited(blocked);
});

test('ESM named Worker receives the same observer and data URL code is covered', async () => {
  const code = 'import assert from "node:assert/strict"; assert.equal(2+3,5);';
  const url = `data:text/javascript,${encodeURIComponent(code)}`;
  const result = await run('allowed-esm-worker', `import { Worker } from 'node:worker_threads'; const worker = new Worker(new URL(${JSON.stringify(url)}), { execArgv: [] }); worker.on('error', error => { throw error; });\n`, 'mjs');
  assert.equal(result.status, 'PASS');
  assert(result.coverage.some(item => item.kind === 'Node-worker'));
});

test('execFile, promisified execFile, execFileSync and fork preserve results with observed descendants', async () => {
  const child = path.join(root, 'fork-child.cjs');
  fs.writeFileSync(child, "require('node:assert/strict').equal(2+3,5);\n", { flag: 'wx' });
  const result = await run('node-process-overloads', `
    const assert = require('node:assert/strict');
    const cp = require('node:child_process');
    const { promisify } = require('node:util');
    const { once } = require('node:events');
    (async () => {
      assert.equal(cp.execFileSync(process.execPath, ['-e', 'process.stdout.write("sync")'], { encoding: 'utf8' }), 'sync');
      await new Promise((resolve, reject) => cp.execFile(process.execPath, ['-e', 'process.stdout.write("callback")'], (error, stdout, stderr) => {
        if (error) return reject(error);
        assert.equal(stdout, 'callback'); assert.equal(stderr, ''); resolve();
      }));
      const result = promisify(cp.execFile)(process.execPath, ['-e', 'process.stdout.write("promise")']);
      assert(result.child.pid > 0);
      assert.deepEqual(await result, { stdout: 'promise', stderr: '' });
      const forked = cp.fork(${JSON.stringify(child)}, [], { execArgv: [], silent: true });
      const [code] = await once(forked, 'exit'); assert.equal(code, 0);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `);
  assert.equal(result.status, 'PASS');
  assert.equal(result.coverage.filter(item => item.kind === 'Node-child').length, 4);
});

test('ESM named child-process imports cannot omit the guard', async () => {
  const result = await run('blocked-esm-child', `
    import { spawnSync } from 'node:child_process';
    spawnSync(process.execPath, ['-e', 'require("@edge-runtime/primitives")']);
  `, 'mjs');
  assert.equal(result.exitCode, 0);
  prohibited(result);
});

test('a parent cannot hide a real Node child failure by exiting zero', async () => {
  const result = await run('failed-node-child', "require('node:child_process').spawnSync(process.execPath, ['-e', 'process.exitCode = 7']);\n");
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, 'FAIL');
  assert(result.failures.some(failure => failure.reason === 'Observed Node descendant exited unsuccessfully' && failure.exitCode === 7));
});

test('unknown native process, shell and extra loader are NOT_VERIFIED even if caught', async () => {
  for (const [name, operation] of [
    ['unknown-native', "require('node:child_process').spawnSync('/usr/bin/true', [])"],
    ['shell', "require('node:child_process').execSync('true')"],
    ['extra-loader', "require('node:child_process').spawnSync(process.execPath, ['--loader=unverified-loader', '-e', '0'])"],
    ['extra-preload', "require('node:child_process').spawnSync(process.execPath, ['--require=unverified-preload', '-e', '0'])"],
    ['extra-worker-preload', "new (require('node:worker_threads').Worker)('0', { eval: true, execArgv: ['--require=unverified-preload'] })"],
    ['extra-loader-registration', "require('node:module').register('unverified-loader', require('node:url').pathToFileURL(__filename))"],
    ['extra-hooks-registration', "require('node:module').registerHooks({ resolve: () => ({ url: 'unverified', shortCircuit: true }) })"],
  ]) {
    const result = await run(name, `try { ${operation}; } catch (error) { if (error.code !== 'EDGE_OBSERVATION_NOT_VERIFIED') throw error; }\n`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.status, 'NOT_VERIFIED');
    assert(result.uncovered.length > 0);
  }
});

test('missing inspection, descendant handshake or event records can never mean zero approved', async () => {
  const result = await run('coverage-receipt', "require('node:child_process').spawnSync(process.execPath, ['-e', 'require(\"node:path\")']);\n");
  assert.equal(result.status, 'PASS');
  const input = { rootToken: result.root.token, entry: result.entry, exitCode: 0 };
  assert.equal(inspectObservation({ ...input, events: [] }).status, 'NOT_VERIFIED');
  const child = result.events.find(event => event.type === 'start' && event.parentScope);
  assert(child);
  assert.equal(inspectObservation({ ...input, events: result.events.filter(event => event.scope !== child.scope) }).status, 'NOT_VERIFIED');
  const rootModule = result.events.find(event => event.type === 'module' && event.scope === result.root.scope);
  assert(rootModule);
  assert.equal(inspectObservation({ ...input, events: result.events.filter(event => event !== rootModule) }).status, 'NOT_VERIFIED');
});
