const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { build } = require('@vercel/node');
const { glob, download } = require('@vercel/build-utils');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const writeJson = (file, value) => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

async function createWorkspace(source) {
  const requested = process.env.CHECKOUT_PACKAGING_EVIDENCE_DIR;
  const preserve = typeof requested === 'string' && requested.length > 0;
  let root;
  if (preserve) {
    root = path.resolve(requested);
    assert(!inside(source, root), 'Evidence must be outside checkout');
    await fs.mkdir(root, { mode: 0o700 });
  } else root = await fs.mkdtemp(path.join(os.tmpdir(), 'mutter-checkout-artifact-'));
  root = await fs.realpath(root);
  await fs.chmod(root, 0o700);
  assert(!inside(source, root), 'Resolved artifact directory is inside source');
  const emitted = path.join(root, 'emitted');
  let ancestor = root;
  while (true) {
    try {
      await fs.lstat(path.join(ancestor, 'node_modules'));
      throw new Error(`Artifact ancestor contains node_modules: ${ancestor}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  await fs.mkdir(emitted, { mode: 0o700 });
  await fs.mkdir(path.join(root, 'child-home'), { mode: 0o700 });
  await fs.mkdir(path.join(root, 'child-home', '.config'), { mode: 0o700 });
  return { root, emitted, preserve };
}

async function buildArtifact(source, workspace) {
  const config = JSON.parse(await fs.readFile(path.join(source, 'vercel.json'), 'utf8'));
  const functions = config.builds.filter(item => item.use === '@vercel/node');
  assert.equal(functions.length, 1, 'Unexpected function topology');
  assert.equal(functions[0].src, 'api/create-mp-preference.ts');
  const packagePath = path.join(source, 'package.json');
  const packageBytes = await fs.readFile(packagePath);
  const pkg = JSON.parse(packageBytes);
  assert.equal(pkg.type, 'module', 'Preserve the real ESM package scope');
  assert(!pkg.scripts?.['vercel-build'] && !pkg.scripts?.['now-build'], 'Unexpected builder lifecycle script');
  for (const key of ['FIREBASE_PRIVATE_KEY', 'MP_ACCESS_TOKEN', 'IMAGEKIT_PRIVATE_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']) {
    assert(!process.env[key], `Credential environment is forbidden: ${key}`);
  }
  const files = await glob('api/**/*.ts', source);
  // npm ci precedes this gate. Reuse the builder's installation deduplication;
  // emission/tracing still use production mode and the real project scope.
  const builderConfig = { nodeVersion: '22.x' };
  const meta = { isDev: false, skipDownload: true, runNpmInstallSet: new Set([packagePath]) };
  const built = await build({ files, entrypoint: functions[0].src, workPath: source, config: builderConfig, meta });
  const output = built.output;
  assert.equal(output.handler, 'api/create-mp-preference.js');
  assert.equal(output.runtime, 'nodejs22.x');
  for (const name of ['api/create-mp-preference.js', 'api/_lib/checkout-service.js', 'api/_lib/checkout-domain.js', 'api/_lib/mercado-pago.js']) assert(output.files[name], `Missing traced module ${name}`);
  assert(output.files['package.json'], 'Builder omitted real package scope; do not fabricate it');
  const manifest = [];
  for (const [name, file] of Object.entries(output.files).sort(([a], [b]) => a.localeCompare(b))) {
    assert(!path.isAbsolute(name) && !name.split('/').includes('..') && !name.includes('\\'), 'Unsafe emitted path');
    assert(['FileBlob', 'FileFsRef'].includes(file.type), 'Only local emitted files permitted');
    const kind = file.mode & 0o170000;
    assert([0o100000, 0o120000, 0o040000].includes(kind), 'Unexpected emitted filesystem object');
    if (kind === 0o120000) {
      assert.equal(file.type, 'FileFsRef', 'Unrecognized emitted symlink representation');
      const target = await fs.readlink(file.fsPath);
      assert(!path.isAbsolute(target) && inside(workspace.emitted, path.resolve(workspace.emitted, path.dirname(name), target)), 'Emitted symlink escapes artifact');
      manifest.push({ path: name, type: 'symlink', mode: file.mode & 0o777, target, sha256: digest(target) });
    } else if (kind === 0o040000) manifest.push({ path: name, type: 'directory', mode: file.mode & 0o777 });
    else {
      // FileBlob's installed legacy stream is not async-iterable. Its data and
      // FileFsRef's local bytes are the same inputs used by official download().
      const bytes = file.type === 'FileBlob' ? Buffer.from(file.data) : await fs.readFile(file.fsPath);
      manifest.push({ path: name, type: 'file', mode: file.mode & 0o777, bytes: bytes.length, sha256: digest(bytes) });
    }
  }
  assert.equal(manifest.find(item => item.path === 'package.json').sha256, digest(packageBytes), 'Emitted root scope differs from real source metadata');
  // Official materialization, with no added source modules/dependency tree or
  // synthesized metadata. Existing package scopes are part of output.files.
  await download(output.files, workspace.emitted, {});
  for (const entry of manifest) {
    const destination = path.join(workspace.emitted, entry.path);
    // The private parent remains 0700; restore emitted file modes after the
    // caller's restrictive umask affected creation by download().
    if (entry.type !== 'symlink') await fs.chmod(destination, entry.mode);
    const stat = await fs.lstat(destination);
    assert.equal(stat.mode & 0o777, entry.mode, `Materialized mode differs: ${entry.path}`);
    if (entry.type === 'file') assert.equal(digest(await fs.readFile(destination)), entry.sha256, `Materialized bytes differ: ${entry.path}`);
    if (entry.type === 'symlink') assert.equal(await fs.readlink(destination), entry.target);
  }
  const scopes = [];
  for (const entry of manifest.filter(item => item.path.endsWith('package.json') && item.type === 'file')) {
    const metadata = JSON.parse(await fs.readFile(path.join(workspace.emitted, entry.path), 'utf8'));
    scopes.push({ path: entry.path, sha256: entry.sha256, name: metadata.name ?? null, version: metadata.version ?? null, type: metadata.type ?? 'commonjs-default' });
  }
  const sourceHashes = {};
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'vercel.json', ...Object.keys(files).sort()]) sourceHashes[name] = digest(await fs.readFile(path.join(source, name)));
  const metadata = { functions: 1, handler: output.handler, runtime: output.runtime, builder: require('@vercel/node/package.json').version, typescript: require('typescript/package.json').version, node: process.version, config: builderConfig, meta: { isDev: false, skipDownload: true, runNpmInstallSet: [packagePath] }, installPrerequisite: 'Repository npm ci from unchanged lockfile, verified by caller/CI', packageScopeSource: 'Exact builder output; root bytes matched source', sourceHashes, tracedFiles: manifest.length, packageScopes: scopes, files: manifest };
  await writeJson(path.join(workspace.root, 'output-manifest.json'), metadata);
  return { functions: 1, handler: output.handler, runtime: output.runtime, builder: metadata.builder, typescript: metadata.typescript, tracedFiles: manifest.length, packageScopes: scopes.length, manifestSha256: digest(await fs.readFile(path.join(workspace.root, 'output-manifest.json'))), packageScopeSha256: digest(packageBytes), mode: 'Production builder; installed dependencies reused; native emitted artifact loaded separately' };
}

module.exports = { buildArtifact, createWorkspace, writeJson };
