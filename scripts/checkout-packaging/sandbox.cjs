const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeJson } = require('./artifact.cjs');

async function verifyNativeProcesses(source, workspace, handler) {
  const probe = path.join(workspace.root, 'native-probe.mjs');
  await fs.copyFile(path.join(__dirname, 'native-probe.mjs'), probe);
  // HOME is scoped only to these child processes; the user's host HOME is unchanged.
  const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(workspace.root, 'child-home'), XDG_CONFIG_HOME: path.join(workspace.root, 'child-home', '.config'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
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

  async function run(candidate, label, args) {
    const child = spawnSync(candidate.command, [...candidate.prefix, ...args], { cwd: workspace.emitted, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
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
  await writeJson(path.join(workspace.root, 'network-isolation.json'), { attempts, selected: selected?.name ?? null, unrestrictedFallback: false, childHome: env.HOME, credentialEnvironmentInherited: false });
  assert(selected, 'OS denial not established; no handler was imported');
  const cases = [];
  for (const [label, method] of [['cold-get', 'GET'], ['cold-post', 'POST'], ['cold-options', 'OPTIONS'], ['restarted-post', 'POST']]) cases.push(await run(selected, label, ['invoke', workspace.emitted, handler, method]));
  return { backend: selected.name, networkCanaries: attempts, cases, eachInvocationHasFreshProcess: true, nativeLoader: true, graphMocks: false, apiReplacements: false, credentialsInherited: false, childHome: env.HOME };
}

module.exports = { verifyNativeProcesses };
