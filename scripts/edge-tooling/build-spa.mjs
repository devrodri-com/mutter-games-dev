// Run under the required load observer. The plugin observes the real Vite build;
// it does not transform modules or change minification/production configuration.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import emission from './emission.cjs';
const { inspectSpaArtifacts, digest } = emission;

export async function buildSpa(source, dist, inventoryPath) {
  source = await fs.realpath(source);
  dist = path.resolve(dist);
  const require = createRequire(path.join(source, 'package.json'));
  const { build } = await import(pathToFileURL(path.join(path.dirname(require.resolve('vite/package.json')), 'dist/node/index.js')).href);
  const modules = new Map();
  const chunks = [];
  let config;
  const packageCache = new Map();
  async function owner(file) {
    let directory = path.dirname(file);
    while (directory.startsWith(`${source}${path.sep}`)) {
      if (packageCache.has(directory)) return packageCache.get(directory);
      try {
        const bytes = await fs.readFile(path.join(directory, 'package.json'));
        const pkg = JSON.parse(bytes);
        if (typeof pkg.name === 'string' && typeof pkg.version === 'string') {
          const value = { name: pkg.name, version: pkg.version, path: path.relative(source, directory), manifestSha256: digest(bytes) };
          packageCache.set(directory, value);
          return value;
        }
      } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
      directory = path.dirname(directory);
    }
    return null;
  }
  const observer = {
    name: 'mutter-edge-emission-observer',
    configResolved(value) { config = value; },
    async generateBundle(_options, bundle) {
      for (const [name, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue;
        const chunk = { path: name, isEntry: output.isEntry, isDynamicEntry: output.isDynamicEntry, imports: output.imports, dynamicImports: output.dynamicImports, modules: [] };
        for (const [id, info] of Object.entries(output.modules)) {
          const relative = id.replaceAll(source, '<SOURCE>');
          let item = modules.get(relative);
          if (!item) {
            item = { id: relative, virtual: id.startsWith('\0'), chunks: [], renderedLength: 0 };
            let candidate = id.split('?')[0];
            if (!item.virtual) {
              if (!candidate.startsWith(`${source}${path.sep}`) && candidate.startsWith('/') && typeof config.publicDir === 'string') {
                // Vite models imports of public assets by their root URL, not
                // their filesystem name. Bind that origin to real source bytes.
                const publicFile = path.resolve(config.publicDir, `.${candidate}`);
                if (!publicFile.startsWith(`${config.publicDir}${path.sep}`)) throw new Error(`Public asset escapes Vite publicDir: ${relative}`);
                candidate = publicFile;
                item.origin = 'vite-public-asset';
              }
              if (!candidate.startsWith(`${source}${path.sep}`)) throw new Error(`Unverified Vite module outside source: ${relative}`);
              item.sourcePath = path.relative(source, candidate);
              item.sourceSha256 = digest(await fs.readFile(candidate));
              item.package = await owner(candidate);
            }
            modules.set(relative, item);
          }
          item.chunks.push(name);
          item.renderedLength += info.renderedLength;
          chunk.modules.push(relative);
        }
        chunks.push(chunk);
      }
    },
  };
  const configPath = path.join(source, 'vite.config.ts');
  const configBefore = await fs.readFile(configPath);
  const lockBefore = await fs.readFile(path.join(source, 'package-lock.json'));
  await build({ root: source, configFile: configPath, mode: 'production', plugins: [observer], build: { outDir: dist } });
  if (!config || !chunks.length || !modules.size) throw new Error('NOT_VERIFIED: Vite emitted no observed graph');
  if (!configBefore.equals(await fs.readFile(configPath)) || !lockBefore.equals(await fs.readFile(path.join(source, 'package-lock.json')))) throw new Error('Vite inputs changed during build');
  const files = [];
  async function collect(directory, relative = '') {
    for (const name of (await fs.readdir(directory)).sort()) {
      const absolute = path.join(directory, name);
      const rel = relative ? `${relative}/${name}` : name;
      const stat = await fs.lstat(absolute);
      if (stat.isDirectory()) await collect(absolute, rel);
      else {
        if (!stat.isFile()) throw new Error(`NOT_VERIFIED: Unsupported SPA output object: ${rel}`);
        const bytes = await fs.readFile(absolute);
        files.push({ path: rel, type: 'file', bytes: bytes.length, sha256: digest(bytes) });
      }
    }
  }
  // This boundary is deliberately AFTER await build(): later Vite hooks can
  // rewrite preload placeholders after generateBundle observed the module graph.
  await collect(dist);
  for (const chunk of chunks) {
    const file = files.find(item => item.path === chunk.path);
    if (!file) throw new Error(`NOT_VERIFIED: Written chunk missing: ${chunk.path}`);
    chunk.bytes = file.bytes;
    chunk.sha256 = file.sha256;
  }
  const inventory = { schemaVersion: 1, stage: 'POST_BUILD_WRITTEN_BYTES', generatedAt: new Date().toISOString(), source, dist, node: process.version, vite: require('vite/package.json').version, config: { path: configPath, sha256: digest(configBefore), mode: config.mode, minify: config.build.minify, plugins: config.plugins.map(item => item.name) }, lockSha256: digest(lockBefore), modules: [...modules.values()], chunks, files };
  await fs.writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const inspected = await inspectSpaArtifacts(source, dist, inventory);
  return { status: inspected.status, inventoryPath, inventorySha256: digest(await fs.readFile(inventoryPath)), chunks: chunks.length, modules: modules.size, files: files.length, fingerprintSource: inspected.fingerprintSource };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, dist, inventory] = process.argv.slice(2);
  if (!source || !dist || !inventory || process.argv.length !== 5) throw new Error('Usage: build-spa.mjs <source> <dist> <inventoryPath>');
  buildSpa(source, dist, inventory).then(result => console.log(JSON.stringify({ gate: 'edge-spa-emission', ...result }))).catch(error => {
    console.error(JSON.stringify({ gate: 'edge-spa-emission', status: error.code === 'EDGE_EMISSION_FORBIDDEN' ? 'FAIL' : 'NOT_VERIFIED', code: error.code ?? null, message: error.message }));
    process.exitCode = 1;
  });
}
