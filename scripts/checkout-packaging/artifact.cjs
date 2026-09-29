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

async function emitFunction(source, workspace, definition, context) {
  const { files, packagePath, packageBytes, sourceHashes, builderConfig } = context;
  const directory = path.join(workspace.emitted, definition.key);
  await fs.mkdir(directory, { mode: 0o700 });
  // Each function has its own complete emitted dependency graph and native root.
  const meta = { isDev: false, skipDownload: true, runNpmInstallSet: new Set([packagePath]) };
  const built = await build({ files, entrypoint: definition.entrypoint, workPath: source, config: builderConfig, meta });
  const output = built.output;
  assert.equal(output.handler, definition.handler);
  assert.equal(output.runtime, 'nodejs22.x');
  if (definition.maxDuration !== undefined) assert.equal(output.maxDuration, definition.maxDuration, `Unexpected emitted duration for ${definition.key}`);
  for (const name of definition.requiredModules) assert(output.files[name], `Missing ${definition.key} traced module ${name}`);
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
      assert(!path.isAbsolute(target) && inside(directory, path.resolve(directory, path.dirname(name), target)), 'Emitted symlink escapes function artifact');
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
  await download(output.files, directory, {});
  for (const entry of manifest) {
    const destination = path.join(directory, entry.path);
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
    const metadata = JSON.parse(await fs.readFile(path.join(directory, entry.path), 'utf8'));
    scopes.push({ path: entry.path, sha256: entry.sha256, name: metadata.name ?? null, version: metadata.version ?? null, type: metadata.type ?? 'commonjs-default' });
  }
  const metadata = { key: definition.key, entrypoint: definition.entrypoint, handler: output.handler, runtime: output.runtime, maxDuration: output.maxDuration ?? null, directory, builder: require('@vercel/node/package.json').version, typescript: require('typescript/package.json').version, node: process.version, config: builderConfig, meta: { isDev: false, skipDownload: true, runNpmInstallSet: [packagePath] }, installPrerequisite: 'Repository npm ci from unchanged lockfile, verified by caller/CI', packageScopeSource: 'Exact builder output; root bytes matched source', sourceHashes, tracedFiles: manifest.length, packageScopes: scopes, files: manifest };
  const manifestPath = path.join(workspace.root, `output-manifest-${definition.key}.json`);
  await writeJson(manifestPath, metadata);
  return { key: definition.key, entrypoint: definition.entrypoint, handler: output.handler, runtime: output.runtime, maxDuration: metadata.maxDuration, directory, builder: metadata.builder, typescript: metadata.typescript, tracedFiles: manifest.length, packageScopes: scopes.length, manifestPath, manifestSha256: digest(await fs.readFile(manifestPath)), packageScopeSha256: digest(packageBytes) };
}

async function buildArtifact(source, workspace) {
  const definitions = [
    {
      key: 'checkout', entrypoint: 'api/create-mp-preference.ts', handler: 'api/create-mp-preference.js',
      requiredModules: ['api/create-mp-preference.js', 'api/_lib/admin-orders.js', 'api/_lib/checkout-service.js', 'api/_lib/checkout-domain.js', 'api/_lib/mercado-pago.js', 'api/_lib/mercado-pago-payments.js', 'api/_lib/payment-service.js', 'api/_lib/payment-transitions.js', 'api/_lib/inventory-transactions.js', 'src/domain/webInventory.js'],
    },
    {
      key: 'reconcile', entrypoint: 'api/internal/web-stock-reconcile.ts', handler: 'api/internal/web-stock-reconcile.js', maxDuration: 60,
      requiredModules: ['api/internal/web-stock-reconcile.js', 'api/_lib/web-stock-sweep.js'],
    },
  ];
  const config = JSON.parse(await fs.readFile(path.join(source, 'vercel.json'), 'utf8'));
  assert.deepEqual(config.builds, [
    { src: 'package.json', use: '@vercel/static-build' },
    ...definitions.map(definition => ({ src: definition.entrypoint, use: '@vercel/node' })),
  ], 'Only the static site and the exact two prepared functions are permitted');
  const functions = config.builds.filter(item => item.use === '@vercel/node');
  assert.equal(functions.length, 2, 'Expected exactly checkout and reconciliation functions');
  assert.deepEqual(functions.map(item => item.src).sort(), definitions.map(item => item.entrypoint).sort(), 'Unexpected function entrypoints');
  const packagePath = path.join(source, 'package.json');
  const packageBytes = await fs.readFile(packagePath);
  const pkg = JSON.parse(packageBytes);
  assert.equal(pkg.type, 'module', 'Preserve the real ESM package scope');
  assert(!pkg.scripts?.['vercel-build'] && !pkg.scripts?.['now-build'], 'Unexpected builder lifecycle script');
  for (const key of ['FIREBASE_PRIVATE_KEY', 'MP_ACCESS_TOKEN', 'IMAGEKIT_PRIVATE_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'CRON_SECRET', 'WEB_ADMISSION_HMAC_SECRET']) {
    assert(!process.env[key], `Credential environment is forbidden: ${key}`);
  }
  const files = { ...await glob('api/**/*.ts', source), ...await glob('src/domain/**/*.ts', source) };
  const sourceHashes = {};
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'vercel.json', ...Object.keys(files).sort()]) sourceHashes[name] = digest(await fs.readFile(path.join(source, name)));
  // npm ci precedes this gate. Reuse the builder's installation deduplication;
  // emission/tracing still use production mode and the real project scope.
  const context = { files, packagePath, packageBytes, sourceHashes, builderConfig: { nodeVersion: '22.x' } };
  const entries = [];
  for (const definition of definitions) entries.push(await emitFunction(source, workspace, definition, context));
  const metadata = { functions: entries.length, entries, builder: entries[0].builder, typescript: entries[0].typescript, node: process.version, sourceHashes, mode: 'Production builder; installed dependencies reused; isolated native artifact per function' };
  const manifestPath = path.join(workspace.root, 'output-manifest.json');
  await writeJson(manifestPath, metadata);
  return { ...metadata, manifestPath, manifestSha256: digest(await fs.readFile(manifestPath)) };
}

module.exports = { buildArtifact, createWorkspace, writeJson };
