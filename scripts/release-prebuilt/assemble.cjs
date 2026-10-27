const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { STAMP_PATH, digest, jsonBytes, outputConfiguration } = require('./identity.cjs');
const { destination, inventory, verifyInventory } = require('./files.cjs');
const { sourceMapTransformations } = require('./sourcemaps.cjs');

async function copyFiles(source, target, records) {
  for (const record of records) {
    const output = destination(target, record.path);
    await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o755 });
    if (record.type === 'directory') { await fs.mkdir(output, { recursive: true, mode: record.mode }); continue; }
    if (record.type === 'symlink') await fs.symlink(record.target, output);
    else {
      await fs.copyFile(destination(source, record.path), output, fs.constants.COPYFILE_EXCL);
      await fs.chmod(output, record.mode);
    }
  }
}
async function assemble(source, root, identity, publicConfig) {
  const output = path.join(root, '.vercel/output');
  await fs.mkdir(output, { recursive: true, mode: 0o755 });
  const expected = await outputConfiguration(source);
  const spaReceipt = JSON.parse(await fs.readFile(path.join(root, 'receipts/edge/spa/result.json'), 'utf8'));
  const packagingReceipt = JSON.parse(await fs.readFile(path.join(root, 'receipts/edge/packaging/result.json'), 'utf8'));
  for (const receipt of [spaReceipt, packagingReceipt]) {
    assert.equal(receipt.status, 'PASS');
    assert.equal(receipt.identity.head, identity.head);
    assert.equal(receipt.identity.tree, identity.tree);
    assert.equal(receipt.identity.status, '');
  }
  const spaRecords = await inventory(path.join(source, 'dist'));
  const spaExpected = spaReceipt.emission.files;
  assert.deepEqual(spaRecords.map(({ mode, ...record }) => record), spaExpected, 'SPA changed after observed written-byte inspection');
  await copyFiles(path.join(source, 'dist'), path.join(output, 'static'), spaRecords);
  const functions = [];
  for (const definition of expected.functions) {
    const manifestFile = path.join(root, `receipts/functions/output-manifest-${definition.key}.json`);
    const builderManifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    assert.equal(builderManifest.handler, definition.handler);
    assert.equal(builderManifest.runtime, definition.config.runtime);
    assert.equal(builderManifest.maxDuration, definition.config.maxDuration);
    assert.deepEqual(builderManifest.runtimeConfiguration, definition.config);
    assert.equal(builderManifest.builder, '5.10.2');
    const originalDirectory = path.join(root, `receipts/functions/emitted/${definition.key}`);
    const records = await inventory(originalDirectory);
    const byPath = (left, right) => left.path.localeCompare(right.path, 'en');
    assert.deepEqual(records.slice().sort(byPath), builderManifest.files.filter(record => record.type !== 'directory').sort(byPath), 'Official builder bytes changed before assembly');
    const originalStamp = records.find(record => record.path === STAMP_PATH);
    assert(originalStamp?.type === 'file', 'Official builder did not trace the build identity JSON');
    const placeholder = await fs.readFile(path.join(source, STAMP_PATH));
    assert.equal(originalStamp.sha256, digest(placeholder), 'Builder stamp placeholder differs from source');
    const directory = destination(output, definition.directory);
    await copyFiles(originalDirectory, directory, records);
    const sourceMaps = await sourceMapTransformations(originalDirectory, builderManifest, source);
    for (const map of sourceMaps) await fs.writeFile(path.join(directory, map.transformation.path), map.bytes);
    await fs.writeFile(path.join(directory, STAMP_PATH), jsonBytes(identity), { mode: originalStamp.mode });
    await fs.writeFile(path.join(directory, '.vc-config.json'), jsonBytes(definition.config), { flag: 'wx', mode: 0o644 });
    functions.push({ ...definition, sourceManifest: `receipts/functions/output-manifest-${definition.key}.json`,
      sourceManifestSha256: digest(await fs.readFile(manifestFile)),
      sourceMapTransformations: sourceMaps.map(map => map.transformation),
      transformation: { path: STAMP_PATH, sourceSha256: originalStamp.sha256, outputSha256: digest(jsonBytes(identity)),
        reason: 'Generated immutable data-only target identity. No builder, source handler or dependency patch.' } });
  }
  await fs.writeFile(path.join(output, 'config.json'), jsonBytes(expected.config), { flag: 'wx', mode: 0o644 });
  const files = await inventory(output);
  await verifyInventory(output, files);
  const manifest = { schemaVersion: 1, identity, buildHost: { platform: process.platform, architecture: process.arch }, config: expected.config, functions, files,
    publicConfiguration: publicConfig, publicConfigurationSha256: digest(jsonBytes(publicConfig)),
    assembly: 'Official Build Output API v3; exact official materialization, observed Vite output, explicit configuration, data-only build stamp and declared generated sourcemap sources normalization',
    noRemoteBuild: true, remoteDeploymentPerformed: false };
  await fs.writeFile(path.join(root, 'manifest.json'), jsonBytes(manifest), { flag: 'wx', mode: 0o600 });
  return manifest;
}

module.exports = { assemble, copyFiles };
