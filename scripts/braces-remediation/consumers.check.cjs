'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { inspect } = require('./control.cjs');
const root = path.resolve(__dirname, '../..');
inspect(root);
const req = createRequire(path.join(root, 'package.json'));
function chain(names) {
  let current = req; const entries = [];
  for (const name of names) { const file = current.resolve(name + '/package.json'); entries.push({ name, file: path.relative(root, file) }); current = createRequire(file); }
  assert.equal(current.resolve('./package.json'), req.resolve('braces/package.json'));
  console.log(JSON.stringify({ realResolution: entries }));
}
test('Tailwind, Firebase watcher, and typescript-eslint resolve the protected copy', () => {
  chain(['tailwindcss', 'fast-glob', 'micromatch', 'braces']);
  chain(['firebase-tools', 'chokidar', 'braces']);
  chain(['typescript-eslint', '@typescript-eslint/typescript-estree', 'fast-glob', 'micromatch', 'braces']);
});
test('actual PostCSS/Tailwind compilation and bounded eslint using repository config', async () => {
  const result = await req('postcss')([req('tailwindcss')({ content: [{ raw: '<div class="p-4 text-red-500"></div>', extension: 'html' }], corePlugins: { preflight: false } })]).process('@tailwind utilities;', { from: undefined });
  assert.match(result.css, /\.p-4/); assert.match(result.css, /\.text-red-500/);
  const lint = spawnSync(process.execPath, [path.join(path.dirname(req.resolve('eslint/package.json')), 'bin/eslint.js'), '--stdin', '--stdin-filename', 'src/braces-consumer-probe.ts'],
    { cwd: root, input: 'const value: number = 1;\nconsole.log(value);\n', encoding: 'utf8', timeout: 15000 });
  assert.equal(lint.status, 0, lint.stderr + lint.stdout);
});
test('real chokidar glob watcher observes an edit and rejects excessive nesting', { timeout: 10000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutter-braces-watcher-'));
  const chokidar = req('chokidar'); let watcher;
  try {
    const file = path.join(temp, 'sample.ts'); fs.writeFileSync(file, 'before');
    watcher = chokidar.watch(path.join(temp, '*.{ts,tsx}'), { usePolling: true, interval: 30, ignoreInitial: true });
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Watcher readiness timeout')), 3000);
      watcher.once('ready', () => { clearTimeout(timer); resolve(); }); watcher.once('error', reject); });
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Watcher change timeout')), 3000);
      watcher.once('change', changed => { clearTimeout(timer); try { assert.equal(changed, file); resolve(); } catch (error) { reject(error); } });
      fs.writeFileSync(file, 'after-content'); });
    // Chokidar 3.6 schedules add asynchronously. Observe its actual rejection in
    // a bounded child; do not pretend public add() throws synchronously.
    const code = `process.once('unhandledRejection', e => { if(e instanceof SyntaxError && /exceeds max depth/.test(e.message)) { console.log('CONTROLLED_DEPTH_REJECTION'); process.exit(0); } console.error(e); process.exit(2); }); require(${JSON.stringify(req.resolve('chokidar'))}).watch('{'.repeat(4000)+'x'+'}'.repeat(4000));`;
    const rejected = spawnSync(process.execPath, ['--max-old-space-size=192', '-e', code], { timeout: 5000, encoding: 'utf8' });
    assert.equal(rejected.signal, null); assert.equal(rejected.status, 0, rejected.stderr);
    assert.match(rejected.stdout, /CONTROLLED_DEPTH_REJECTION/);
  } finally { if (watcher) await watcher.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});
