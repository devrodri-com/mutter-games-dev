'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const manifest = require('./manifest.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function patchDefinition() {
  const bytes = fs.readFileSync(path.join(__dirname, 'patch.json'));
  assert.equal(sha(bytes), manifest.patchSha256, 'Braces patch missing or changed');
  const patch = JSON.parse(bytes);
  assert.equal(patch.schema, 1);
  assert.equal(manifest.version, '3.0.3');
  return patch;
}
function packageInventory(root) {
  const packages = [];
  function visit(modules) {
    if (!fs.existsSync(modules)) return;
    for (const entry of fs.readdirSync(modules, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const directory = path.join(modules, entry.name);
      if (entry.name.startsWith('@') && entry.isDirectory()) { visit(directory); continue; }
      assert(!entry.isSymbolicLink(), `Unreviewed linked dependency: ${directory}`);
      if (!entry.isDirectory()) continue;
      const file = path.join(directory, 'package.json');
      if (fs.existsSync(file)) packages.push({ directory, file, metadata: json(file) });
      visit(path.join(directory, 'node_modules'));
    }
  }
  assert(fs.existsSync(path.join(root, 'node_modules')), 'Dependencies are not installed');
  visit(path.join(root, 'node_modules'));
  return packages;
}
function fileHashes(directory) {
  const hashes = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      assert(!entry.isSymbolicLink(), 'Linked braces content is forbidden');
      if (entry.isDirectory()) visit(file);
      else { assert(entry.isFile()); hashes[path.relative(directory, file).split(path.sep).join('/')] = sha(fs.readFileSync(file)); }
    }
  }
  visit(directory);
  return hashes;
}
function inspect(root, apply = false) {
  root = fs.realpathSync(root);
  const patch = patchDefinition();
  const lock = json(path.join(root, 'package-lock.json'));
  const expected = Object.keys(lock.packages).filter(p => /(?:^|\/)node_modules\/braces$/.test(p));
  assert(expected.length <= 1 && (!expected.length || expected[0] === 'node_modules/braces'), 'Unreviewed braces lock coverage');
  for (const p of expected) {
    assert.equal(lock.packages[p].version, manifest.version);
    assert.equal(lock.packages[p].integrity, manifest.integrity);
  }
  const packages = packageInventory(root);
  const copies = packages.filter(p => p.metadata.name === 'braces');
  assert.deepEqual(copies.map(p => path.relative(root, p.directory).split(path.sep).join('/')).sort(), expected.sort(), 'Extra/missing braces copy');
  for (const copy of copies) {
    assert.equal(copy.metadata.version, manifest.version, 'Unexpected braces version');
    const before = fileHashes(copy.directory);
    if (apply && JSON.stringify(Object.entries(before).sort()) === JSON.stringify(Object.entries(manifest.originalFiles).sort())) {
      // Validate and construct the whole patch before any write. A partial application fails closed on the next invocation.
      const updates = patch.changes.map(change => {
        assert(Object.hasOwn(manifest.originalFiles, change.path));
        const lines = fs.readFileSync(path.join(copy.directory, change.path), 'utf8').match(/[^\n]*\n|[^\n]+$/g) || [];
        for (const edit of [...change.edits].reverse()) {
          assert.deepEqual(lines.slice(edit.startLine, edit.startLine + edit.remove.length), edit.remove);
          lines.splice(edit.startLine, edit.remove.length, ...edit.insert);
        }
        const bytes = lines.join('');
        assert.equal(sha(bytes), manifest.patchedFiles[change.path], 'Patch result mismatch');
        return { file: path.join(copy.directory, change.path), bytes };
      });
      for (const update of updates) fs.writeFileSync(update.file, update.bytes);
    }
    assert.deepEqual(fileHashes(copy.directory), manifest.patchedFiles, 'Unpatched or changed braces bytes; run install:controlled');
  }
  const parents = [];
  for (const p of packages) {
    if (Object.hasOwn(p.metadata.dependencies || {}, 'braces')) {
      const resolved = createRequire(p.file).resolve('braces/package.json');
      assert(copies.some(c => c.file === resolved), 'Parent resolves an unverified braces copy');
      parents.push({ name: p.metadata.name, version: p.metadata.version,
        from: path.relative(root, p.directory), braces: path.relative(root, resolved) });
    }
  }
  assert(!copies.length || parents.length > 0, 'No actual braces consumers');
  if (fs.existsSync(path.join(root, 'functions/node_modules'))) inspect(path.join(root, 'functions'));
  return { id: manifest.id, patchSha256: manifest.patchSha256, copies: expected, parents,
    localSourceBytes: 'VERIFIED', independentAudit: 'PENDING', releaseEligible: false };
}
if (require.main === module) {
  const [mode, directory = path.resolve(__dirname, '../..')] = process.argv.slice(2);
  assert(['apply', 'verify'].includes(mode) && process.argv.length <= 4);
  console.log(JSON.stringify(inspect(directory, mode === 'apply')));
}
module.exports = { inspect, packageInventory, patchDefinition, sha };
