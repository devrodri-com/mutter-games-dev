const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { verifyOperationalSources } = require('../operational.cjs');

function write(root, file, text) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutter-edge-operational-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  for (const directory of ['api/internal', 'src', 'scripts', 'functions', '.github/workflows']) fs.mkdirSync(path.join(root, directory), { recursive: true });
  for (const file of ['api/create-mp-preference.ts', 'api/internal/web-stock-reconcile.ts', 'api/access.ts']) write(root, file, "import type { VercelRequest } from '@vercel/node';\nexport default function handler(req: VercelRequest) { return req; }\n");
  for (const file of ['package.json', 'functions/package.json', 'vercel.json']) write(root, file, '{"scripts":{"dev":"vite"}}');
  write(root, 'vite.config.ts', 'export default {};');
  write(root, 'vitest.config.ts', "export default { test: { environment: 'happy-dom' } };");
  write(root, '.github/workflows/ci.yml', 'jobs:\n  build:\n    steps:\n      - run: npm run build\n');
  return root;
}

test('Node builder, type-only import, Vite and guard prose are not Edge consumers', t => {
  const root = fixture(t);
  write(root, 'scripts/build.cjs', "const { build } = require('@vercel/node'); const prohibited = ['startDevServer', 'edge-runtime']; void prohibited; build({});");
  write(root, 'docs/prohibition.md', 'Never run vercel dev or import edge-runtime.');
  write(root, 'scripts/edge-tooling/tests/fixtures/negative.cjs', "require('@edge-runtime/vm');");
  const result = verifyOperationalSources(root);
  assert.equal(result.status, 'PASS');
  assert(result.inspectedEntries.some(entry => entry.path === 'scripts/build.cjs'));
  assert(!result.inspectedEntries.some(entry => entry.path.includes('fixtures/negative')));
});

for (const [label, code] of [
  ['runtime module import', "import { EdgeVM } from '@edge-runtime/vm';"],
  ['relative installed Edge path', "require('../node_modules/@edge-runtime/primitives/load');"],
  ['new dev-server named consumer', "import { startDevServer as start } from '@vercel/node'; start({});"],
  ['dev-server method call', "require('@vercel/node').startDevServer({});"],
  ['dev-server aliased method', "const builder = require('@vercel/node'); const start = builder['startDevServer']; start({});"],
  ['computed constant module', "const target = '@edge-runtime/' + 'vm'; require(target);"],
  ['EdgeVM invocation', 'new EdgeVM({});'],
  ['runtime export', "export const runtime = 'edge';"],
  ['test environment change', "export default { test: { environment: 'edge-runtime' } };"],
  ['child CLI command', "require('node:child_process').spawn('npx', ['vercel', 'dev']);"],
]) test(`operational scanner rejects ${label}`, t => {
  const root = fixture(t); write(root, 'scripts/new-consumer.ts', code);
  assert.throws(() => verifyOperationalSources(root), { code: 'EDGE_OPERATIONAL_CONSUMER' });
});

test('package executable vercel dev fails even with an npm wrapper', t => {
  const root = fixture(t); write(root, 'package.json', JSON.stringify({ scripts: { dev: 'npx --yes vercel dev' } }));
  assert.throws(() => verifyOperationalSources(root), { code: 'EDGE_OPERATIONAL_CONSUMER' });
});

test('version-qualified dev-server through a package executor is still prohibited', t => {
  const root = fixture(t); write(root, 'package.json', JSON.stringify({ scripts: { dev: 'pnpm dlx vercel@44.0.0 dev' } }));
  assert.throws(() => verifyOperationalSources(root), { code: 'EDGE_OPERATIONAL_CONSUMER' });
});

test('workflow Edge CLI consumer fails', t => {
  const root = fixture(t); write(root, '.github/workflows/ci.yml', 'jobs:\n  build:\n    steps:\n      - run: edge-runtime handler.js\n');
  assert.throws(() => verifyOperationalSources(root), { code: 'EDGE_OPERATIONAL_CONSUMER' });
});

test('Vercel Edge runtime configuration fails', t => {
  const root = fixture(t); write(root, 'vercel.json', '{"functions":{"api/a.js":{"runtime":"edge"}}}');
  assert.throws(() => verifyOperationalSources(root), { code: 'EDGE_OPERATIONAL_CONSUMER' });
});

test('missing operational entry is NOT_VERIFIED rather than PASS', t => {
  const root = fixture(t); fs.unlinkSync(path.join(root, 'api/create-mp-preference.ts'));
  assert.throws(() => verifyOperationalSources(root), { code: 'EDGE_OPERATIONAL_NOT_VERIFIED' });
});

test('malformed workflow is NOT_VERIFIED rather than silently skipped', t => {
  const root = fixture(t); write(root, '.github/workflows/ci.yml', 'jobs: [broken');
  assert.throws(() => verifyOperationalSources(root), { code: 'EDGE_OPERATIONAL_NOT_VERIFIED' });
});

test('TypeScript JSONC comments are parsed using its actual configuration parser', t => {
  const root = fixture(t); write(root, 'tsconfig.app.json', '{\n// Existing TypeScript comments are valid.\n"compilerOptions": {"module": "ESNext",},\n}');
  assert.equal(verifyOperationalSources(root).status, 'PASS');
});

test('real test modules cannot activate Edge under cover of negative-fixture exemptions', t => {
  const root = fixture(t); write(root, 'tests/real.test.ts', "import { EdgeVM } from '@edge-runtime/vm';\n");
  assert.throws(() => verifyOperationalSources(root), { code: 'EDGE_OPERATIONAL_CONSUMER' });
});

test('Vitest per-file Edge environment directives are operational even in comments', t => {
  const root = fixture(t); write(root, 'tests/real.test.ts', '/* @vitest-environment edge-runtime */\nexport {};');
  assert.throws(() => verifyOperationalSources(root), { code: 'EDGE_OPERATIONAL_CONSUMER' });
});

test('Vitest CLI cannot override the checked environment with Edge', t => {
  const root = fixture(t); write(root, 'package.json', JSON.stringify({ scripts: { test: 'vitest run --environment edge-runtime' } }));
  assert.throws(() => verifyOperationalSources(root), { code: 'EDGE_OPERATIONAL_CONSUMER' });
});

test('an imported fixture is a real consumer and loses the input-only exclusion', t => {
  const root = fixture(t);
  write(root, 'scripts/fixtures/consumer.cjs', "require('@edge-runtime/vm');");
  write(root, 'scripts/real.cjs', "require('./fixtures/consumer.cjs');");
  assert.throws(() => verifyOperationalSources(root), { code: 'EDGE_OPERATIONAL_CONSUMER' });
});
