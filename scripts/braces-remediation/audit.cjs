'use strict';
// Preserve the native JSON and native exit; this command never grants a waiver.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { sha } = require('./control.cjs');
const [scope, output, directory = '.'] = process.argv.slice(2);
assert(['prod', 'all'].includes(scope) && output && process.argv.length <= 5);
const root = fs.realpathSync(directory);
const args = ['audit', ...(scope === 'prod' ? ['--omit=dev', '--audit-level=moderate'] : ['--audit-level=high']), '--json'];
fs.mkdirSync(output, { recursive: true });
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (result.error) throw result.error;
fs.writeFileSync(path.join(output, `${scope}.json`), result.stdout, { flag: 'wx' });
fs.writeFileSync(path.join(output, `${scope}.stderr.log`), result.stderr, { flag: 'wx' });
const receipt = { scope, command: ['npm', ...args], exitCode: result.status, signal: result.signal,
  rawSha256: sha(result.stdout), lockSha256: sha(fs.readFileSync(path.join(root, 'package-lock.json'))),
  nativeResultUnmodified: true, releaseEligible: false };
fs.writeFileSync(path.join(output, `${scope}.receipt.json`), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipt));
process.stdout.write(result.stdout); process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
