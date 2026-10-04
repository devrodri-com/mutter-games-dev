'use strict';
// Wrap, never edit or reinterpret, the audited native command and its exit.
const { spawnSync } = require('node:child_process');
const { assert, path, sha, fs, write, components, context } = require('./common.cjs');
const [role, scope, output, directory = '.'] = process.argv.slice(2);
assert(['prod', 'all'].includes(scope) && output && ['.', 'functions'].includes(directory));
const root = path.resolve(__dirname, '../..');
components(root, role);
require('../braces-remediation/control.cjs').inspect(path.join(root, directory));
const binding = context(root);
const result = spawnSync(process.execPath, [path.join(root, 'scripts/braces-remediation/audit.cjs'), scope, output, directory], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
assert.equal(result.signal, null, 'Native audit terminated by signal');
write(path.join(output, 'context.json'), { context: binding, scope,
  directory: directory === 'functions' ? 'functions' : role === 'frontend' ? 'root' : 'admin',
  receiptSha256: sha(fs.readFileSync(path.join(output, `${scope}.receipt.json`))),
  stderrSha256: sha(fs.readFileSync(path.join(output, `${scope}.stderr.log`))) });
process.exitCode = result.status ?? 1;
