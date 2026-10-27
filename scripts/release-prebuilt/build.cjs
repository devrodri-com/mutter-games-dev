// Produces official Build Output API files only. This program cannot deploy.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildEnvironment, rejectImplicitEnvironment } = require('./environment.cjs');
const { jsonBytes, sourceIdentity } = require('./identity.cjs');
const { inside } = require('./files.cjs');
const { assemble } = require('./assemble.cjs');
const { verifyPrebuilt } = require('./verify.cjs');
const { verifyNativeProcesses } = require('../checkout-packaging/sandbox.cjs');

async function runGate(source, root, name, entry, env) {
  const command = [process.execPath, path.join(source, entry)];
  if (name === 'spa') command.push('build');
  const startedAt = new Date().toISOString();
  const stdoutFile = await fs.open(path.join(root, 'receipts', `${name}.stdout.log`), 'wx', 0o600);
  const stderrFile = await fs.open(path.join(root, 'receipts', `${name}.stderr.log`), 'wx', 0o600);
  const result = await new Promise(resolve => {
    const child = spawn(command[0], command.slice(1), { cwd: source, env, stdio: ['ignore', stdoutFile.fd, stderrFile.fd] });
    let errorCode = null;
    child.once('error', error => { errorCode = error.code ?? error.name; });
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal, errorCode }));
  });
  await stdoutFile.close(); await stderrFile.close();
  const receipt = { name, command, startedAt, finishedAt: new Date().toISOString(), ...result };
  await fs.writeFile(path.join(root, 'receipts', `${name}.gate.json`), jsonBytes(receipt), { flag: 'wx', mode: 0o600 });
  assert.equal(result.exitCode, 0, `Required ${name} gate failed; original stdout/stderr and exit status preserved`);
  return receipt;
}

async function buildPrebuilt(source, requestedRoot, publicConfigFile) {
  source = await fs.realpath(source);
  const identity = await sourceIdentity(source);
  await rejectImplicitEnvironment(source);
  const publicConfig = JSON.parse(await fs.readFile(publicConfigFile, 'utf8'));
  assert.deepEqual(publicConfig, JSON.parse(await fs.readFile(path.join(source, 'scripts/release-prebuilt/public-production.json'), 'utf8')),
    'Prebuilt public configuration must match the reviewed source target');
  const env = buildEnvironment(process.env, publicConfig);
  let root = path.resolve(requestedRoot);
  assert(!inside(source, root), 'Prebuilt output must be outside the clean checkout');
  await fs.mkdir(root, { mode: 0o700 });
  root = await fs.realpath(root);
  assert(!inside(source, root), 'Canonical prebuilt output must be outside checkout');
  await fs.mkdir(path.join(root, 'receipts'), { mode: 0o700 });
  const gatedEnvironment = { ...env,
    EDGE_TOOLING_EVIDENCE_DIR: path.join(root, 'receipts/edge'),
    CHECKOUT_PACKAGING_EVIDENCE_DIR: path.join(root, 'receipts/functions'),
  };
  const gates = [];
  gates.push(await runGate(source, root, 'spa', 'scripts/verify-edge-tooling.cjs', gatedEnvironment));
  gates.push(await runGate(source, root, 'functions', 'scripts/verify-checkout-packaging.cjs', gatedEnvironment));
  assert.deepEqual(await sourceIdentity(source), identity, 'Source identity changed during build');
  const manifest = await assemble(source, root, identity, publicConfig);
  const nativeRoot = path.join(root, 'receipts/prebuilt-native');
  await fs.mkdir(path.join(nativeRoot, 'child-home/.config'), { recursive: true, mode: 0o700 });
  const native = await verifyNativeProcesses(source, { root: nativeRoot, emitted: path.join(root, '.vercel/output/functions') },
    manifest.functions.map(item => ({ key: item.key, handler: item.handler, directory: path.join(root, '.vercel/output', item.directory) })),
    { attestationIdentity: identity });
  assert(native.cases.every(item => item.passed), 'Stamped prebuilt native invocation failed');
  await fs.writeFile(path.join(nativeRoot, 'result.json'), jsonBytes(native), { flag: 'wx', mode: 0o600 });
  const result = await verifyPrebuilt(source, root);
  const receipt = { ...result, gates, builtAt: new Date().toISOString(),
    environmentKeys: Object.keys(gatedEnvironment).sort(),
    credentialEnvironmentInherited: false,
    noImplicitEnvironmentFiles: true };
  await fs.writeFile(path.join(root, 'verification.json'), jsonBytes(receipt), { flag: 'wx', mode: 0o600 });
  return receipt;
}
if (require.main === module) {
  const [root, publicConfig] = process.argv.slice(2);
  if (!root || process.argv.length > 4) throw new Error('Usage: node scripts/release-prebuilt/build.cjs <new-artifact-root> [public-config.json]');
  buildPrebuilt(path.resolve(__dirname, '../..'), root, publicConfig ?? path.join(__dirname, 'public-production.json'))
    .then(result => console.log(JSON.stringify(result))).catch(error => {
      console.error(JSON.stringify({ status: 'FAIL', message: error.message })); process.exitCode = 1;
    });
}
module.exports = { buildPrebuilt, runGate };
