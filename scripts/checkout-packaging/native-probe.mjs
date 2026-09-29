import assert from 'node:assert/strict';
import { createHook } from 'node:async_hooks';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { createRequire } from 'node:module';
import { readFile, realpath, readlink } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';

const [mode, ...args] = process.argv.slice(2);
assert.equal(process.versions.node.split('.')[0], '22');
assert(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Do not inherit loaders or module aliases');
const network = {};
const count = key => { network[key] = (network[key] ?? 0) + 1; };
const channels = ['net.client.socket', 'http.client.request.created', 'http.client.request.start', 'undici:request:create', 'undici:client:beforeConnect'];
const listeners = channels.map(name => [name, () => count(name)]);
for (const [name, callback] of listeners) subscribe(name, callback);
const ioTypes = new Set(['GETADDRINFOREQWRAP', 'GETNAMEINFOREQWRAP', 'QUERYWRAP', 'TCPCONNECTWRAP', 'PIPECONNECTWRAP', 'UDPSENDWRAP']);
const hook = createHook({ init(_id, type) { if (ioTypes.has(type)) count(type); } });
hook.enable();
const result = { mode, node: process.version, network, passed: false };

try {
  if (mode === 'canary') {
    if (process.platform === 'linux') {
      const parentNamespace = args[0];
      const currentNamespace = await readlink('/proc/self/ns/net');
      assert(parentNamespace && currentNamespace !== parentNamespace, 'No isolated Linux network namespace');
      assert(Object.values(networkInterfaces()).flat().every(entry => entry.internal), 'Namespace has an external interface');
      result.networkNamespaceIsolated = true;
    } else assert.equal(process.platform, 'darwin');
    // Only inside the selected OS restriction: literal TEST-NET-1, no DNS or
    // provider. A caught denial must remain observable to the passive monitor.
    const errorCode = await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '192.0.2.1', port: 9 });
      socket.setTimeout(1500, () => { socket.destroy(); reject(new Error('Canary was not immediately denied')); });
      socket.once('connect', () => { socket.destroy(); reject(new Error('Canary unexpectedly connected')); });
      socket.once('error', error => { socket.destroy(); resolve(error.code); });
    });
    const denied = process.platform === 'darwin' ? ['EPERM', 'EACCES'] : ['ENETUNREACH', 'EHOSTUNREACH', 'EPERM', 'EACCES'];
    assert(denied.includes(errorCode), `OS denial not demonstrated: ${errorCode}`);
    assert(Object.values(network).reduce((sum, value) => sum + value, 0) > 0, 'Caught attempt escaped observation');
    result.denialCode = errorCode;
    result.passed = true;
  } else {
    assert.equal(mode, 'invoke');
    const [artifactDirectory, handlerName, method, functionKind, credentials] = args;
    assert(['GET', 'POST', 'OPTIONS'].includes(method));
    assert(['checkout', 'reconcile'].includes(functionKind));
    const requestHeaders = {};
    if (functionKind === 'reconcile') {
      assert(['missing-secret', 'empty-secret', 'missing-header', 'wrong-secret'].includes(credentials));
      // These are local-only fixtures, not credentials read from any account.
      if (credentials === 'empty-secret') process.env.CRON_SECRET = '';
      else if (credentials !== 'missing-secret') process.env.CRON_SECRET = 'synthetic-packaging-secret-not-valid-remotely';
      if (credentials === 'empty-secret') requestHeaders.authorization = 'Bearer ';
      else if (credentials === 'missing-secret') requestHeaders.authorization = 'Bearer undefined';
      else if (credentials !== 'missing-header') requestHeaders.authorization = 'Bearer synthetic-wrong-value';
    }
    const artifact = await realpath(artifactDirectory);
    const handlerPath = await realpath(path.join(artifact, handlerName));
    assert(handlerPath.startsWith(`${artifact}${path.sep}`));
    const metadata = JSON.parse(await readFile(path.join(artifact, 'package.json'), 'utf8'));
    assert.equal(metadata.type, 'module');
    const loaded = await import(pathToFileURL(handlerPath).href);
    assert.equal(typeof loaded.default, 'function', 'Emitted module must export the real handler');
    const headers = new Map(); let status; let body; let jsonCalls = 0;
    const response = {
      setHeader(name, value) { headers.set(name.toLowerCase(), value); return response; },
      status(value) { status = value; return response; },
      json(value) { body = value; jsonCalls += 1; return response; },
    };
    await loaded.default({ method, headers: requestHeaders, body: {} }, response);
    assert.equal(status, functionKind === 'checkout' ? (method === 'POST' ? 401 : 405) : (method === 'GET' ? 401 : 405));
    assert.equal(headers.get('cache-control'), 'no-store');
    assert.equal(jsonCalls, 1);
    if (functionKind === 'checkout') assert.deepEqual(body, { error: method === 'POST' ? 'Iniciá sesión para continuar.' : 'Method not allowed' });
    else assert.deepEqual(body, { error: method === 'GET' ? 'Unauthorized' : 'Method not allowed' });
    const require = createRequire(import.meta.url);
    const resolvedDependencies = Object.keys(require.cache);
    assert(resolvedDependencies.every(file => file.startsWith(`${artifact}${path.sep}`)), 'Runtime dependency resolved outside materialized artifact');
    result.functionKind = functionKind; result.credentials = credentials ?? 'absent';
    result.method = method; result.status = status; result.cacheControl = headers.get('cache-control');
    result.resolvedCommonJsFiles = resolvedDependencies.length;
    result.passed = true;
  }
} catch (error) {
  result.failure = { code: error.code ?? null, name: error.name, message: error.message };
  process.exitCode = 1;
}

// No forced successful exit: delayed I/O stays observable. Lingering handles
// cause the parent timeout to fail, rather than hiding a scheduled request.
process.once('beforeExit', () => {
  if (mode === 'invoke' && Object.values(network).some(value => value > 0)) {
    result.passed = false;
    result.failure = { code: 'UNEXPECTED_NETWORK_ATTEMPT', message: 'Passive observation detected I/O even if its error was caught' };
    process.exitCode = 1;
  }
  hook.disable();
  for (const [name, callback] of listeners) unsubscribe(name, callback);
  console.log(JSON.stringify(result));
});
