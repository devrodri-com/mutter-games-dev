// Local-only reconstruction of the published SPA. No provider/deploy operations.
// The emitter and Edge exclusion checks are retained from the reviewed constructor.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const source = path.resolve(import.meta.dirname, '../..'), base = source;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const inside = (directory, file) => file === directory || file.startsWith(directory + path.sep);
const priorInventoryPath = path.join(import.meta.dirname, 'source-manifest.json');
const priorInventoryPin = { sha256: sha(fs.readFileSync(priorInventoryPath)) };
const manifest = json(priorInventoryPath);
const pins = new Map(manifest.files.map(row => [row.path, row]));
const manifests = [{ path: 'scripts/published/source-manifest.json', sha256: priorInventoryPin.sha256 }];
const additionalInputs = new Map();
const lockFile = path.join(source, 'package-lock.json'), lockPin = pins.get('package-lock.json');
function checked(file, expected) {
  assert(expected, 'Missing reviewed input: ' + path.relative(source, file));
  const bytes = fs.readFileSync(file), realpath = fs.realpathSync(file);
  assert.equal(sha(bytes), expected.sha256, 'Input changed: ' + path.relative(source, file));
  if (expected.bytes !== undefined) assert.equal(bytes.length, expected.bytes);
  if (expected.realpath !== undefined) assert.equal(realpath, expected.realpath);
  return { path: file, realpath, bytes: bytes.length, sha256: sha(bytes) };
}
function pinned(file) {
  return checked(file, pins.get(path.relative(source, file).split(path.sep).join('/')));
}
function binding(candidate) {
  const absolute = path.resolve(candidate);
  assert(inside(source, absolute), 'Module left the declared source');
  const relative = path.relative(source, absolute).split(path.sep).join('/');
  const realpath = fs.realpathSync(absolute);
  assert(relative.startsWith('node_modules/') || realpath === absolute, 'Project sources must be ordinary files');
  pinned(absolute);
  return { kind: relative.startsWith('node_modules/') ? 'dependency' : 'published', path: relative, realpath };
}
const require = createRequire(path.join(source, 'package.json'));
const scripts = path.join(source, 'scripts');
const emission = require(path.join(scripts, 'edge-tooling/emission.cjs'));
const exception = require(path.join(scripts, 'edge-tooling/exception.json'));
const { buildEnvironment, isolatedCiEnvironment, rejectImplicitEnvironment } = require(path.join(scripts, 'release-prebuilt/environment.cjs'));
const publicFile = path.join(scripts, 'release-prebuilt/public-production.json');
const publicConfig = json(publicFile);
function inputs() {
  return manifest.files.filter(row => !row.path.startsWith('node_modules/')).map(row => pinned(path.join(source, row.path)));
}
function forbidGraph(id, owner) {
  const normalized = id.replaceAll('\\', '/');
  for (const pkg of exception.packages) assert(!normalized.includes('/node_modules/' + pkg.name + '/')
    && !normalized.startsWith('node_modules/' + pkg.name + '/'), 'Forbidden emitted Edge module: ' + id);
  assert(!/(?:^|\/)node_modules\/@edge-runtime\//.test(normalized), 'Uninventoried Edge module: ' + id);
  if (owner) {
    assert(!exception.packages.some(pkg => pkg.name === owner.name) && !owner.name.startsWith('@edge-runtime/'));
    assert(!(owner.name === 'undici' && owner.version === exception.embeddedUndiciVersion));
  }
}
function owner(relative) {
  let directory = path.dirname(path.join(source, relative));
  while (inside(source, directory)) {
    const file = path.join(directory, 'package.json');
    if (fs.existsSync(file)) {
      const bytes = fs.readFileSync(file), metadata = JSON.parse(bytes);
      if (typeof metadata.name === 'string' && typeof metadata.version === 'string') {
        binding(file);
        return { name: metadata.name, version: metadata.version, path: path.relative(source, directory),
          realpath: fs.realpathSync(file), manifestSha256: sha(bytes) };
      }
    }
    directory = path.dirname(directory);
  }
  return null;
}
function files(directory, relative = '') {
  return fs.readdirSync(path.join(directory, relative)).sort().flatMap(name => {
    const rel = relative ? relative + '/' + name : name, absolute = path.join(directory, rel), stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) return files(directory, rel);
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Emitted SPA must contain ordinary files');
    const bytes = fs.readFileSync(absolute);
    return [{ path: rel, bytes: bytes.length, sha256: sha(bytes) }];
  });
}
async function emit(evidence) {
  // Native Tailwind/PostCSS config resolves its content paths from the source cwd.
  process.chdir(source);
  const viteEntry = pathToFileURL(path.join(path.dirname(require.resolve('vite/package.json')), 'dist/node/index.js')).href;
  const { build } = await import(viteEntry), ts = require('typescript');
  const configFile = path.join(source, 'vite.config.ts'), configBytes = fs.readFileSync(configFile);
  const reactPackage = path.resolve(require.resolve('@vitejs/plugin-react'), '../..');
  const reactMetadata = json(path.join(reactPackage, 'package.json'));
  const configImports = { vite: viteEntry, path: 'node:path', 'vitest/config': pathToFileURL(require.resolve('vitest/config')).href,
    '@vitejs/plugin-react': pathToFileURL(path.join(reactPackage, reactMetadata.exports['.'].import)).href };
  let dirnameBindings = 0;
  const compiled = ts.transpileModule(configBytes.toString(), { fileName: configFile, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    transformers: { before: [context => {
      const visit = node => {
        if (ts.isIdentifier(node) && node.text === '__dirname') { dirnameBindings++; return ts.factory.createStringLiteral(source); }
        if (ts.isImportDeclaration(node)) {
          assert(ts.isStringLiteral(node.moduleSpecifier) && Object.hasOwn(configImports, node.moduleSpecifier.text));
          return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause,
            ts.factory.createStringLiteral(configImports[node.moduleSpecifier.text]), node.attributes);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return node => ts.visitNode(node, visit);
    }] } });
  assert.equal(dirnameBindings, 1);
  assert(!(compiled.diagnostics ?? []).some(item => item.category === ts.DiagnosticCategory.Error));
  const derived = path.join(evidence, 'vite-config.mjs');
  fs.writeFileSync(derived, compiled.outputText, { flag: 'wx', mode: 0o600 });
  const { default: nativeConfig } = await import(pathToFileURL(derived).href);
  assert.equal(nativeConfig.resolve.alias['@'], path.join(source, 'src'));
  write(path.join(evidence, 'config-adapter.json'), { source: pinned(configFile), derived: checked(derived, { sha256: sha(fs.readFileSync(derived)) }), dirnameBindings, importBindings: configImports, typescript: ts.version });
  const modules = new Map(), chunks = [], loadHashes = new Map(); let resolved;
  function moduleFile(id) {
    let candidate = id.split('?')[0];
    if (!fs.existsSync(candidate) && candidate.startsWith('/')) candidate = path.resolve(source, 'public', '.' + candidate);
    return binding(candidate);
  }
  const observer = { name: 'mutter-admin-retained-emission-observer', enforce: 'pre',
    configResolved(value) { resolved = value; },
    load(id) {
      if (!id.startsWith('\0') && fs.existsSync(id.split('?')[0]) && fs.statSync(id.split('?')[0]).isFile()) {
        const input = moduleFile(id); loadHashes.set(id, sha(fs.readFileSync(input.realpath)));
      }
      return null;
    },
    generateBundle(_options, bundle) {
      for (const [name, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue;
        const chunk = { path: name, isEntry: output.isEntry, isDynamicEntry: output.isDynamicEntry, imports: output.imports, dynamicImports: output.dynamicImports, modules: [] };
        for (const [id, info] of Object.entries(output.modules)) {
          let item = modules.get(id);
          if (!item) {
            item = { id, virtual: id.startsWith('\0'), chunks: [], renderedLength: 0 };
            if (!item.virtual) {
              item.binding = moduleFile(id); item.sourceSha256 = sha(fs.readFileSync(item.binding.realpath));
              if (loadHashes.has(id)) assert.equal(item.sourceSha256, loadHashes.get(id), 'Module changed after load');
              item.package = owner(item.binding.path);
            }
            forbidGraph(id, item.package); modules.set(id, item);
          }
          item.chunks.push(name); item.renderedLength += info.renderedLength; chunk.modules.push(id);
        }
        chunks.push(chunk);
      }
    } };
  const dist = path.join(evidence, 'dist'); assert(!fs.existsSync(dist));
  await build({ ...nativeConfig, root: source, configFile: false, mode: 'production', envFile: false, envDir: false,
    cacheDir: path.join(evidence, 'vite-cache'), resolve: { ...nativeConfig.resolve, preserveSymlinks: true },
    plugins: [...nativeConfig.plugins, observer], build: { outDir: dist, copyPublicDir: false, emptyOutDir: false } });
  assert(resolved && chunks.length && modules.size);
  assert.equal(resolved.mode, 'production'); assert.equal(resolved.build.minify, 'esbuild');
  assert.equal(resolved.resolve.preserveSymlinks, true); assert.equal(resolved.build.copyPublicDir, false);
  const written = files(dist), fingerprints = await emission.fingerprintSource(source);
  for (const file of written) {
    const bytes = fs.readFileSync(path.join(dist, file.path));
    assert(!bytes.includes(fingerprints.raw) && !bytes.includes(fingerprints.body)
      && fingerprints.windows.filter(window => bytes.includes(window.bytes)).length < 3, 'Forbidden embedded payload');
  }
  for (const item of modules.values()) {
    forbidGraph(item.id, item.package);
    if (item.binding) {
      assert.deepEqual(binding(path.join(source, item.binding.path)), item.binding);
      assert.equal(sha(fs.readFileSync(item.binding.realpath)), item.sourceSha256);
      if (item.package) checked(path.join(source, item.package.path, 'package.json'), { sha256: item.package.manifestSha256, realpath: item.package.realpath });
    } else assert(item.virtual && item.id.startsWith('\0'));
  }
  for (const chunk of chunks) {
    const file = written.find(item => item.path === chunk.path); assert(file);
    assert(chunk.modules.length && chunk.modules.every(id => modules.get(id)?.chunks.includes(chunk.path)));
    Object.assign(chunk, { bytes: file.bytes, sha256: file.sha256 });
  }
  for (const file of written.filter(item => /\.[cm]?js$/.test(item.path))) assert(chunks.some(chunk => chunk.path === file.path));
  assert(written.some(file => file.path === 'index.html'));
  const observedDependencies = [...additionalInputs.values()].sort((a, b) => a.realpath.localeCompare(b.realpath));
  for (const input of observedDependencies) {
    checked(input.path, input);
    assert.equal(sha(fs.readFileSync(input.package.manifestPath)), input.package.manifestSha256);
  }
  assert.equal(sha(fs.readFileSync(lockFile)), lockPin.sha256);
  write(path.join(evidence, 'additional-retained-inputs.json'), { status: 'VERIFIED_BEFORE_LOAD_AND_AFTER_EMISSION',
    historicalApprovalClaimed: false, source: base, lock: { path: lockFile, sha256: lockPin.sha256 }, files: observedDependencies });
  write(path.join(evidence, 'spa-inventory.json'), { schemaVersion: 1, stage: 'POST_BUILD_WRITTEN_BYTES', source, dist, node: process.version,
    modules: [...modules.values()], chunks, files: written, inspection: { status: 'PASS', moduleBindingsVerifiedAfterEmission: true,
      nativeFingerprintSource: fingerprints.identity }, manifests, priorInventory: { path: priorInventoryPath, sha256: priorInventoryPin.sha256 },
    config: { mode: resolved.mode, minify: resolved.build.minify, cwd: process.cwd(), plugins: resolved.plugins.map(plugin => plugin.name) },
    additionalRetainedInputCount: observedDependencies.length,
    localOverrides: { preserveSymlinks: true, copyPublicDir: false, envFile: false, envDir: false } });
  return { files: written.length, chunks: chunks.length, modules: modules.size, dist };
}

async function main() {
  assert.equal(process.version, manifest.buildNode, 'Use the exact published build Node version');
  assert(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Unreviewed loaders are forbidden');
  await rejectImplicitEnvironment(source);
  const environment = process.env.GITHUB_ACTIONS === 'true'
    ? isolatedCiEnvironment(process.env, publicConfig).env : buildEnvironment(process.env, publicConfig);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, environment);
  const before = inputs();
  const evidenceRoot = path.join(source, 'build-evidence');
  fs.mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  const evidence = fs.mkdtempSync(path.join(evidenceRoot, 'spa-'));
  const report = { startedAt: new Date().toISOString(), deployment: manifest.deployment, node: process.version, productionActions: false };
  try {
    report.output = await emit(evidence);
    const built = json(path.join(evidence, 'spa-inventory.json'));
    assert.deepEqual(inputs(), before, 'Sources changed during build');
    const observed = built.modules.filter(item => item.binding).map(item => ({ path: item.binding.path, sha256: item.sourceSha256 })).sort((a,b) => a.path.localeCompare(b.path));
    const expected = manifest.modules.slice().sort((a,b) => a.path.localeCompare(b.path));
    assert.deepEqual(observed, expected, 'Written SPA module closure differs from the published source');
    const actual = new Map(built.files.map(file => [file.path, file]));
    assert.equal(actual.size, manifest.spaFiles.length, 'Unexpected emitted files');
    for (const row of manifest.spaFiles) {
      assert.deepEqual(actual.get(row.path), row, 'Emitted bytes differ from the published SPA: ' + row.path);
    }
    const dist = path.join(source, 'dist');
    assert(!fs.existsSync(dist), 'Remove only the disposable previous local dist before rebuilding');
    fs.renameSync(path.join(evidence, 'dist'), dist);
    report.status = 'PASS'; report.byteIdenticalSpa = true; report.moduleClosureVerified = true;
  } catch (error) {
    report.status = 'FAIL'; report.error = error.message; process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString(); write(path.join(evidence, 'result.json'), report);
    console.log(JSON.stringify({ ...report, evidence }));
  }
}
await main();
