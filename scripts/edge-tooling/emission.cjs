// Inspect actual written bytes and the corresponding builder/Rollup graphs.
// This does not import or evaluate any Edge package or payload.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const exception = require('./exception.json');

const digest = value => createHash('sha256').update(value).digest('hex');
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
function requireEvidence(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { code: 'NOT_VERIFIED', boundary: 'edge-emission' });
}
function forbid(condition, message) {
  if (condition) throw Object.assign(new Error(message), { code: 'EDGE_EMISSION_FORBIDDEN' });
}
function destination(root, name) {
  requireEvidence(typeof name === 'string' && name.length > 0 && !path.isAbsolute(name) && !name.includes('\\') && !name.split('/').includes('..'), `Unsafe artifact path: ${name}`);
  const result = path.resolve(root, name);
  requireEvidence(inside(root, result), `Artifact path escaped root: ${name}`);
  return result;
}
const prohibited = new Set(exception.packages.map(item => item.name));
function inspectGraphName(name) {
  forbid(prohibited.has(name) || name?.startsWith('@edge-runtime/'), `Forbidden emitted package: ${name}`);
}
function inspectGraphPath(name) {
  const normalized = name.replaceAll('\\', '/');
  for (const name of prohibited) forbid(normalized.includes(`/node_modules/${name}/`) || normalized.startsWith(`node_modules/${name}/`), `Forbidden emitted module: ${normalized}`);
  forbid(/(?:^|\/)node_modules\/@edge-runtime\//.test(normalized), `Uninventoried Edge module: ${normalized}`);
}

async function fingerprintSource(source) {
  const file = exception.files.find(item => item.path.endsWith('/fetch.js.text.js'));
  requireEvidence(file, 'Exception payload identity is missing');
  const raw = await fs.readFile(destination(source, file.path));
  requireEvidence(raw.length === file.bytes && digest(raw) === file.sha256, 'Installed fingerprint source differs from the accepted exception');
  const wrapper = 'module.exports = ';
  requireEvidence(raw.toString('utf8').startsWith(wrapper), 'Payload serialization is not the reviewed string wrapper');
  // JSON decoding is data-only: never require(), eval() or run the payload.
  const decoded = JSON.parse(raw.toString('utf8').slice(wrapper.length));
  requireEvidence(typeof decoded === 'string', 'Payload is not a serialized string');
  const body = Buffer.from(decoded);
  const windows = [1, 2, 3, 4].map(part => {
    const offset = Math.floor(body.length * part / 5);
    return { offset, bytes: body.subarray(offset, offset + 256) };
  });
  return { raw, body, windows, identity: { path: file.path, bytes: raw.length, sha256: digest(raw), decodedSha256: digest(body), windows: windows.map(item => ({ offset: item.offset, bytes: item.bytes.length, sha256: digest(item.bytes) })), method: 'Full installed and decoded payload plus 3-of-4 distributed byte windows; transformed code is additionally covered by module provenance, not a universal obfuscation detector.' } };
}
function inspectBytes(bytes, name, fingerprints) {
  const hits = fingerprints.windows.filter(item => bytes.includes(item.bytes)).length;
  forbid(bytes.includes(fingerprints.raw) || bytes.includes(fingerprints.body) || hits >= 3, `Forbidden embedded payload in written artifact: ${name}`);
}
async function walk(root, relative = '') {
  const files = [];
  for (const name of (await fs.readdir(path.join(root, relative))).sort()) {
    const item = relative ? `${relative}/${name}` : name;
    const stat = await fs.lstat(destination(root, item));
    if (stat.isDirectory()) files.push(...await walk(root, item));
    else {
      requireEvidence(stat.isFile() || stat.isSymbolicLink(), `Unsupported emitted filesystem object: ${item}`);
      files.push(item);
    }
  }
  return files;
}
async function verifyFiles(root, records, fingerprints) {
  requireEvidence(Array.isArray(records) && records.length > 0, 'Written file inventory is missing');
  requireEvidence(new Set(records.map(item => item.path)).size === records.length, 'Duplicate file inventory entries');
  const actual = await walk(root);
  const expected = records.filter(item => item.type !== 'directory').map(item => item.path).sort();
  requireEvidence(JSON.stringify(actual.sort()) === JSON.stringify(expected), 'Written file inventory does not cover the artifact exactly');
  const verified = [];
  for (const record of records) {
    inspectGraphPath(record.path);
    const file = destination(root, record.path);
    const stat = await fs.lstat(file);
    if (record.type === 'directory') {
      requireEvidence(stat.isDirectory(), `Expected emitted directory: ${record.path}`);
      continue;
    }
    if (record.type === 'symlink') {
      requireEvidence(stat.isSymbolicLink(), `Expected emitted symlink: ${record.path}`);
      const target = await fs.readlink(file);
      requireEvidence(target === record.target && digest(target) === record.sha256 && !path.isAbsolute(target) && inside(root, path.resolve(path.dirname(file), target)), `Unverified emitted symlink: ${record.path}`);
      requireEvidence(inside(root, await fs.realpath(file)), `Resolved emitted symlink escapes artifact: ${record.path}`);
      verified.push({ ...record });
    } else {
      requireEvidence(record.type === 'file' && stat.isFile(), `Expected emitted file: ${record.path}`);
      const bytes = await fs.readFile(file);
      requireEvidence(bytes.length === record.bytes && digest(bytes) === record.sha256, `Written bytes differ from evidence: ${record.path}`);
      inspectBytes(bytes, record.path, fingerprints);
      verified.push({ path: record.path, type: 'file', bytes: bytes.length, sha256: digest(bytes) });
    }
  }
  return verified;
}
async function inspectNodeArtifacts(source, workspace, entries) {
  requireEvidence(Array.isArray(entries) && JSON.stringify(entries.map(item => item.key)) === JSON.stringify(require('../checkout-packaging/function-definitions.cjs').DEFINITIONS.map(item => item.key)), 'Every prepared Node artifact inspection is required');
  const fingerprints = await fingerprintSource(source);
  const artifacts = [];
  for (const entry of entries) {
    requireEvidence(typeof entry.manifestPath === 'string' && typeof entry.manifestSha256 === 'string', `Missing Node manifest: ${entry.key}`);
    requireEvidence(inside(workspace.root, path.resolve(entry.manifestPath)) && inside(workspace.emitted, path.resolve(entry.directory)), 'Node evidence is outside the observed workspace');
    requireEvidence(inside(workspace.root, await fs.realpath(entry.manifestPath)) && inside(workspace.emitted, await fs.realpath(entry.directory)), 'Resolved Node evidence escaped the observed workspace');
    const bytes = await fs.readFile(entry.manifestPath);
    requireEvidence(digest(bytes) === entry.manifestSha256, `Node manifest identity differs: ${entry.key}`);
    const manifest = JSON.parse(bytes);
    requireEvidence(manifest.key === entry.key && manifest.directory === entry.directory && manifest.handler === entry.handler && manifest.runtime === 'nodejs22.x', `Node manifest does not identify the real artifact: ${entry.key}`);
    requireEvidence(Array.isArray(manifest.packageScopes) && manifest.packageScopes.length > 0 && manifest.files?.some(item => item.path === entry.handler), `Node graph is missing: ${entry.key}`);
    const files = await verifyFiles(entry.directory, manifest.files, fingerprints);
    const scopes = manifest.files.filter(item => item.type === 'file' && item.path.endsWith('package.json'));
    requireEvidence(scopes.length === manifest.packageScopes.length, `Package graph is incomplete: ${entry.key}`);
    for (const scope of scopes) {
      const metadata = JSON.parse(await fs.readFile(destination(entry.directory, scope.path), 'utf8'));
      const graph = manifest.packageScopes.find(item => item.path === scope.path);
      requireEvidence(graph && graph.sha256 === scope.sha256 && graph.name === (metadata.name ?? null) && graph.version === (metadata.version ?? null), `Package provenance differs: ${scope.path}`);
      inspectGraphName(metadata.name);
      // npm Undici is separate from the embedded copy; only its identified old
      // version is forbidden here. The four npm audits remain independent gates.
      forbid(metadata.name === 'undici' && metadata.version === exception.embeddedUndiciVersion, 'Undici embedded version emitted as an npm package');
    }
    artifacts.push({ key: entry.key, manifestPath: entry.manifestPath, manifestSha256: digest(bytes), packageScopes: manifest.packageScopes, files });
  }
  return { status: 'PASS', exceptionId: exception.exceptionId, fingerprintSource: fingerprints.identity, artifacts, evidenceBoundary: 'Official output.files graph and exact materialized files; all prepared Node handlers' };
}
async function inspectSpaArtifacts(source, dist, inventory) {
  requireEvidence(inventory?.schemaVersion === 1 && inventory.stage === 'POST_BUILD_WRITTEN_BYTES' && inventory.source === source && inventory.dist === dist, 'SPA final-write inspection is missing or belongs to another build');
  requireEvidence(Array.isArray(inventory.chunks) && inventory.chunks.length > 0 && Array.isArray(inventory.modules) && inventory.modules.length > 0, 'SPA module graph is missing');
  const fingerprints = await fingerprintSource(source);
  const files = await verifyFiles(dist, inventory.files, fingerprints);
  const ids = new Set(inventory.modules.map(item => item.id));
  requireEvidence(ids.size === inventory.modules.length, 'Duplicate SPA module identities');
  for (const module of inventory.modules) {
    inspectGraphPath(module.id);
    if (module.package) {
      inspectGraphName(module.package.name);
      const scope = destination(source, `${module.package.path}/package.json`);
      const scopeBytes = await fs.readFile(scope);
      const metadata = JSON.parse(scopeBytes);
      requireEvidence(digest(scopeBytes) === module.package.manifestSha256 && metadata.name === module.package.name && metadata.version === module.package.version, `SPA package provenance differs: ${module.id}`);
      forbid(metadata.name === 'undici' && metadata.version === exception.embeddedUndiciVersion, 'Embedded Undici version in SPA graph');
    }
    requireEvidence(Array.isArray(module.chunks) && module.chunks.length > 0, `SPA module has no emitted consumer: ${module.id}`);
    if (module.sourcePath) {
      const file = destination(source, module.sourcePath);
      requireEvidence(inside(source, await fs.realpath(file)) && digest(await fs.readFile(file)) === module.sourceSha256, `SPA module source cannot be verified: ${module.id}`);
    } else requireEvidence(module.virtual === true && module.id.startsWith('\0'), `SPA module origin is unknown: ${module.id}`);
  }
  for (const chunk of inventory.chunks) {
    const file = files.find(item => item.path === chunk.path);
    requireEvidence(file && file.sha256 === chunk.sha256 && file.bytes === chunk.bytes && Array.isArray(chunk.modules) && chunk.modules.length > 0, `SPA chunk is not bound to its final bytes: ${chunk.path}`);
    for (const id of chunk.modules) requireEvidence(ids.has(id) && inventory.modules.find(item => item.id === id).chunks.includes(chunk.path), `SPA chunk graph is incomplete: ${chunk.path}`);
  }
  for (const file of files.filter(item => /\.[cm]?js$/.test(item.path))) requireEvidence(inventory.chunks.some(chunk => chunk.path === file.path), `Emitted JavaScript has no module graph: ${file.path}`);
  return { status: 'PASS', exceptionId: exception.exceptionId, fingerprintSource: fingerprints.identity, files, chunks: inventory.chunks, modules: inventory.modules, evidenceBoundary: 'Actual Vite module provenance and all disk files after every build hook completed' };
}
async function inspectRequired(operation) {
  try { return await operation(); }
  catch (error) {
    if (error.code === 'NOT_VERIFIED' || error.code === 'EDGE_EMISSION_FORBIDDEN') throw error;
    // Missing/unreadable/invalid inspection material is never an observed clean
    // artifact. Preserve the original reason, while returning the shared status.
    throw Object.assign(new Error(`Emission inspection unavailable: ${error.message}`, { cause: error }), { code: 'NOT_VERIFIED', boundary: 'edge-emission', causeCode: error.code ?? null });
  }
}
module.exports = {
  inspectNodeArtifacts: (...args) => inspectRequired(() => inspectNodeArtifacts(...args)),
  inspectSpaArtifacts: (...args) => inspectRequired(() => inspectSpaArtifacts(...args)),
  fingerprintSource, digest,
};
