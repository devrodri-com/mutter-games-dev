const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

async function identity(source) {
  assert.equal(process.version, 'v22.23.3', 'Use the reviewed Node patch; a runtime change requires review');
  for (const key of ['FIREBASE_PRIVATE_KEY', 'MP_ACCESS_TOKEN', 'IMAGEKIT_PRIVATE_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'CRON_SECRET', 'WEB_ADMISSION_HMAC_SECRET']) {
    assert(!process.env[key], `Business credential is forbidden in the build gate: ${key}`);
  }
  const git = args => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
  const inputs = {};
  for (const name of ['package.json', 'package-lock.json', 'functions/package-lock.json', 'vercel.json', 'scripts/edge-tooling/exception.json']) {
    inputs[name] = digest(await fs.readFile(path.join(source, name)));
  }
  return { head: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']),
    status: git(['status', '--porcelain=v1']), node: process.version, nativeUndici: process.versions.undici,
    builder: JSON.parse(await fs.readFile(path.join(source, 'node_modules/@vercel/node/package.json'), 'utf8')).version, inputs };
}

async function createEvidence(source, phase) {
  assert(['spa', 'packaging'].includes(phase), 'Unknown controlled phase');
  const requested = process.env.EDGE_TOOLING_EVIDENCE_DIR;
  const preserve = typeof requested === 'string' && requested.length > 0;
  const root = preserve ? path.resolve(requested) : await fs.mkdtemp(path.join(os.tmpdir(), 'mutter-edge-control-'));
  assert(!inside(source, root), 'Evidence must be outside the checkout');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  assert(!inside(source, await fs.realpath(root)), 'Evidence resolves inside checkout');
  const directory = path.join(root, phase);
  await fs.mkdir(directory, { mode: 0o700 });
  return { root, directory, preserve };
}

async function writeReport(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

async function readEvidence(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    throw Object.assign(new Error(`Required inspection receipt unavailable: ${file} (${error.code ?? error.name})`), { code: 'NOT_VERIFIED', cause: error });
  }
}

function requirePass(result, label) {
  if (result?.status !== 'PASS') {
    throw Object.assign(new Error(`${label}: ${result?.status ?? 'NOT_VERIFIED'}`), {
      code: result?.status === 'FAIL' ? 'EDGE_CONTROL_FAILED' : 'NOT_VERIFIED',
    });
  }
}

const failureStatus = error => /NOT_VERIFIED|INSPECTION_MISSING/.test(error.code ?? '') ? 'NOT_VERIFIED' : 'FAIL';

module.exports = { identity, createEvidence, writeReport, readEvidence, requirePass, failureStatus, digest };
