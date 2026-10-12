'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspect } = require('./inventory.cjs');
const root = path.resolve(__dirname, '../..');

function fixture() {
  // Reduced real-byte fixtures test the installation trust boundary. Actual npm
  // installations and complete parent resolution are checked by preflight.
  const admin = fs.existsSync(path.join(root, 'functions/package.json'))
    ? path.resolve(process.env.MUTTER_ADMIN_API_SOURCE || path.join(root, '../admin-api')) : root;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutter-six-integrity-'));
  fs.copyFileSync(path.join(admin, 'package-lock.json'), path.join(temp, 'package-lock.json'));
  for (const pkg of ['@fastify/busboy', 'smol-toml'])
    fs.cpSync(path.join(admin, 'node_modules', pkg), path.join(temp, 'node_modules', pkg), { recursive: true });
  for (const pkg of ['firebase-admin', '@vercel/python-analysis']) {
    const target = path.join(temp, 'node_modules', pkg); fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(path.join(admin, 'node_modules', pkg, 'package.json'), path.join(target, 'package.json'));
  }
  return temp;
}

test('reduced fixture accepts exact official bytes and actual parent resolution', () => {
  const temp = fixture();
  try {
    const result = inspect(temp, 'admin');
    assert.deepEqual(result.copies.map(copy => copy.name).sort(), ['@fastify/busboy', 'smol-toml']);
    assert(result.copies.every(copy => copy.parents.length > 0 && copy.verifiedOfficialFileCount > 0));
  } finally { fs.rmSync(temp, { recursive: true }); }
});
for (const fault of ['source bytes', 'extra copy', 'integrity', 'version', 'linked payload']) {
  test(`installation proof rejects ${fault}`, () => {
    const temp = fixture();
    try {
      inspect(temp, 'admin');
      const busboy = path.join(temp, 'node_modules/@fastify/busboy');
      if (fault === 'source bytes') fs.appendFileSync(path.join(busboy, 'index.js'), '\n');
      if (fault === 'extra copy') fs.cpSync(busboy, path.join(temp, 'node_modules/firebase-admin/node_modules/@fastify/busboy'), { recursive: true });
      if (fault === 'linked payload') fs.symlinkSync('../foreign', path.join(busboy, 'linked.js'));
      if (fault === 'integrity' || fault === 'version') {
        const lockFile = path.join(temp, 'package-lock.json');
        const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        lock.packages['node_modules/@fastify/busboy'][fault] = fault === 'version' ? '3.2.1' : 'sha512-foreign';
        fs.writeFileSync(lockFile, JSON.stringify(lock));
      }
      assert.throws(() => inspect(temp, 'admin'));
    } finally { fs.rmSync(temp, { recursive: true }); }
  });
}
