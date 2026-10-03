'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { inspect } = require('./control.cjs');
const root = path.resolve(__dirname, '../..');
inspect(root);
const fromRoot = createRequire(path.join(root, 'package.json'));
const braces = fromRoot('braces');
const moduleRoot = path.dirname(fromRoot.resolve('braces/package.json'));
const nested = (depth, pair = '{}') => pair[0].repeat(depth) + 'x' + pair[1].repeat(depth);
const guarded = error => /exceeds max depth/.test(error.message) && !/call stack/i.test(error.message);
const ast = depth => {
  let node = { type: 'text', value: 'x' };
  for (let n = 0; n < depth; n++) node = { type: 'paren', nodes: [node] };
  return { type: 'root', nodes: [node] };
};
for (const method of ['parse', 'compile', 'expand', 'stringify']) {
  for (const pair of ['{}', '()']) test(`${method} ${pair}: 100 accepted, 101 and 4000 rejected before recursion`, () => {
    assert.doesNotThrow(() => braces[method](nested(100, pair)));
    for (const depth of [101, 4000]) assert.throws(() => braces[method](nested(depth, pair)), guarded);
  });
  test(`${method}: omitted/invalid/infinite/high and fractional depth cannot bypass cap`, () => {
    for (const maxDepth of [undefined, null, NaN, Infinity, -Infinity, '10000', {}, true, 10000]) {
      assert.throws(() => braces[method](nested(101), { maxDepth }), guarded);
    }
    for (const maxDepth of [0, -1, 0.5, 1.5, 2]) {
      assert.throws(() => braces[method](nested(Math.max(1, Math.floor(maxDepth) + 1)), { maxDepth }), guarded);
      if (maxDepth >= 1) assert.doesNotThrow(() => braces[method](nested(Math.floor(maxDepth)), { maxDepth }));
    }
  });
}
for (const method of ['compile', 'expand', 'stringify']) {
  test(`${method}: direct public/internal AST and nodes cycle`, () => {
    const internal = require(path.join(moduleRoot, 'lib', method));
    for (const fn of [braces[method], internal]) {
      assert.doesNotThrow(() => fn(ast(100)));
      assert.throws(() => fn(ast(101)), guarded);
      for (const maxDepth of [undefined, NaN, Infinity, '99999', 99999]) assert.throws(() => fn(ast(10000), { maxDepth }), guarded);
      assert.throws(() => fn(ast(2), { maxDepth: 1.5 }), guarded);
      const cycle = { type: 'paren', nodes: [] }; cycle.nodes.push(cycle);
      assert.throws(() => fn(cycle), guarded);
    }
  });
}
test('expand: cyclic parent links terminate deliberately in bounded child', () => {
  const code = `const b=require(${JSON.stringify(moduleRoot)}); for(const count of [1,2]) { const n={type:'paren',nodes:[{type:'text',value:'x'}]}; n.parent=count===1?n:{type:'paren',parent:n}; try { b.expand(n); process.exit(2); } catch(e) { if(!/parent chain contains a cycle/.test(e.message)) throw e; }} `;
  const child = spawnSync(process.execPath, ['--max-old-space-size=192', '-e', code], { timeout: 5000, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.signal, null);
});
test('stringify retains published escapeInvalid and escaped-brace semantics', () => {
  for (const pattern of ['{{a}}', '{a,{b}}', '{{x}y}', '{a,{b,{c}}', '{}{a}', '{1..8}']) {
    assert.equal(braces.stringify(braces.parse(pattern), { escapeInvalid: true }), pattern);
  }
  const escaped = '\\{'.repeat(1000) + 'x' + '\\}'.repeat(1000);
  assert.equal(braces.stringify(escaped, { keepEscaping: true }), escaped);
});
test('existing maximum characters and expansion limit remain enforced', () => {
  assert.throws(() => braces.parse('x'.repeat(10001)), /max characters/);
  assert.throws(() => braces.expand('{1..1001}'), /range limit/);
  assert.deepEqual(braces.expand('a/{1..3}/{x,y}'), ['a/1/x','a/1/y','a/2/x','a/2/y','a/3/x','a/3/y']);
});
test('actual micromatch and fast-glob reject the original deep input', () => {
  const mm = fromRoot('micromatch'), fg = fromRoot('fast-glob');
  assert.deepEqual(mm.braces('src/*.{ts,tsx}', { expand: true }), ['src/*.ts', 'src/*.tsx']);
  assert.throws(() => mm.braces(nested(4000)), guarded);
  assert.throws(() => fg.sync(nested(4000)), guarded);
});
test('actual builder/static-config/ts-morph chain resolves the repaired source', () => {
  const chain = ['@vercel/node', '@vercel/static-config', 'ts-morph', '@ts-morph/common', 'fast-glob', 'micromatch', 'braces'];
  let current = fromRoot;
  const resolved = [];
  for (const name of chain) {
    const file = current.resolve(`${name}/package.json`); resolved.push({ name, file: path.relative(root, file) }); current = createRequire(file);
  }
  assert.equal(path.dirname(current.resolve('./package.json')), moduleRoot);
  console.log(JSON.stringify({ actualChain: resolved }));
});
test('unpatched, partial, extra and changed-version copies stop the actual build entry before loading the builder', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutter-braces-negative-'));
  try {
    fs.mkdirSync(path.join(temp, 'scripts'), { recursive: true });
    fs.cpSync(__dirname, path.join(temp, 'scripts/braces-remediation'), { recursive: true });
    const entry = fs.existsSync(path.join(root, 'scripts/verify-api-packaging.cjs')) ? 'verify-api-packaging.cjs' : 'verify-edge-tooling.cjs';
    fs.copyFileSync(path.join(root, 'scripts', entry), path.join(temp, 'scripts', entry));
    fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(temp, 'package-lock.json'));
    const installed = path.join(temp, 'node_modules/braces');
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    const run = expected => {
      const child = spawnSync(process.execPath, [path.join(temp, 'scripts', entry), 'build'], { timeout: 5000, encoding: 'utf8' });
      assert.notEqual(child.status, 0); assert.equal(child.signal, null); assert.match(child.stderr, expected);
      assert(!child.stderr.includes("Cannot find module '@vercel/node'"), 'Builder must never load');
    };
    const reset = () => { fs.rmSync(installed, { recursive: true, force: true }); fs.cpSync(moduleRoot, installed, { recursive: true }); };
    reset(); fs.appendFileSync(path.join(installed, 'lib/parse.js'), '\n// drift\n'); run(/Unpatched or changed braces/);
    reset(); const metadata = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'))); metadata.version = '3.0.4'; fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify(metadata)); run(/Unexpected braces version/);
    reset(); fs.cpSync(installed, path.join(temp, 'node_modules/extra/node_modules/braces'), { recursive: true }); run(/Extra\/missing braces copy/);
    fs.rmSync(path.join(temp, 'node_modules/extra'), { recursive: true });
    const patch = path.join(temp, 'scripts/braces-remediation/patch.json');
    fs.appendFileSync(patch, ' '); run(/Braces patch missing or changed/);
    fs.unlinkSync(patch); run(/ENOENT/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
