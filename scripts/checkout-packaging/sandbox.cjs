const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeJson } = require('./artifact.cjs');

const checkoutCases = Object.freeze([['cold-get', 'GET'], ['cold-post', 'POST'], ['cold-options', 'OPTIONS'], ['restarted-post', 'POST']]);
const reconcileCases = Object.freeze([
  ['reconcile-missing-secret', 'GET', 'missing-secret'], ['reconcile-empty-secret', 'GET', 'empty-secret'],
  ['reconcile-missing-header', 'GET', 'missing-header'], ['reconcile-wrong-secret', 'GET', 'wrong-secret'],
  ['reconcile-method', 'POST', 'wrong-secret'], ['reconcile-restarted-get', 'GET', 'wrong-secret'],
]);
const accessCases = Object.freeze([['access-cold-get', 'GET', '/api/access/session'], ['access-cold-post', 'POST', '/api/access/session'], ['access-options', 'OPTIONS', '/api/access/recovery/request'], ['access-complete-missing-authorization', 'POST', '/api/access/recovery/complete'], ['access-unknown-path', 'POST', '/api/access/unknown'], ['access-restarted-post', 'POST', '/api/access/session']]);
const attestationCases = Object.freeze(['missing-secret', 'empty-secret', 'short-secret', 'missing-header', 'wrong-secret', 'wrong-action', 'method', 'authorized', 'retry', 'missing-undici']);
const smokeCases = Object.freeze(['array-quote', 'array-availability']);
const EXPECTED_NATIVE_CASE_LABELS = Object.freeze([
  ...checkoutCases.map(([label]) => label), ...reconcileCases.map(([label]) => label),
  ...accessCases.map(([label]) => label),
  ...['checkout', 'reconcile', 'access'].flatMap(key => attestationCases.map(credentials => `attestation-${key}-${credentials}`)),
  ...smokeCases.map(credentials => `smoke-checkout-${credentials}`),
]);

