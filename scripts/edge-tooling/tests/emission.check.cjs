// Disposable validator fixtures; production build/emission is exercised by the
// required guarded build and packaging commands, not replaced by these fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { inspectNodeArtifacts, inspectSpaArtifacts, fingerprintSource, digest } = require('../emission.cjs');
const exception = require('../exception.json');
const source = path.resolve(__dirname, '../../..');

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mutter-edge-emission-negative-')));
  assert(!root.startsWith(`${source}${path.sep}`), 'Canary must be outside publishable source/artifacts');
  t.after(() => fs.rm(root, { recursive: true }));
  const emitted = path.join(root, 'emitted');
  const entries = [];
  for (const key of require('../../checkout-packaging/function-definitions.cjs').DEFINITIONS.map(item => item.key)) {
    const directory = path.join(emitted, key);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'handler.js'), 'export const synthetic = true;\n');
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'synthetic-emission-fixture', version: '1.0.0' }));
    entries.push({ key, directory, handler: 'handler.js', manifestPath: path.join(root, `${key}.json`) });
  }
  async function update(entry) {
    const files = [];
    const packageScopes = [];
    for (const name of (await fs.readdir(entry.directory)).sort()) {
      const bytes = await fs.readFile(path.join(entry.directory, name));
      files.push({ path: name, type: 'file', bytes: bytes.length, sha256: digest(bytes) });
      if (name === 'package.json') {
        const metadata = JSON.parse(bytes);
        packageScopes.push({ path: name, sha256: digest(bytes), name: metadata.name, version: metadata.version });
      }
    }
    const manifest = { key: entry.key, directory: entry.directory, handler: entry.handler, runtime: 'nodejs22.x', files, packageScopes };
    await fs.writeFile(entry.manifestPath, JSON.stringify(manifest));
    entry.manifestSha256 = digest(await fs.readFile(entry.manifestPath));
  }
  for (const entry of entries) await update(entry);
  return { root, emitted, entries, update };
}
async function spaFixture(t) {
  const node = await fixture(t);
  const dist = path.join(node.root, 'spa');
  await fs.mkdir(dist);
  const bytes = Buffer.from('console.log("synthetic graph fixture");');
  await fs.writeFile(path.join(dist, 'a.js'), bytes);
  const inventory = { schemaVersion: 1, stage: 'POST_BUILD_WRITTEN_BYTES', source, dist, files: [{ path: 'a.js', type: 'file', bytes: bytes.length, sha256: digest(bytes) }], chunks: [{ path: 'a.js', bytes: bytes.length, sha256: digest(bytes), modules: ['\0synthetic-fixture'] }], modules: [{ id: '\0synthetic-fixture', virtual: true, chunks: ['a.js'] }] };
  return { dist, inventory };
}
const notVerified = error => error.code === 'NOT_VERIFIED';
const forbidden = error => error.code === 'EDGE_EMISSION_FORBIDDEN';

