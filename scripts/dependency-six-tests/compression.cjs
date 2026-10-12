const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { workerMain } = require('./bounded.cjs');

workerMain(async (root, scenario) => {
  assert.ok(['superstatic-gzip', 'superstatic-premature-close'].includes(scenario));
  const local = createRequire(path.join(root, 'package.json'));
  const tools = createRequire(local.resolve('firebase-tools'));
  const consumerEntry = tools.resolve('superstatic');
  const consumer = createRequire(consumerEntry);
  const streams = [];
  const descriptor = Object.getOwnPropertyDescriptor(zlib, 'createGzip');
  // Observe the real native compressor; retain its behavior and return value.
  Object.defineProperty(zlib, 'createGzip', { ...descriptor, value(...args) {
    const stream = descriptor.value.apply(zlib, args);
    streams.push(stream);
    return stream;
  } });
  const fixture = process.argv[4];
  assert.equal(path.dirname(fixture), path.join(root, 'scripts/dependency-six-tests'));
  assert.ok(path.basename(fixture).startsWith('.fixture-'));
  let server;
  try {
    const input = scenario === 'superstatic-gzip'
      ? Buffer.from('/* synthetic css */\n.synthetic { color: red; }\n'.repeat(200))
      : crypto.randomBytes(2 * 1024 * 1024);
    fs.writeFileSync(path.join(fixture, 'asset.css'), input, { mode: 0o600 });
    const superstatic = tools('superstatic').default;
    const middleware = superstatic({ cwd: fixture, config: { public: '.' }, compression: true, fallthrough: false });
    let closedResponse;
    const closed = new Promise(resolve => {
      server = http.createServer((req, res) => {
        res.once('close', () => setImmediate(() => { closedResponse = res; resolve(); }));
        middleware(req, res, error => {
          res.statusCode = error ? 500 : 404;
          res.end(error ? error.message : 'missing synthetic asset');
        });
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const result = await new Promise((resolve, reject) => {
      const request = http.get({ hostname: '127.0.0.1', port: server.address().port,
        path: '/asset.css', headers: { 'accept-encoding': 'gzip' } }, response => {
        const metadata = { status: response.statusCode, encoding: response.headers['content-encoding'] };
        if (scenario === 'superstatic-premature-close') {
          let requestedAbort = false;
          response.once('data', () => {
            requestedAbort = true;
            response.destroy();
            resolve({ ...metadata, aborted: true });
          });
          response.once('error', error => {
            if (!requestedAbort || error.code !== 'ECONNRESET') reject(error);
          });
        } else {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.once('end', () => resolve({ ...metadata, bytes: Buffer.concat(chunks) }));
          response.once('error', reject);
        }
      });
      request.once('error', reject);
    });
    await closed;
    assert.equal(result.status, 200);
    assert.equal(result.encoding, 'gzip');
    assert.equal(streams.length, 1, 'superstatic must create the actual gzip stream');
    if (scenario === 'superstatic-gzip') assert.deepEqual(zlib.gunzipSync(result.bytes), input);
    else {
      assert.equal(result.aborted, true);
      assert.equal(closedResponse.writableFinished, false, 'response must close before completion');
      assert.equal(streams[0].destroyed, true, 'premature close must release the native compressor');
      assert.equal(streams[0]._handle, null, 'the actual native zlib handle must be released');
    }
    return { consumer: consumerEntry, dependency: consumer.resolve('compression'),
      inputBytes: input.length, gzipStreams: streams.length, destroyed: streams[0].destroyed };
  } finally {
    if (server?.listening) await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    Object.defineProperty(zlib, 'createGzip', descriptor);
    fs.rmSync(fixture, { recursive: true });
  }
});
