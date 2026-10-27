const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const exception = require('./exception.json');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
const protectedName = name => name === '@vercel/node' || name === 'edge-runtime' || name.startsWith('@edge-runtime/');

function fail(code, detail) {
  const error = new Error(detail);
  error.code = code;
  throw error;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail('EDGE_INSPECTION_MISSING', `Cannot inspect JSON ${file}: ${error.code ?? error.name}`); }
}

function installedPackages(root, directory, found) {
  if (!fs.existsSync(directory)) fail('EDGE_INSPECTION_MISSING', `Installation directory is missing: ${relative(root, directory)}`);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      // npm command links are not package copies. Package/directory links could
      // hide an uninventoried installation outside this isolated tree.
      if (path.basename(directory) !== '.bin') fail('EDGE_INSTALLATION_LINK', `Uninspected installation link: ${relative(root, file)}`);
    } else if (entry.isDirectory()) installedPackages(root, file, found);
    else if (entry.isFile() && entry.name === 'package.json') {
      const bytes = fs.readFileSync(file);
      const metadata = readJson(file);
      if (typeof metadata.name === 'string' && protectedName(metadata.name)) {
        found.push({ name: metadata.name, version: metadata.version, path: relative(root, directory), packageSha256: digest(bytes) });
      }
    }
  }
}

function lockInventory(lock) {
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') fail('EDGE_LOCK_FORMAT', 'Expected npm lockfile v3 package inventory');
  return Object.entries(lock.packages).flatMap(([location, item]) => {
    const name = item.name ?? location.split('node_modules/').at(-1);
    return typeof name === 'string' && protectedName(name) ? [{ name, path: location, version: item.version, resolved: item.resolved, integrity: item.integrity }] : [];
  }).sort((a, b) => a.path.localeCompare(b.path));
}

function dependencyChain(lock) {
  const chain = [];
  for (const [from, item] of Object.entries(lock.packages)) {
    for (const kind of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
      for (const [to, range] of Object.entries(item[kind] ?? {})) {
        if (protectedName(to)) chain.push({ from: from || '.', kind, to, range, optionalPeer: item.peerDependenciesMeta?.[to]?.optional ?? false });
      }
    }
  }
  return chain;
}

function verifyInstalled(source) {
  const root = fs.realpathSync(source);
  const locks = exception.locks.map(expected => {
    const file = path.join(root, expected.path);
    if (!fs.existsSync(file)) fail('EDGE_INSPECTION_MISSING', `Lock missing: ${expected.path}`);
    const actual = digest(fs.readFileSync(file));
    if (actual !== expected.sha256) fail('EDGE_LOCK_CHANGED', `Lock identity changed: ${expected.path}`);
    return { path: expected.path, sha256: actual, lock: readJson(file) };
  });
  const expectedLock = exception.packages.map(({ name, path: location, version, resolved, integrity }) => ({ name, path: location, version, resolved, integrity })).sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(lockInventory(locks[0].lock)) !== JSON.stringify(expectedLock)) fail('EDGE_LOCK_INVENTORY_CHANGED', 'Accepted lock package identities differ');
  if (lockInventory(locks[1].lock).length !== 0) fail('EDGE_FUNCTIONS_COPY', 'Functions graph must not contain Edge tooling');
  if (JSON.stringify(dependencyChain(locks[0].lock)) !== JSON.stringify(exception.dependencyChain)) fail('EDGE_CHAIN_CHANGED', 'Edge dependency/optional-peer chain changed');

  const installed = [];
  for (const directory of ['node_modules', 'functions/node_modules']) installedPackages(root, path.join(root, directory), installed);
  const byPath = new Map(exception.packages.map(item => [item.path, item]));
  for (const item of installed) {
    const expected = byPath.get(item.path);
    if (!expected || expected.name !== item.name) fail('EDGE_UNAPPROVED_COPY', `Unapproved package copy: ${item.path} (${item.name})`);
    if (item.version !== expected.version) fail('EDGE_VERSION_CHANGED', `Version changed: ${item.path}`);
    if (item.packageSha256 !== expected.packageSha256) fail('EDGE_PACKAGE_CHANGED', `Installed metadata changed: ${item.path}`);
    byPath.delete(item.path);
  }
  if (byPath.size > 0) fail('EDGE_INSPECTION_MISSING', `Accepted installed packages missing: ${[...byPath.keys()].join(', ')}`);
  const files = exception.files.map(expected => {
    const file = path.join(root, expected.path);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) fail('EDGE_INSPECTION_MISSING', `Accepted file missing or not regular: ${expected.path}`);
    const bytes = fs.readFileSync(file);
    const actual = { path: expected.path, bytes: bytes.length, sha256: digest(bytes) };
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) fail('EDGE_BYTES_CHANGED', `Accepted bytes changed: ${expected.path}`);
    return actual;
  });
  return {
    status: 'PASS', exceptionId: exception.exceptionId, decision: exception.decision.status,
    embeddedBytesPatched: false, source: root, manifestSha256: digest(fs.readFileSync(path.join(__dirname, 'exception.json'))),
    locks: locks.map(({ path: location, sha256 }) => ({ path: location, sha256 })),
    packages: installed.sort((a, b) => a.path.localeCompare(b.path)), dependencyChain: exception.dependencyChain, files,
    coverage: 'Every package.json under root and Functions node_modules; npm command links excluded; package aliases identified by metadata.name.',
  };
}

module.exports = { verifyInstalled };
