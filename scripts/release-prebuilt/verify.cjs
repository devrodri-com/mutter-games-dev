const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { STAMP_PATH, digest, jsonBytes, sourceIdentity, outputConfiguration } = require('./identity.cjs');
const { destination, inventory, verifyInventory, scanFiles } = require('./files.cjs');
const { buildEnvironment, rejectImplicitEnvironment } = require('./environment.cjs');
const { fingerprintSource } = require('../edge-tooling/emission.cjs');
const { sourceMapTransformations } = require('./sourcemaps.cjs');
const { verifyNativeEvidence } = require('./native-evidence.cjs');

async function verifyPrebuilt(source, root) {
  const identity = await sourceIdentity(source);
  await rejectImplicitEnvironment(source);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert(['darwin', 'linux'].includes(manifest.buildHost?.platform) && ['x64', 'arm64'].includes(manifest.buildHost?.architecture), 'Build host provenance is absent');
  assert.deepEqual(manifest.identity, identity, 'Prebuilt belongs to another exact source/tooling/lock identity');
  buildEnvironment(process.env, manifest.publicConfiguration);
  assert.deepEqual(manifest.publicConfiguration, JSON.parse(await fs.readFile(path.join(source, 'scripts/release-prebuilt/public-production.json'), 'utf8')),
    'Public configuration is not bound to the reviewed source target');
  assert.equal(manifest.publicConfigurationSha256, digest(jsonBytes(manifest.publicConfiguration)));
  const expected = await outputConfiguration(source);
  assert.deepEqual(manifest.config, expected.config);
  assert.equal(manifest.functions.length, expected.functions.length);
  const output = path.join(root, '.vercel/output');
  const files = await verifyInventory(output, manifest.files);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output, 'config.json'), 'utf8')), expected.config);
  const fingerprints = await fingerprintSource(source);
  const scan = await scanFiles(output, files, fingerprints);
  const spaFiles = files.filter(file => file.path.startsWith('static/'));
  assert(spaFiles.some(file => file.path === 'static/index.html'), 'Prebuilt SPA entry is absent');
  assert(spaFiles.some(file => /^static\/assets\/.*\.js$/.test(file.path)), 'Prebuilt SPA chunks are absent');
  const spaReceipt = JSON.parse(await fs.readFile(path.join(root, 'receipts/edge/spa/result.json'), 'utf8'));
  assert.equal(spaReceipt.status, 'PASS');
  assert.equal(spaReceipt.identity.head, identity.head);
  assert.equal(spaReceipt.identity.tree, identity.tree);
  assert.equal(spaReceipt.identity.status, '');
  assert.equal(spaReceipt.typescript.status, 'PASS');
  assert.equal(spaReceipt.vite.status, 'PASS');
  assert.equal(spaReceipt.emission.status, 'PASS');
  assert.deepEqual(spaFiles.map(({ mode, path: name, ...record }) => ({ path: name.slice('static/'.length), ...record })), spaReceipt.emission.files, 'Static output differs from observed SPA graph');
  const packagingReceipt = JSON.parse(await fs.readFile(path.join(root, 'receipts/edge/packaging/result.json'), 'utf8'));
  assert.equal(packagingReceipt.status, 'PASS');
  assert.equal(packagingReceipt.identity.head, identity.head);
  assert.equal(packagingReceipt.identity.tree, identity.tree);
  assert.equal(packagingReceipt.identity.status, '');
  assert.equal(packagingReceipt.observation.status, 'PASS');
  assert.equal(packagingReceipt.emission.status, 'PASS');
  await verifyNativeEvidence(packagingReceipt.native, path.join(root, 'receipts/functions'), null);
  for (let index = 0; index < expected.functions.length; index += 1) {
    const definition = expected.functions[index];
    const declared = manifest.functions[index];
    for (const name of ['key', 'route', 'entrypoint', 'handler', 'directory', 'config'])
      assert.deepEqual(declared[name], definition[name]);
    const directory = destination(output, definition.directory);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, '.vc-config.json'), 'utf8')), definition.config);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, STAMP_PATH), 'utf8')), identity);
    assert.equal(declared.sourceManifest, `receipts/functions/output-manifest-${definition.key}.json`);
    const originalBytes = await fs.readFile(destination(root, declared.sourceManifest));
    assert.equal(digest(originalBytes), declared.sourceManifestSha256);
    const original = JSON.parse(originalBytes);
    assert.equal(original.builder, '5.10.2');
    assert.equal(original.node, 'v22.23.3');
    assert.equal(original.handler, definition.handler);
    assert.equal(original.runtime, definition.config.runtime);
    assert.equal(original.maxDuration, definition.config.maxDuration);
    assert.deepEqual(original.runtimeConfiguration, definition.config);
    for (const [name, expectedHash] of Object.entries(original.sourceHashes))
      assert.equal(digest(await fs.readFile(destination(source, name))), expectedHash, `Source provenance changed: ${name}`);
    const placeholder = original.files.find(file => file.path === STAMP_PATH);
    assert.equal(declared.transformation.path, STAMP_PATH);
    assert.equal(declared.transformation.sourceSha256, digest(await fs.readFile(path.join(source, STAMP_PATH))));
    assert.equal(placeholder.sha256, declared.transformation.sourceSha256);
    assert.equal(declared.transformation.outputSha256, digest(jsonBytes(identity)));
    const sourceMaps = await sourceMapTransformations(path.join(root, `receipts/functions/emitted/${definition.key}`), original,
      packagingReceipt.source);
    assert.deepEqual(declared.sourceMapTransformations, sourceMaps.map(map => map.transformation), 'Unattributed or changed sourcemap transformation');
    const mapsByPath = new Map(sourceMaps.map(map => [map.transformation.path, map]));
    const actual = await inventory(directory);
    const expectedFiles = original.files.filter(file => file.type !== 'directory').map(record => record.path === STAMP_PATH
      ? { ...record, bytes: jsonBytes(identity).length, sha256: digest(jsonBytes(identity)) }
      : mapsByPath.has(record.path) ? { ...record, bytes: mapsByPath.get(record.path).bytes.length, sha256: digest(mapsByPath.get(record.path).bytes) } : record);
    const configBytes = jsonBytes(definition.config);
    expectedFiles.push({ path: '.vc-config.json', type: 'file', mode: 0o644, bytes: configBytes.length, sha256: digest(configBytes) });
    expectedFiles.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    assert.deepEqual(actual.slice().sort((left, right) => left.path.localeCompare(right.path, 'en')), expectedFiles, `Incomplete or modified function archive: ${definition.key}`);
    assert(actual.some(record => record.path === definition.handler), 'Function entrypoint missing');
    assert(actual.some(record => record.path === 'api/_lib/release-attestation.js'), 'Runtime attestation not in traced function');
  }
  const recognized = files.every(file => file.path === 'config.json' || file.path.startsWith('static/')
    || expected.functions.some(definition => file.path.startsWith(`${definition.directory}/`)));
  assert(recognized, 'Unrecognized public output member');
  const native = JSON.parse(await fs.readFile(path.join(root, 'receipts/prebuilt-native/result.json'), 'utf8'));
  await verifyNativeEvidence(native, path.join(root, 'receipts/prebuilt-native'), identity);
  const receiptScan = await scanFiles(path.join(root, 'receipts'), await inventory(path.join(root, 'receipts')), fingerprints);
  return { status: 'PASS', schemaVersion: 1, identity, buildHost: manifest.buildHost, buildSourceRoot: packagingReceipt.source,
    manifestSha256: digest(await fs.readFile(path.join(root, 'manifest.json'))),
    outputFiles: files.length, functions: expected.functions.map(item => ({ name: item.key, ...item.config })),
    outputContentSha256: digest(jsonBytes(files)), scan, receiptScan,
    deploymentPerformed: false, remoteRuntime: 'NOT_VERIFIED',
    boundary: 'Complete Build Output API v3 bytes/configuration and source provenance; remote runtime and deployment remain separate gates' };
}

if (require.main === module) {
  const root = process.argv[2];
  if (!root || process.argv.length !== 3) throw new Error('Usage: node scripts/release-prebuilt/verify.cjs <artifact-root>');
  verifyPrebuilt(path.resolve(__dirname, '../..'), path.resolve(root)).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(JSON.stringify({ status: 'FAIL', message: error.message })); process.exitCode = 1;
  });
}
module.exports = { verifyPrebuilt };
