// Run the official emulator process unchanged; keep synthetic action links out of CI logs.
'use strict';
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');
const [cli, config, command] = process.argv.slice(2);
if (process.argv.length !== 5 || !cli || !config || !['npm run test:catalog:run', 'npm test', 'node scripts/run-catalog-browser.mjs'].includes(command)) {
  throw new Error('Expected official Firebase CLI, demo emulator config and a declared test command');
}
const configuration = JSON.parse(fs.readFileSync(config, 'utf8'));
for (const service of ['auth', 'firestore']) {
  if (configuration.emulators?.[service]?.host !== '127.0.0.1') throw new Error('Demo services must bind to loopback');
}
const child = spawn(process.execPath, [path.resolve(cli), 'emulators:exec', '--only', 'firestore,auth', '--project', 'demo-mutter-r1', '--config', path.resolve(config), command], {
  env: process.env, stdio: ['inherit', 'pipe', 'pipe'],
});
function safeLine(line) {
  if (/To (?:reset the password|verify the email|sign in).*follow this link/i.test(line)) return '[official demo email action link redacted]';
  return line.replace(/oobCode=[^\s&"']+/g, 'oobCode=[redacted]')
    .replace(/(?:#|%23)recovery(?:=|%3D)[a-f0-9]{64}/gi, '#recovery=[redacted]');
}
for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  createInterface({ input: stream }).on('line', line => output.write(`${safeLine(line)}\n`));
}
const forwarding = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => child.kill(signal)]));
for (const [signal, forward] of forwarding) process.on(signal, forward);
let startFailed = false;
child.once('error', () => { startFailed = true; process.stderr.write('Official demo emulator process could not start\n'); });
child.once('close', (code, signal) => {
  for (const [name, forward] of forwarding) process.off(name, forward);
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = startFailed ? 1 : code ?? 1;
});
