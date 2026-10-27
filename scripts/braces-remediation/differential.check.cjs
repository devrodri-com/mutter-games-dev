'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { inspect, sha } = require('./control.cjs');
const manifest = require('./manifest.json');
const patch = require('./patch.json');
const root = path.resolve(__dirname, '../..');
inspect(root);
function originalCopy(destination) {
  fs.cpSync(path.join(root, 'node_modules/braces'), destination, { recursive: true });
  for (const change of patch.changes) {
    const file = path.join(destination, change.path);
    const lines = fs.readFileSync(file, 'utf8').match(/[^\n]*\n|[^\n]+$/g) || [];
    // Reverse in original ascending positions: earlier reversals restore later offsets.
    for (const edit of change.edits) {
      assert.deepEqual(lines.slice(edit.startLine, edit.startLine + edit.insert.length), edit.insert);
      lines.splice(edit.startLine, edit.insert.length, ...edit.remove);
    }
    fs.writeFileSync(file, lines.join(''));
  }
  for (const [file, hash] of Object.entries(manifest.originalFiles)) assert.equal(sha(fs.readFileSync(path.join(destination, file))), hash);
}
test('bounded original overflow versus deliberate patched rejection; shallow differential', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutter-braces-baseline-'));
  try {
    const modules = path.join(temp, 'node_modules'); fs.mkdirSync(modules);
    originalCopy(path.join(modules, 'braces'));
    for (const name of ['micromatch', 'fast-glob']) fs.cpSync(path.join(root, 'node_modules', name), path.join(modules, name), { recursive: true });
    const code = `
      const assert=require('node:assert/strict');
      const original=require(${JSON.stringify(path.join(modules, 'braces'))});
      const patched=require(${JSON.stringify(path.join(root, 'node_modules/braces'))});
      const mm=require(${JSON.stringify(path.join(modules, 'micromatch'))});
      const fg=require(${JSON.stringify(path.join(modules, 'fast-glob'))});
      const deep='{'.repeat(4000)+'x'+'}'.repeat(4000);
      for(const [name,fn] of [['compile',()=>original.compile(deep)],['micromatch',()=>mm.braces(deep)],['fast-glob',()=>fg.sync(deep)]]) {
        assert.throws(fn,e=>e instanceof RangeError && /call stack/i.test(e.message));
        console.log(JSON.stringify({original:name,outcome:'STACK_OVERFLOW',inputLength:deep.length}));
      }
      assert.throws(()=>patched.compile(deep),e=>e instanceof SyntaxError && /exceeds max depth/.test(e.message));
      let comparisons=0;
      const parts=['a','b','{','}',',','(',')','..','\\\\{','\\\\}','[a]'];
      let seed=12345;
      const patterns=['{{a}}','{a,{b}}','{{x}y}','{a,{b,{c}}','{}{a}','{1..8}','a/{1..3}/{x,y}','foo/({a,b})'];
      for(let i=0;i<2000;i++) {let s='';for(let j=0;j<12;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;s+=parts[seed%parts.length];}patterns.push(s);}
      const outcome=fn=>{try{return {value:fn()}}catch(e){return {error:e.name,message:e.message}}};
      for(const p of patterns) for(const m of ['compile','expand','stringify']) for(const escapeInvalid of [false,true]) {
        assert.deepEqual(outcome(()=>patched[m](p,{escapeInvalid})),outcome(()=>original[m](p,{escapeInvalid})),m+' '+p);comparisons++;
      }
      console.log(JSON.stringify({patched:'CONTROLLED_DEPTH_REJECTION',differentialComparisons:comparisons}));
    `;
    // A fixed 512 KiB stack makes the before/after resource budget reproducible
    // across arm64/macOS and x64/Linux (whose default optimized depths differ).
    const child = spawnSync(process.execPath, ['--max-old-space-size=192', '--stack-size=512', '-e', code], {
      cwd: temp, env: { ...process.env, NODE_PATH: path.join(root, 'node_modules') }, timeout: 15000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr); console.log(child.stdout);
    // The real build entry also rejects an otherwise authentic but unpatched package.
    fs.mkdirSync(path.join(temp, 'scripts'));
    fs.cpSync(__dirname, path.join(temp, 'scripts/braces-remediation'), { recursive: true });
    fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(temp, 'package-lock.json'));
    const entry = fs.existsSync(path.join(root, 'scripts/verify-api-packaging.cjs')) ? 'verify-api-packaging.cjs' : 'verify-edge-tooling.cjs';
    fs.copyFileSync(path.join(root, 'scripts', entry), path.join(temp, 'scripts', entry));
    const blocked = spawnSync(process.execPath, [path.join(temp, 'scripts', entry), 'build'], { timeout: 5000, encoding: 'utf8' });
    assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /Unpatched or changed braces/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
