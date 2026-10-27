import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogEditRequest } from '../../api/catalog-edit.js';
import type { AccessResponse } from '../../api/_lib/credential-access-handler.js';

const directory = dirname(fileURLToPath(import.meta.url));
const entry = resolve(directory, process.env.MUTTER_TEST_PREVIOUS_EMITTED === '1'
  ? '../../../../payment-confirmation/package/.vercel/output/functions/api/access.func/runtime-entry.mjs'
  : '../../../package/.vercel/output/functions/api/access.func/runtime-entry.mjs');
type Waiting = { id: string; event: unknown; resolve: (value: unknown) => void; reject: (error: Error) => void };
let child: ChildProcess | undefined, waiting: Waiting | undefined, poll: ServerResponse | undefined;
const queued: Waiting[] = [];
let serial = 0, stopping = false, exited = false, bootResolve: (() => void) | undefined, bootReject: ((error: Error) => void) | undefined;
const errors: string[] = [];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function dispatch() {
  if (!poll || waiting || !queued.length) return;
  waiting = queued.shift(); assert(waiting);
  poll.writeHead(200, { 'content-type': 'application/json', 'lambda-runtime-aws-request-id': waiting.id,
    'lambda-runtime-deadline-ms': String(Date.now() + 30000) });
  poll.end(JSON.stringify(waiting.event)); poll = undefined;
}
const provider = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/2018-06-01/runtime/invocation/next') {
      if (stopping) { response.writeHead(204); response.end(); return; }
      assert.equal(poll, undefined); poll = response; bootResolve?.(); dispatch(); return;
    }
    assert.equal(request.method, 'POST');
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert(waiting, 'Unexpected runtime reply');
    assert.equal(request.url, `/2018-06-01/runtime/invocation/${waiting.id}/response`);
    const completed = waiting; waiting = undefined;
    response.writeHead(202); response.end(); completed.resolve(value);
  } catch (error) {
    const reason = error instanceof Error ? error : new Error('Provider fixture rejected runtime reply');
    errors.push(reason.message); waiting?.reject(reason); waiting = undefined;
    for (const queuedRequest of queued.splice(0)) queuedRequest.reject(reason);
    response.writeHead(500); response.end();
  }
});
export async function startRuntime(): Promise<void> {
  assert.equal(child, undefined);
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address(); assert(address && typeof address === 'object');
  const ready = new Promise<void>((resolve, reject) => { bootResolve = resolve; bootReject = reject; });
  // Preserve thin candidate imports exactly as the uploaded ordinary files resolve.
  child = spawn(process.execPath, ['--preserve-symlinks', '--import', resolve(directory, 'runtime-preload.mjs'), entry], {
    cwd: dirname(entry), env: { ...process.env, AWS_LAMBDA_RUNTIME_API: `127.0.0.1:${address.port}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => { errors.push('Unexpected runtime stdout'); });
  child.stderr?.on('data', data => {
    const text = String(data);
    if (!stopping && !text.includes('MetadataLookupWarning') && !text.includes('trace-warnings')) errors.push(text);
  });
  child.once('exit', code => { exited = true; if (!stopping) {
    errors.push(`Runtime stopped: ${code}`); bootReject?.(new Error('Runtime initialization failed'));
    waiting?.reject(new Error('Runtime stopped'));
    for (const queuedRequest of queued.splice(0)) queuedRequest.reject(new Error('Runtime stopped'));
  } });
  await ready;
}
export async function stopRuntime(): Promise<void> {
  assert.equal(waiting, undefined); assert.equal(queued.length, 0); stopping = true;
  const finished = exited ? Promise.resolve() : new Promise<void>(resolve => child?.once('exit', () => resolve()));
  if (poll) { poll.writeHead(204); poll.end(); poll = undefined; }
  await finished;
  provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
  assert.deepEqual(errors, []);
}
export default async function emittedHandler(request: CatalogEditRequest, response: AccessResponse): Promise<void> {
  const value = await new Promise<unknown>((resolve, reject) => {
    queued.push({ id: `synthetic-${++serial}`, resolve, reject, event: { body: JSON.stringify({
      method: request.method, path: request.url, headers: request.headers,
      body: typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {}), encoding: '',
    }) } }); dispatch();
  });
  assert(object(value)); assert.equal(typeof value.statusCode, 'number'); assert(object(value.headers));
  assert.equal(value.encoding, 'base64'); assert.equal(typeof value.body, 'string');
  for (const [name, items] of Object.entries(value.headers)) {
    assert(Array.isArray(items) && items.every(item => typeof item === 'string'));
    response.setHeader(name, items.join(', '));
  }
  response.status(Number(value.statusCode));
  response.json(JSON.parse(Buffer.from(String(value.body), 'base64').toString('utf8')));
}
