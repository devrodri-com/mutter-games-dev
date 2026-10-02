const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildEnvironment, isolatedCiEnvironment, rejectImplicitEnvironment } = require('../environment.cjs');
const { declaredDuration, digest, jsonBytes } = require('../identity.cjs');
const { destination, inventory, verifyInventory, inspectBytes } = require('../files.cjs');
const publicConfig = require('../public-production.json');
const { normalizeSourceMap } = require('../sourcemaps.cjs');

test('builder receives only allowed process keys and the explicit public configuration', () => {
  const env = buildEnvironment({ PATH: '/bin', HOME: '/user', UNRELATED_SETTING: 'not-inherited' }, publicConfig);
  assert.equal(env.UNRELATED_SETTING, undefined);
  assert.equal(env.VITE_FIREBASE_PROJECT_ID, 'mutter-games');
  assert.equal(env.NODE_ENV, 'production');
});
for (const key of ['MP_ACCESS_TOKEN', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS',
  'RELEASE_ATTESTATION_SECRET', 'CRON_SECRET', 'WEB_ADMISSION_HMAC_SECRET', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_PASSWORD', 'AZURE_EXTENSION_DIR']) {
  test(`build rejects ${key}, even an empty value`, () => {
    assert.throws(() => buildEnvironment({ [key]: '' }, publicConfig), /Forbidden build environment variable/);
    assert.throws(() => buildEnvironment({ [key]: 'SYNTHETIC_TEST_ONLY' }, publicConfig), /Forbidden build environment variable/);
  });
}
test('build rejects an injected Node loader or extra browser setting', () => {
  assert.throws(() => buildEnvironment({ NODE_OPTIONS: '--require unexpected.cjs' }, publicConfig), /loader/);
  assert.throws(() => buildEnvironment({ VITE_UNREVIEWED: 'value' }, publicConfig), /Unreviewed public/);
});
test('CI infrastructure tokens are removed before the strict builder process', () => {
  const input = { PATH: '/bin', ACTIONS_RUNTIME_TOKEN: 'synthetic-infrastructure-token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-oidc-token' };
  assert.throws(() => buildEnvironment(input, publicConfig), /Forbidden build/);
  const boundary = isolatedCiEnvironment(input, publicConfig);
  assert.deepEqual(boundary.removedInfrastructureNames, ['ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']);
  assert.equal(boundary.env.ACTIONS_RUNTIME_TOKEN, undefined);
  assert.equal(boundary.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
  assert(!JSON.stringify(boundary).includes('synthetic-infrastructure-token'));
  assert(!JSON.stringify(boundary).includes('synthetic-oidc-token'));
  assert.doesNotThrow(() => buildEnvironment(boundary.env, publicConfig));
});
test('the exact GitHub Linux Azure CLI tooling directory is removed before build', () => {
  const input = { PATH: '/bin', GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', AZURE_EXTENSION_DIR: '/opt/az/azcliextensions' };
  assert.throws(() => buildEnvironment(input, publicConfig), /Forbidden build environment variable: AZURE_EXTENSION_DIR/);
  const boundary = isolatedCiEnvironment(input, publicConfig);
  assert.deepEqual(boundary.removedInfrastructureNames, ['AZURE_EXTENSION_DIR']);
  assert.equal(boundary.env.AZURE_EXTENSION_DIR, undefined);
  assert(!JSON.stringify(boundary.env).includes('/opt/az/azcliextensions'));
  assert.doesNotThrow(() => buildEnvironment(boundary.env, publicConfig));
});
test('Azure tooling path removal rejects other values and non-GitHub Linux envelopes', () => {
  const input = { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', AZURE_EXTENSION_DIR: '/opt/az/azcliextensions' };
  for (const patch of [{ AZURE_EXTENSION_DIR: '' }, { AZURE_EXTENSION_DIR: '/tmp/unreviewed' },
    { AZURE_EXTENSION_DIR: '/opt/az/azcliextensions/../private' }, { AZURE_EXTENSION_DIR: 'synthetic-private-value' },
    { GITHUB_ACTIONS: undefined }, { GITHUB_ACTIONS: 'false' }, { RUNNER_OS: undefined }, { RUNNER_OS: 'macOS' }])
    assert.throws(() => isolatedCiEnvironment({ ...input, ...patch }, publicConfig));
});
test('reviewed Azure tooling metadata cannot hide Azure or business credentials', () => {
  for (const name of ['AZURE_CLIENT_SECRET', 'AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_ACCESS_TOKEN',
    'AZURE_CLIENT_CERTIFICATE_PATH', 'MP_ACCESS_TOKEN', 'FIREBASE_PRIVATE_KEY', 'RELEASE_ATTESTATION_SECRET']) {
    for (const value of ['', 'synthetic-private-value']) assert.throws(() => isolatedCiEnvironment({
      GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', AZURE_EXTENSION_DIR: '/opt/az/azcliextensions', [name]: value,
    }, publicConfig), error => error.message.includes(`Forbidden build environment variable: ${name}`));
  }
});
test('CI cannot hide business or additional private credentials behind infrastructure tokens', () => {
  for (const name of ['MP_ACCESS_TOKEN', 'FIREBASE_PRIVATE_KEY', 'RELEASE_ATTESTATION_SECRET', 'GITHUB_TOKEN', 'ACTIONS_UNREVIEWED_TOKEN'])
    assert.throws(() => isolatedCiEnvironment({ ACTIONS_RUNTIME_TOKEN: 'synthetic-platform', [name]: '' }, publicConfig), /Forbidden build/);
});
test('missing, extra or malformed public settings fail closed', () => {
  const missing = { ...publicConfig }; delete missing.VITE_FIREBASE_APP_ID;
  assert.throws(() => buildEnvironment({}, missing), /exactly/);
  assert.throws(() => buildEnvironment({}, { ...publicConfig, RELEASE_ATTESTATION_SECRET: 'not-allowed' }), /exactly/);
  assert.throws(() => buildEnvironment({}, { ...publicConfig, VITE_ADMIN_API_URL: 'https://user:password@example.com' }), /HTTPS origin/);
  assert.throws(() => buildEnvironment({}, { ...publicConfig, VITE_FIREBASE_PROJECT_ID: '' }), /Invalid public/);
});
test('implicit production environment file cannot bypass the allowlist', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mutter-prebuilt-env-'));
  try {
    await rejectImplicitEnvironment(root);
    await fs.writeFile(path.join(root, '.env.production'), 'SYNTHETIC=1\n');
    await assert.rejects(rejectImplicitEnvironment(root), /Implicit build environment/);
  } finally { await fs.rm(root, { recursive: true }); }
});
test('maxDuration comes from actual exported source config', () => {
  assert.equal(declaredDuration('export const config = { maxDuration: 60 };', 'handler.ts'), 60);
  for (const source of ['export default function handler() {}', 'export const config = duration;',
    'export const config = { maxDuration: Number(process.env.TIMEOUT) };', 'export const config = { maxDuration: 0 };'])
    assert.throws(() => declaredDuration(source, 'handler.ts'));
});
test('artifact destinations cannot traverse or use absolute paths', () => {
  for (const value of ['../escape', '/absolute', 'a/../../escape', 'a\\b']) assert.throws(() => destination('/tmp/root', value));
  assert.equal(destination('/tmp/root', 'functions/checkout.func/index.js'), '/tmp/root/functions/checkout.func/index.js');
});
test('inventory detects deleted bytes, changed modes and added files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mutter-prebuilt-files-'));
  try {
    await fs.writeFile(path.join(root, 'entry.js'), 'export default () => 42;\n', { mode: 0o644 });
    const before = await inventory(root);
    await verifyInventory(root, before);
    await fs.chmod(path.join(root, 'entry.js'), 0o600);
    await assert.rejects(verifyInventory(root, before), /differ/);
    await fs.chmod(path.join(root, 'entry.js'), 0o644);
    await fs.writeFile(path.join(root, 'extra'), 'extra');
    await assert.rejects(verifyInventory(root, before), /differ/);
    await fs.unlink(path.join(root, 'extra'));
    await fs.writeFile(path.join(root, 'entry.js'), 'changed');
    await assert.rejects(verifyInventory(root, before), /differ/);
    await fs.unlink(path.join(root, 'entry.js'));
    await assert.rejects(verifyInventory(root, before), /differ/);
  } finally { await fs.rm(root, { recursive: true }); }
});
test('function archive rejects a symlink to external data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mutter-prebuilt-link-'));
  try {
    await fs.symlink('/etc/hosts', path.join(root, 'outside'));
    await assert.rejects(inventory(root), /Escaping artifact symlink/);
  } finally { await fs.rm(root, { recursive: true }); }
});
test('scan distinguishes public browser settings from credentials', () => {
  assert.doesNotThrow(() => inspectBytes(jsonBytes(publicConfig), 'public-config.json'));
  assert.throws(() => inspectBytes(Buffer.from(`-----BEGIN ${'PRIVATE KEY'}-----\n${'A'.repeat(64)}\n-----END PRIVATE KEY-----`), 'bad.map'), /Credential-shaped/);
  assert.doesNotThrow(() => inspectBytes(Buffer.from('const keyType = "-----BEGIN PRIVATE KEY-----";'), 'format-detector.js'));
  assert.throws(() => inspectBytes(Buffer.from(`APP_USR-${'9'.repeat(40)}`), 'bad.js'), /Credential-shaped/);
});
test('scan rejects Edge bytes and paths without loading them', () => {
  const fingerprints = { raw: Buffer.from('raw-forbidden-payload'), body: Buffer.from('decoded-forbidden-payload'),
    windows: [1, 2, 3, 4].map(value => ({ bytes: Buffer.from(`fingerprint-${value}`) })) };
  assert.throws(() => inspectBytes(fingerprints.raw, 'output.js', fingerprints), /Edge payload/);
  assert.throws(() => inspectBytes(Buffer.from('fingerprint-1 fingerprint-2 fingerprint-3'), 'output.js', fingerprints), /Edge payload/);
  assert.throws(() => inspectBytes(Buffer.from('{}'), 'node_modules/@edge-runtime/vm/package.json'), /Edge package/);
  assert.doesNotThrow(() => inspectBytes(Buffer.from('normal application'), 'output.js', fingerprints));
});
test('function artifacts reject unreviewed native binaries on any build host', () => {
  assert.throws(() => inspectBytes(Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'renamed-data'), /executable binary/);
  assert.throws(() => inspectBytes(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), 'renamed-data'), /executable binary/);
  assert.throws(() => inspectBytes(Buffer.from('synthetic-native'), 'binding.node'), /Native binary/);
});
test('identity canonical encoding produces stable hashes', () => {
  const identity = { schemaVersion: 1, head: 'a'.repeat(40), tree: 'b'.repeat(40), packageLockSha256: 'c'.repeat(64), functionsLockSha256: 'd'.repeat(64), builder: '@vercel/node@5.10.2', buildNode: 'v22.23.3' };
  assert.equal(digest(JSON.stringify(identity)), digest(JSON.stringify(JSON.parse(JSON.stringify(identity)))));
  assert.notEqual(digest(JSON.stringify(identity)), digest(JSON.stringify({ ...identity, tree: 'e'.repeat(40) })));
});
test('generated maps from different checkout roots yield exactly the same normalized bytes', () => {
  const makeMap = root => Buffer.from(JSON.stringify({ version: 3, file: 'checkout.ts', sources: [`${root}/api/checkout.ts`],
    names: ['handler'], mappings: 'AAAA', sourcesContent: ['export default function handler() {}'] }));
  const a = normalizeSourceMap(makeMap('/work/first'), 'api/checkout.js.map', '/work/first', { 'api/checkout.ts': 'known' });
  const b = normalizeSourceMap(makeMap('/other/second'), 'api/checkout.js.map', '/other/second', { 'api/checkout.ts': 'known' });
  assert(a.bytes.equals(b.bytes));
  assert.deepEqual(JSON.parse(a.bytes).sources, ['checkout.ts']);
  assert.notEqual(a.transformation.sourceSha256, b.transformation.sourceSha256);
  assert.equal(a.transformation.outputSha256, b.transformation.outputSha256);
  const { sources: _sourcesBefore, ...before } = JSON.parse(makeMap('/work/first'));
  const { sources: _sourcesAfter, ...after } = JSON.parse(a.bytes);
  assert.deepEqual(after, before);
});
test('map normalization rejects escapes, missing provenance and malformed maps', () => {
  const map = { version: 3, file: 'checkout.ts', sources: ['/work/source/api/checkout.ts'], names: [], mappings: 'AAAA' };
  const run = value => normalizeSourceMap(Buffer.from(JSON.stringify(value)), 'api/checkout.js.map', '/work/source', { 'api/checkout.ts': 'known' });
  assert.throws(() => run({ ...map, sources: ['/work/source/../escape.ts'] }), /escapes/);
  assert.throws(() => run({ ...map, sources: ['/unrelated/file.ts'] }), /outside/);
  assert.throws(() => run({ ...map, sources: ['/work/source/api/not-traced.ts'] }), /provenance/);
  assert.throws(() => run({ ...map, version: 2 }), /Malformed/);
  assert.throws(() => run({ ...map, sourceRoot: '/work/source' }), /structure/);
  assert.throws(() => normalizeSourceMap(Buffer.from('broken'), 'api/checkout.js.map', '/work/source', {}));
  assert.throws(() => normalizeSourceMap(Buffer.from(JSON.stringify(map)), '../escape.js.map', '/work/source', {}), /Unsafe/);
  assert.throws(() => normalizeSourceMap(Buffer.from(JSON.stringify(map)), 'node_modules/sdk/x.js.map', '/work/source', {}), /Only generated/);
});
