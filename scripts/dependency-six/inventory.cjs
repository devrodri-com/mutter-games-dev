'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { packageInventory } = require('../braces-remediation/control.cjs');
const definition = require('./targets.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
const scopes = {
  root: ['@fastify/busboy', 'compression', 'postcss-selector-parser', 'proxy-addr', 'source-map-js'],
  functions: ['@fastify/busboy', 'proxy-addr'],
  admin: ['@fastify/busboy', 'smol-toml'],
};

function packageFiles(directory) {
  const files = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' && current === directory) continue;
      const file = path.join(current, entry.name);
      assert(!entry.isSymbolicLink(), 'Linked dependency payload is forbidden');
      if (entry.isDirectory()) visit(file);
      else {
        assert(entry.isFile(), 'Unexpected dependency file type');
        files[relative(directory, file)] = sha(fs.readFileSync(file));
      }
    }
  }
  visit(directory);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

function inspect(root, scope) {
  assert(Object.hasOwn(scopes, scope), 'Unknown installation scope');
  assert.equal(definition.schema, 1);
  assert.equal(definition.task, 'MUTTER_GUEST_REENTRY_AND_SIX_DEPENDENCY_REMEDIATION_20261012');
  root = fs.realpathSync(root);
  const lockBytes = fs.readFileSync(path.join(root, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  assert.equal(lock.lockfileVersion, 3);
  const expected = Object.entries(lock.packages).flatMap(([location, metadata]) => {
    const name = metadata.name ?? location.split('node_modules/').at(-1);
    return Object.hasOwn(definition.targets, name ?? '') ? [{ name, location, metadata }] : [];
  });
  assert.deepEqual([...new Set(expected.map(copy => copy.name))].sort(), scopes[scope]);
  const packages = packageInventory(root);
  const copies = packages.filter(copy => Object.hasOwn(definition.targets, copy.metadata.name));
  assert.deepEqual(copies.map(copy => relative(root, copy.directory)).sort(), expected.map(copy => copy.location).sort(), 'Extra/missing installed target copy');
  const records = expected.map(({ name, location, metadata }) => {
    const target = definition.targets[name];
    assert.equal(target.name, name);
    assert.equal(metadata.version, target.version, 'Uncorrected lock version');
    assert.equal(metadata.resolved, target.tarball, 'Foreign target tarball');
    assert.equal(metadata.integrity, target.integrity, 'Foreign target integrity');
    const copy = copies.find(item => relative(root, item.directory) === location);
    assert(copy, 'Installed target missing');
    assert.equal(copy.metadata.version, target.version, 'Uncorrected installed version');
    assert.deepEqual(copy.metadata.engines ?? null, target.engines);
    assert.deepEqual(packageFiles(copy.directory), target.files, 'Installed bytes differ from verified official tarball');
    const parents = [];
    for (const parent of packages) {
      for (const kind of ['dependencies', 'optionalDependencies']) {
        if (!Object.hasOwn(parent.metadata[kind] ?? {}, name)) continue;
        const resolved = createRequire(parent.file).resolve(name);
        const inside = path.relative(copy.directory, resolved);
        if (inside.startsWith('..') || path.isAbsolute(inside)) continue;
        parents.push({ name: parent.metadata.name, version: parent.metadata.version,
          path: relative(root, parent.directory), kind, declaredRange: parent.metadata[kind][name],
          resolvedEntry: relative(root, resolved), entrySha256: sha(fs.readFileSync(resolved)) });
      }
    }
    assert(parents.length > 0, 'Target has no actual parent resolution');
    return { name, version: target.version, path: location, integrity: target.integrity,
      tarballSha256: target.tarballSha256, verifiedOfficialFileCount: Object.keys(target.files).length, parents };
  });
  return { schema: 1, task: definition.task, scope, root, lockSha256: sha(lockBytes),
    targetDefinitionSha256: sha(fs.readFileSync(path.join(__dirname, 'targets.json'))), copies: records,
    boundary: 'All resolved npm target copies, actual parent entries and complete package bytes against pre-adoption official SRI-verified tarballs; not an independent audit or security waiver.' };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '../..');
  const scope = fs.existsSync(path.join(root, 'functions/package.json')) ? 'root' : 'admin';
  const reports = [inspect(root, scope)];
  if (scope === 'root') reports.push(inspect(path.join(root, 'functions'), 'functions'));
  if (scope === 'root' && process.env.MUTTER_ADMIN_API_SOURCE) reports.push(inspect(process.env.MUTTER_ADMIN_API_SOURCE, 'admin'));
  console.log(JSON.stringify(reports, null, 2));
}
module.exports = { inspect, packageFiles };
