// Explicit test instrumentation. This rejects forbidden loads; it never
// supplies replacement module exports or patches installed dependencies.
const fs = require('node:fs');
const path = require('node:path');
const moduleApi = require('node:module');
const crypto = require('node:crypto');
const { threadId, isMainThread } = require('node:worker_threads');
const { digest, forbiddenLocation, localPath, canonical } = require('./observation-policy.cjs');
const { installProcessObservation } = require('./process-observation.cjs');

const configPath = process.env.MUTTER_EDGE_OBSERVATION_CONFIG;
if (!configPath) throw new Error('EDGE_OBSERVATION_NOT_VERIFIED: observation configuration missing');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (process.version !== config.node || typeof moduleApi.registerHooks !== 'function') {
  throw new Error('EDGE_OBSERVATION_NOT_VERIFIED: required native Node/hooks unavailable');
}
const scope = `${process.pid}-${threadId}-${crypto.randomUUID()}`;
const journal = path.join(config.evidenceDirectory, `events-${scope}.jsonl`);
const fd = fs.openSync(journal, 'wx', 0o600);
let sequence = 0;
let violations = 0;
let uncovered = 0;
const emit = (type, data = {}) => fs.writeSync(fd, `${JSON.stringify({ type, sequence: sequence++, scope, pid: process.pid, threadId, time: new Date().toISOString(), ...data })}\n`);
function reject(code, data) {
  if (code === 'NOT_VERIFIED') uncovered += 1;
  else violations += 1;
  emit(code === 'NOT_VERIFIED' ? 'uncovered' : 'violation', { code, ...data });
  const error = new Error(`EDGE_OBSERVATION_${code}: ${data.reason}`);
  error.code = `EDGE_OBSERVATION_${code}`;
  throw error;
}

emit('start', {
  token: process.env.MUTTER_EDGE_CHILD_TOKEN,
  parentScope: process.env.MUTTER_EDGE_PARENT_SCOPE || null,
  isMainThread, node: process.version, executable: canonical(process.execPath),
  cwd: process.cwd(), hook: 'node:module.registerHooks synchronous resolve/load',
  preloadSha256: digest(fs.readFileSync(__filename)),
});

const hashes = new Set(config.forbiddenFileHashes ?? []);
function inspectLocation(value, operation) {
  if (forbiddenLocation(value)) reject('FORBIDDEN_LOAD', { reason: 'prohibited Edge package or dev-server entrypoint', operation, location: value });
  const file = localPath(value);
  if (!file) return;
  let resolved;
  try { resolved = canonical(file); }
  catch (error) {
    // Leave ordinary missing-file error semantics to Node's real resolver.
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return;
    throw error;
  }
  if (forbiddenLocation(resolved)) reject('FORBIDDEN_LOAD', { reason: 'prohibited canonical module location', operation, location: value, canonical: resolved });
}

const hooks = moduleApi.registerHooks({
  resolve(specifier, context, nextResolve) {
    inspectLocation(specifier, 'resolve-request');
    const result = nextResolve(specifier, context);
    inspectLocation(result.url, 'resolve-result');
    emit('resolution', { specifier, parentURL: context.parentURL ?? null, url: result.url });
    return result;
  },
  load(url, context, nextLoad) {
    inspectLocation(url, 'load');
    const result = nextLoad(url, context);
    const file = localPath(url);
    let fileSha256 = null;
    let fileBytes = null;
    if (file) {
      const bytes = fs.readFileSync(file);
      fileSha256 = digest(bytes);
      fileBytes = bytes.length;
      if (hashes.has(fileSha256)) reject('FORBIDDEN_LOAD', { reason: 'identified embedded payload under any filename', operation: 'load-bytes', location: url, sha256: fileSha256 });
    }
    const supplied = result.source;
    const sourceSha256 = typeof supplied === 'string' || ArrayBuffer.isView(supplied) || supplied instanceof ArrayBuffer
      ? digest(typeof supplied === 'string' ? supplied : Buffer.from(supplied.buffer ?? supplied, supplied.byteOffset ?? 0, supplied.byteLength)) : null;
    emit('module', { url, format: result.format, fileSha256, fileBytes, sourceSha256 });
    return result;
  },
});

// A later custom loader could short-circuit these hooks or introduce its own
// loader thread. That is a new, unverified build surface, not an empty trace.
moduleApi.registerHooks = function rejectAdditionalSynchronousLoader() {
  reject('NOT_VERIFIED', { reason: 'additional module hooks would change observation coverage' });
};
moduleApi.register = function rejectAdditionalAsynchronousLoader() {
  reject('NOT_VERIFIED', { reason: 'additional asynchronous loader thread is not observed' });
};

installProcessObservation({ config, configPath, preload: __filename, scope, emit, reject });
moduleApi.syncBuiltinESMExports();
process.on('exit', code => {
  emit('exit', { code, violations, uncovered, hooksInstalled: typeof hooks.deregister === 'function' });
  fs.closeSync(fd);
});
