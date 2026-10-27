const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { verifyInstalled } = require('../inventory.cjs');
const exception = require('../exception.json');
const source = path.resolve(__dirname, '../../..');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutter-edge-inventory-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  for (const file of [...exception.locks.map(item => item.path), ...exception.packages.map(item => `${item.path}/package.json`), ...exception.files.map(item => item.path)]) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, file), target);
  }
  fs.mkdirSync(path.join(root, 'functions/node_modules'), { recursive: true });
  return root;
}

test('accepted installed presence and exact chain pass without claiming repaired bytes', t => {
  const result = verifyInstalled(fixture(t));
  assert.equal(result.status, 'PASS');
  assert.equal(result.embeddedBytesPatched, false);
  assert.equal(result.packages.length, 7);
  assert.equal(result.files.find(file => file.path.endsWith('fetch.js.text.js')).sha256, '9b01ff5b2e9dd7a08c52d68a6143ae894fa4be65c59b0dd4ea13a55118647e39');
  assert(result.dependencyChain.some(edge => edge.from === 'node_modules/vitest' && edge.optionalPeer));
});

test('modified embedded bytes fail before any module is evaluated', t => {
  const root = fixture(t), file = path.join(root, exception.files[0].path);
  const bytes = fs.readFileSync(file); bytes[0] ^= 1; fs.writeFileSync(file, bytes);
  assert.throws(() => verifyInstalled(root), { code: 'EDGE_BYTES_CHANGED' });
});

test('a different installed package version does not inherit permission', t => {
  const root = fixture(t), file = path.join(root, 'node_modules/@edge-runtime/primitives/package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8')); pkg.version = '4.1.1'; fs.writeFileSync(file, JSON.stringify(pkg));
  assert.throws(() => verifyInstalled(root), { code: 'EDGE_VERSION_CHANGED' });
});

test('an extra alias copy is recognized by package identity, not directory name', t => {
  const root = fixture(t), directory = path.join(root, 'node_modules/innocent-alias');
  fs.mkdirSync(directory); fs.copyFileSync(path.join(root, 'node_modules/@edge-runtime/primitives/package.json'), path.join(directory, 'package.json'));
  assert.throws(() => verifyInstalled(root), { code: 'EDGE_UNAPPROVED_COPY' });
});

test('an extra copy nested in Functions is outside the exception', t => {
  const root = fixture(t), directory = path.join(root, 'functions/node_modules/alias');
  fs.mkdirSync(directory); fs.copyFileSync(path.join(root, 'node_modules/@edge-runtime/vm/package.json'), path.join(directory, 'package.json'));
  assert.throws(() => verifyInstalled(root), { code: 'EDGE_UNAPPROVED_COPY' });
});

test('modified dependency lock suspends the reviewed chain', t => {
  const root = fixture(t), file = path.join(root, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(file, 'utf8')); lock.packages['node_modules/@vercel/node'].dependencies['@edge-runtime/primitives'] = '4.1.1'; fs.writeFileSync(file, JSON.stringify(lock));
  assert.throws(() => verifyInstalled(root), { code: 'EDGE_LOCK_CHANGED' });
});

test('missing inspected bytes are not a zero-copy success', t => {
  const root = fixture(t); fs.unlinkSync(path.join(root, exception.files[0].path));
  assert.throws(() => verifyInstalled(root), { code: 'EDGE_INSPECTION_MISSING' });
});

test('missing installation is not a zero-copy success', t => {
  const root = fixture(t); fs.rmSync(path.join(root, 'functions/node_modules'), { recursive: true });
  assert.throws(() => verifyInstalled(root), { code: 'EDGE_INSPECTION_MISSING' });
});

test('package symlink cannot hide an extra installation', t => {
  const root = fixture(t); fs.symlinkSync('./@edge-runtime/primitives', path.join(root, 'node_modules/alias'));
  assert.throws(() => verifyInstalled(root), { code: 'EDGE_INSTALLATION_LINK' });
});

test('installed metadata drift is rejected even with unchanged version', t => {
  const root = fixture(t), file = path.join(root, 'node_modules/@edge-runtime/primitives/package.json');
  fs.appendFileSync(file, '\n');
  assert.throws(() => verifyInstalled(root), { code: 'EDGE_PACKAGE_CHANGED' });
});
