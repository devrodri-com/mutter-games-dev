const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { digest } = require('./identity.cjs');

const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
function destination(root, relative) {
  assert(typeof relative === 'string' && relative.length && !path.isAbsolute(relative) && !relative.includes('\\') && !relative.split('/').includes('..'), 'Unsafe artifact path');
  const result = path.resolve(root, relative);
  assert(inside(root, result), 'Artifact path escaped root');
  return result;
}
async function inventory(root, relative = '') {
  const records = [];
  for (const name of (await fs.readdir(path.join(root, relative))).sort()) {
    const rel = relative ? `${relative}/${name}` : name;
    const absolute = destination(root, rel);
    const stat = await fs.lstat(absolute);
    if (stat.isDirectory()) records.push(...await inventory(root, rel));
    else if (stat.isSymbolicLink()) {
      const target = await fs.readlink(absolute);
      assert(!path.isAbsolute(target) && inside(root, await fs.realpath(absolute)), `Escaping artifact symlink: ${rel}`);
      records.push({ path: rel, type: 'symlink', mode: stat.mode & 0o777, target, sha256: digest(target) });
    } else {
      assert(stat.isFile(), `Unsupported artifact object: ${rel}`);
      const bytes = await fs.readFile(absolute);
      records.push({ path: rel, type: 'file', mode: stat.mode & 0o777, bytes: bytes.length, sha256: digest(bytes) });
    }
  }
  return records;
}
async function verifyInventory(root, expected) {
  assert(Array.isArray(expected) && expected.length > 0, 'Missing artifact inventory');
  assert.equal(new Set(expected.map(record => record.path)).size, expected.length, 'Duplicate artifact inventory path');
  const actual = await inventory(root);
  assert.deepEqual(actual, expected, 'Artifact file set, bytes, modes or symlinks differ');
  return actual;
}

const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----(?:\\[rn]|\s)+[A-Za-z0-9+/=]{40,}/,
  /\bAPP_USR-[A-Za-z0-9_-]{25,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /"type"\s*:\s*"service_account"[\s\S]{0,4096}"private_key"\s*:\s*"[^"\s]{20,}/,
];
function inspectBytes(bytes, relative, fingerprints) {
  const text = bytes.toString('utf8');
  assert(!/\.(?:node|so|dylib|dll|wasm)$/.test(relative), `Native binary requires separate platform review: ${relative}`);
  const magic = bytes.subarray(0, 4).toString('hex');
  assert(!['7f454c46', 'cffaedfe', 'feedfacf', 'cefaedfe', 'feedface', 'cafebabe', '0061736d'].includes(magic)
    && bytes.subarray(0, 2).toString('ascii') !== 'MZ', `Unreviewed executable binary: ${relative}`);
  assert(!CREDENTIAL_PATTERNS.some(pattern => pattern.test(text)), `Credential-shaped value in artifact: ${relative}`);
  if (fingerprints) {
    const hits = fingerprints.windows.filter(window => bytes.includes(window.bytes)).length;
    assert(!bytes.includes(fingerprints.raw) && !bytes.includes(fingerprints.body) && hits < 3, `Forbidden Edge payload in artifact: ${relative}`);
  }
  assert(!/(?:^|\/)node_modules\/(?:@edge-runtime\/|edge-runtime\/)/.test(relative), `Forbidden Edge package in artifact: ${relative}`);
  if (relative.endsWith('package.json')) {
    const metadata = JSON.parse(text);
    assert(!metadata.name?.startsWith('@edge-runtime/') && metadata.name !== 'edge-runtime', `Forbidden Edge package metadata: ${relative}`);
  }
}
async function scanFiles(root, records, fingerprints) {
  for (const record of records) if (record.type === 'file')
    inspectBytes(await fs.readFile(destination(root, record.path)), record.path, fingerprints);
  return { status: 'PASS', files: records.filter(record => record.type === 'file').length,
    boundary: 'Complete emitted file set including sourcemaps and metadata; credential formats, forbidden package paths and accepted Edge payload byte fingerprints',
    limitation: 'Credential shape scanning complements strict input allowlisting; it does not prove absence of arbitrarily encoded unknown secrets.' };
}

module.exports = { inside, destination, inventory, verifyInventory, inspectBytes, scanFiles };