async function verifyNativeProcesses(source, workspace, entries, options = {}) {
  const probe = path.join(workspace.root, 'native-probe.mjs');
  await fs.copyFile(path.join(__dirname, 'native-probe.mjs'), probe);
  // Preserve HOME when present; never repurpose a system variable as a private
  // sandbox directory. No business credentials or loader configuration is inherited.
  const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    ...(typeof process.env.HOME === 'string' ? { HOME: process.env.HOME } : {}),
    XDG_CONFIG_HOME: path.join(workspace.root, 'child-home', '.config'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
  const attempts = []; let selected; let parentNamespace = '';
  const candidates = [];
  if (process.platform === 'darwin') {
    if (process.env.CHECKOUT_PACKAGING_INHERITED_NETWORK_DENY === '1') {
      candidates.push({ name: 'inherited-macos-sandbox-with-effective-denial-check', command: process.execPath, prefix: [probe] });
    } else {
      const profile = `(version 1) (allow default) (deny network*) (deny file-read* (subpath ${JSON.stringify(source)}))`;
      const profilePath = path.join(workspace.root, 'network.sb');
      await fs.writeFile(profilePath, profile, { flag: 'wx', mode: 0o600 });
      candidates.push({ name: 'macos-sandbox-exec', command: '/usr/bin/sandbox-exec', prefix: ['-f', profilePath, process.execPath, probe] });
    }
  } else if (process.platform === 'linux') {
    parentNamespace = await fs.readlink('/proc/self/ns/net');
    candidates.push({ name: 'linux-unprivileged-network-namespace', command: '/usr/bin/unshare', prefix: ['--user', '--map-root-user', '--net', '--', process.execPath, probe] });
    // Both candidates enforce a new namespace; never fall back to normal networking.
    candidates.push({ name: 'linux-sudo-network-namespace', command: '/usr/bin/sudo', prefix: ['-n', '/usr/bin/unshare', '--net', '--', '/usr/bin/env', '-i', ...Object.entries(env).map(([key, value]) => `${key}=${value}`), process.execPath, probe] });
  } else throw new Error('No implemented OS network isolation on this platform');

  async function run(candidate, label, args, directory = workspace.emitted) {
    const child = spawnSync(candidate.command, [...candidate.prefix, ...args], { cwd: directory, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
    await fs.writeFile(path.join(workspace.root, `${label}.stdout`), child.stdout ?? '', { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(workspace.root, `${label}.stderr`), child.stderr ?? '', { flag: 'wx', mode: 0o600 });
    let observation;
    try { observation = JSON.parse((child.stdout ?? '').trim().split('\n').filter(Boolean).at(-1)); } catch { observation = null; }
    const record = { label, backend: candidate.name, exitCode: child.status, signal: child.signal, spawnError: child.error?.code ?? null, passed: child.status === 0 && observation?.passed === true, observation };
    await writeJson(path.join(workspace.root, `${label}.json`), record);
    return record;
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const result = await run(candidate, `network-canary-${i + 1}`, ['canary', parentNamespace]);
    attempts.push(result);
    if (result.passed) { selected = candidate; break; }
  }
  await writeJson(path.join(workspace.root, 'network-isolation.json'), { attempts, selected: selected?.name ?? null, unrestrictedFallback: false, homePreservedNotRepurposed: env.HOME === process.env.HOME, credentialEnvironmentInherited: false });
  assert(selected, 'OS denial not established; no handler was imported');
  assert.deepEqual(entries.map(entry => entry.key), require('./function-definitions.cjs').DEFINITIONS.map(item => item.key), 'Require every prepared function artifact');
  const [checkout, reconcile, access] = entries;
  const cases = [];
  for (const [label, method] of checkoutCases) {
    cases.push(await run(selected, label, ['invoke', checkout.directory, checkout.handler, method, 'checkout'], checkout.directory));
  }
  for (const [label, method, credentials] of reconcileCases) cases.push(await run(selected, label, ['invoke', reconcile.directory, reconcile.handler, method, 'reconcile', credentials], reconcile.directory));
  for (const [label, method, url] of accessCases) cases.push(await run(selected, label, ['invoke', access.directory, access.handler, method, 'access', url], access.directory));
  const attestationIdentity = options.attestationIdentity ?? null;
  for (const entry of entries) {
    const method = entry.key === 'reconcile' ? 'GET' : 'POST';
    for (const credentials of attestationCases) {
      const requestMethod = credentials === 'method' ? (method === 'GET' ? 'POST' : 'GET') : method;
      cases.push(await run(selected, `attestation-${entry.key}-${credentials}`, ['attest', entry.directory, entry.handler, requestMethod, entry.key, credentials, JSON.stringify(attestationIdentity)], entry.directory));
    }
    const first = cases.find(row => row.label === `attestation-${entry.key}-authorized`);
    const restarted = cases.find(row => row.label === `attestation-${entry.key}-retry`);
    if (first.passed && restarted.passed) assert.notEqual(first.observation.receipt.coldStartId, restarted.observation.receipt.coldStartId, 'Fresh processes reused a cold-start identity');
  }
  for (const credentials of smokeCases) {
    cases.push(await run(selected, `smoke-checkout-${credentials}`, ['smoke', checkout.directory, checkout.handler, 'POST', 'checkout', credentials], checkout.directory));
  }
  assert.deepEqual(cases.map(row => row.label), EXPECTED_NATIVE_CASE_LABELS, 'Native case matrix drifted');
  return { backend: selected.name, networkCanaries: attempts, cases, attestationIdentity, eachInvocationHasFreshProcess: true, nativeLoader: true, graphMocks: false, apiReplacements: false, credentialsInherited: false, homePreservedNotRepurposed: env.HOME === process.env.HOME };
}

module.exports = { verifyNativeProcesses, EXPECTED_NATIVE_CASE_LABELS };
