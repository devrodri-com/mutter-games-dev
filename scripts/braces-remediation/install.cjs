'use strict';
// npm's dependency lifecycle runs before a root postinstall. Install without
// lifecycle, repair/verify all copies, then run the legitimate rebuild scripts.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inspect, patchDefinition } = require('./control.cjs');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../..'));
assert(process.argv.length <= 3, 'Usage: node install.cjs [package-root]');
patchDefinition(); // Missing/modified patch must fail before npm or any consumer.
for (const args of [['ci', '--ignore-scripts', '--no-audit', '--no-fund'], ['rebuild', '--ignore-scripts=false', '--foreground-scripts', '--no-audit', '--no-fund']]) {
  console.log(JSON.stringify({ installStage: args[0], lifecycle: args[0] === 'rebuild', directory: root }));
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args,
    { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  console.log(JSON.stringify(inspect(root, args[0] === 'ci')));
}
