import { request } from 'node:http';

const MAX_EVENT_BYTES = 6 * 1024 * 1024;
const fixedError = { errorType: 'Runtime.AccessFailure',
  errorMessage: 'Access runtime could not complete the invocation.', stackTrace: [] };

function endpoint(value) {
  const url = new URL('http://' + value);
  if (!['127.0.0.1', '[::1]', '169.254.170.2'].includes(url.hostname)
    || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('INVALID_RUNTIME_API_ENDPOINT');
  }
  return url;
}

async function exchange(base, method, path, body, extraHeaders = {}, timeoutMs = 0) {
  const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const call = request(new URL('/2018-06-01/runtime/' + path, base), { method,
      headers: { ...extraHeaders, ...(bytes ? { 'content-type': 'application/json',
        'content-length': bytes.length } : {}) } }, incoming => {
      let size = 0;
      const chunks = [];
      incoming.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_EVENT_BYTES) incoming.destroy(new Error('RUNTIME_RESPONSE_TOO_LARGE'));
        else chunks.push(chunk);
      });
      incoming.once('error', reject);
      incoming.once('end', () => {
        if (!incoming.complete) { reject(new Error('INCOMPLETE_RUNTIME_RESPONSE')); return; }
        resolve({ status: incoming.statusCode, headers: incoming.headers, body: Buffer.concat(chunks) });
      });
    });
    call.once('error', reject);
    if (timeoutMs) call.setTimeout(timeoutMs, () => call.destroy(new Error('RUNTIME_RESPONSE_TIMEOUT')));
    call.end(bytes);
  });
}

async function report(base, path, value, headers = {}) {
  const reply = await exchange(base, 'POST', path, value, headers, 30000);
  if (reply.status !== 202) throw new Error('RUNTIME_RESPONSE_NOT_ACCEPTED');
}

export async function runRuntime(loadHandler) {
  const base = endpoint(process.env.AWS_LAMBDA_RUNTIME_API);
  let invoke;
  try { invoke = await loadHandler(); } catch {
    await report(base, 'init/error', fixedError, { 'lambda-runtime-function-error-type': fixedError.errorType });
    throw new Error('ACCESS_INITIALIZATION_FAILED');
  }
  for (;;) {
    // AWS explicitly requires an unbounded long poll; no application retry.
    const next = await exchange(base, 'GET', 'invocation/next');
    const id = next.headers['lambda-runtime-aws-request-id'];
    if (next.status !== 200 || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new Error('INVALID_INVOCATION');
    }
    const headers = {};
    const invocationId = next.headers['lambda-runtime-invocation-id'];
    if (typeof invocationId === 'string') headers['lambda-runtime-invocation-id'] = invocationId;
    const trace = next.headers['lambda-runtime-trace-id'];
    if (typeof trace === 'string') process.env._X_AMZN_TRACE_ID = trace;
    else delete process.env._X_AMZN_TRACE_ID;
    let value, kind;
    try {
      const deadline = Number(next.headers['lambda-runtime-deadline-ms']);
      if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error('INVOCATION_EXPIRED');
      value = await invoke(JSON.parse(next.body.toString('utf8'))); kind = 'response';
    } catch {
      value = fixedError; kind = 'error';
      headers['lambda-runtime-function-error-type'] = fixedError.errorType;
    }
    // Outside the handler catch: an uncertain response must never be resent as an error.
    await report(base, 'invocation/' + id + '/' + kind, value, headers);
  }
}
