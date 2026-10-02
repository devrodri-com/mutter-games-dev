// Negative tests mutate only a disposable COPY of an actual, verified build.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { verifyPrebuilt } = require('./verify.cjs');
const { STAMP_PATH, jsonBytes } = require('./identity.cjs');

async function testOutput(source, artifact) {
  const positive = await verifyPrebuilt(source, artifact);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mutter-prebuilt-negative-'));
  const results = [];
  try {
    for (const [name, relative, mutate] of [
      ['missing SPA', '.vercel/output/static/index.html', () => null],
      ['changed runtime', '.vercel/output/functions/api/create-mp-preference.func/.vc-config.json', bytes => jsonBytes({ ...JSON.parse(bytes), runtime: 'nodejs20.x' })],
      ['changed duration', '.vercel/output/functions/api/internal/web-stock-reconcile.func/.vc-config.json', bytes => jsonBytes({ ...JSON.parse(bytes), maxDuration: 300 })],
      ['changed identity', `.vercel/output/functions/api/create-mp-preference.func/${STAMP_PATH}`, bytes => jsonBytes({ ...JSON.parse(bytes), head: 'f'.repeat(40) })],
      ['changed routes', '.vercel/output/config.json', bytes => jsonBytes({ ...JSON.parse(bytes), routes: [{ src: '.*', dest: '/index.html' }] })],
      ['missing attestation', '.vercel/output/functions/api/internal/web-stock-reconcile.func/api/_lib/release-attestation.js', () => null],
      ['missing function dependency', '.vercel/output/functions/api/create-mp-preference.func/api/_lib/checkout-domain.js', () => null],
      ['credential in sourcemap', '.vercel/output/functions/api/create-mp-preference.func/api/create-mp-preference.js.map', bytes => Buffer.concat([bytes, Buffer.from(`APP_USR-${'9'.repeat(40)}`)])],
      ['changed sourcemap mappings', '.vercel/output/functions/api/create-mp-preference.func/api/create-mp-preference.js.map', bytes => Buffer.from(JSON.stringify({ ...JSON.parse(bytes), mappings: 'tampered' }))],
      ['unattributed sourcemap transformation', 'manifest.json', bytes => {
        const manifest = JSON.parse(bytes); manifest.functions[0].sourceMapTransformations[0].field = 'mappings'; return jsonBytes(manifest);
      }],
      ['corrupted source receipt', 'receipts/functions/output-manifest-checkout.json', bytes => jsonBytes({ ...JSON.parse(bytes), builder: '0.0.0' })],
      ['missing native case', 'receipts/prebuilt-native/result.json', bytes => {
        const value = JSON.parse(bytes); value.cases.pop(); return jsonBytes(value);
      }],
      ['duplicated native case', 'receipts/prebuilt-native/result.json', bytes => {
        const value = JSON.parse(bytes); value.cases[value.cases.length - 1] = value.cases[0]; return jsonBytes(value);
      }],
      ['failed native case disguised by passed', 'receipts/prebuilt-native/result.json', bytes => {
        const value = JSON.parse(bytes); value.cases[0].exitCode = 1; return jsonBytes(value);
      }],
      ['network denial missing', 'receipts/prebuilt-native/network-isolation.json', bytes => jsonBytes({ ...JSON.parse(bytes), unrestrictedFallback: true })],
    ]) {
      const copy = path.join(root, String(results.length));
      await fs.cp(artifact, copy, { recursive: true, preserveTimestamps: true });
      const file = path.join(copy, relative);
      const before = await fs.readFile(file);
      const after = mutate(before);
      if (after === null) await fs.unlink(file); else await fs.writeFile(file, after);
      let rejected = false;
      try { await verifyPrebuilt(source, copy); }
      catch { rejected = true; }
      assert(rejected, `Corruption was accepted: ${name}`);
      results.push({ name, rejected });
      await fs.rm(copy, { recursive: true });
    }
  } finally { await fs.rm(root, { recursive: true }); }
  return { status: 'PASS', positive, negativeCases: results, sourceArtifactModified: false };
}
if (require.main === module) {
  if (!process.argv[2] || process.argv.length !== 3) throw new Error('Usage: node scripts/release-prebuilt/test-output.cjs <artifact-root>');
  testOutput(path.resolve(__dirname, '../..'), path.resolve(process.argv[2])).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(JSON.stringify({ status: 'FAIL', message: error.message })); process.exitCode = 1; });
}
module.exports = { testOutput };