test('accepted bytes may remain installed while clean emitted graphs pass', async t => {
  const data = await fixture(t);
  assert.equal((await inspectNodeArtifacts(source, data, data.entries)).status, 'PASS');
  assert.equal((await fingerprintSource(source)).identity.sha256, exception.files.find(item => item.path.endsWith('/fetch.js.text.js')).sha256);
});
test('corrected npm Undici is not confused with the embedded 5.23.0 copy', async t => {
  const data = await fixture(t);
  await fs.writeFile(path.join(data.entries[0].directory, 'package.json'), JSON.stringify({ name: 'undici', version: '6.28.1' }));
  await data.update(data.entries[0]);
  assert.equal((await inspectNodeArtifacts(source, data, data.entries)).status, 'PASS');
});
test('renamed exact payload is rejected even with a complete matching output manifest', async t => {
  const data = await fixture(t);
  const { raw } = await fingerprintSource(source);
  await fs.writeFile(path.join(data.entries[0].directory, 'ordinary-name.bin'), raw);
  await data.update(data.entries[0]);
  await assert.rejects(inspectNodeArtifacts(source, data, data.entries), forbidden);
});
test('decoded renamed payload is rejected without its original wrapper or package name', async t => {
  const data = await fixture(t);
  const { body } = await fingerprintSource(source);
  await fs.writeFile(path.join(data.entries[1].directory, 'z.js'), body);
  await data.update(data.entries[1]);
  await assert.rejects(inspectNodeArtifacts(source, data, data.entries), forbidden);
});
test('distributed identified byte fragments in renamed output are rejected', async t => {
  const data = await fixture(t);
  const { windows } = await fingerprintSource(source);
  await fs.writeFile(path.join(data.entries[1].directory, 'z.bin'), Buffer.concat(windows.slice(0, 3).map(item => item.bytes)));
  await data.update(data.entries[1]);
  await assert.rejects(inspectNodeArtifacts(source, data, data.entries), forbidden);
});
test('forbidden package provenance fails even when emitted code is minified beyond byte recognition', async t => {
  const data = await fixture(t);
  await fs.writeFile(path.join(data.entries[0].directory, 'package.json'), JSON.stringify({ name: '@edge-runtime/primitives', version: '4.1.0' }));
  await data.update(data.entries[0]);
  await assert.rejects(inspectNodeArtifacts(source, data, data.entries), forbidden);
});
test('corrupt final bytes do not inherit a passing manifest', async t => {
  const data = await fixture(t);
  await fs.appendFile(path.join(data.entries[0].directory, 'handler.js'), '// changed');
  await assert.rejects(inspectNodeArtifacts(source, data, data.entries), notVerified);
});
test('unlisted emitted files and missing Node inspection both fail closed', async t => {
  const data = await fixture(t);
  await fs.writeFile(path.join(data.entries[0].directory, 'unlisted.js'), 'synthetic');
  await assert.rejects(inspectNodeArtifacts(source, data, data.entries), notVerified);
  await assert.rejects(inspectNodeArtifacts(source, data, []), notVerified);
  delete data.entries[0].manifestSha256;
  await assert.rejects(inspectNodeArtifacts(source, data, data.entries), notVerified);
});
test('SPA graph and post-write hashes pass together; missing graph is NOT_VERIFIED', async t => {
  const { dist, inventory } = await spaFixture(t);
  assert.equal((await inspectSpaArtifacts(source, dist, inventory)).status, 'PASS');
  await assert.rejects(inspectSpaArtifacts(source, dist, null), notVerified);
  inventory.modules = [];
  await assert.rejects(inspectSpaArtifacts(source, dist, inventory), notVerified);
});
test('SPA contaminated provenance fails even when minified bytes have generic names', async t => {
  const { dist, inventory } = await spaFixture(t);
  inventory.modules[0].package = { name: '@edge-runtime/vm' };
  await assert.rejects(inspectSpaArtifacts(source, dist, inventory), forbidden);
});
test('SPA final-write mutation and stale chunk hashes fail closed', async t => {
  const { dist, inventory } = await spaFixture(t);
  await fs.appendFile(path.join(dist, 'a.js'), ' ');
  await assert.rejects(inspectSpaArtifacts(source, dist, inventory), notVerified);
  const bytes = await fs.readFile(path.join(dist, 'a.js'));
  inventory.files[0].bytes = bytes.length;
  inventory.files[0].sha256 = digest(bytes);
  await assert.rejects(inspectSpaArtifacts(source, dist, inventory), notVerified);
});
test('renamed payload in SPA asset is rejected as bytes, independently of module names', async t => {
  const { dist, inventory } = await spaFixture(t);
  const { raw } = await fingerprintSource(source);
  await fs.writeFile(path.join(dist, 'image.bin'), raw);
  inventory.files.push({ path: 'image.bin', type: 'file', bytes: raw.length, sha256: digest(raw) });
  await assert.rejects(inspectSpaArtifacts(source, dist, inventory), forbidden);
});

test('fully inventoried JavaScript without a module graph is NOT_VERIFIED', async t => {
  const { dist, inventory } = await spaFixture(t);
  const bytes = Buffer.from('console.log("extra synthetic JavaScript");');
  await fs.writeFile(path.join(dist, 'extra.js'), bytes);
  inventory.files.push({ path: 'extra.js', type: 'file', bytes: bytes.length, sha256: digest(bytes) });
  await assert.rejects(inspectSpaArtifacts(source, dist, inventory), notVerified);
});

test('missing on-disk inspection returns NOT_VERIFIED with its real I/O cause', async t => {
  const data = await fixture(t);
  await fs.unlink(data.entries[0].manifestPath);
  await assert.rejects(inspectNodeArtifacts(source, data, data.entries), error => error.code === 'NOT_VERIFIED' && error.causeCode === 'ENOENT');
});
test('invalid inspection JSON is unavailable evidence, not a clean artifact', async t => {
  const data = await fixture(t);
  await fs.writeFile(data.entries[0].manifestPath, '{invalid fixture JSON');
  data.entries[0].manifestSha256 = digest(await fs.readFile(data.entries[0].manifestPath));
  await assert.rejects(inspectNodeArtifacts(source, data, data.entries), error => error.code === 'NOT_VERIFIED' && error.cause instanceof SyntaxError);
});

test('real ESM build driver imports the CommonJS inspection boundary without named-export inference', async () => {
  const driver = await import('../build-spa.mjs');
  assert.equal(typeof driver.buildSpa, 'function');
});
