const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { workerMain } = require('./bounded.cjs');

workerMain(async (root, scenario) => {
  const local = createRequire(path.join(root, 'package.json'));
  const mcp = scenario.startsWith('mcp-');
  const parentEntry = mcp ? local.resolve('@modelcontextprotocol/sdk/server/express.js')
    : local.resolve('express');
  const parent = createRequire(parentEntry);
  const expressEntry = mcp ? parent.resolve('express') : parentEntry;
  const express = createRequire(expressEntry);
  const proxyaddr = express('proxy-addr');
  const subnet = scenario.endsWith('short-mapped') ? '::ffff:10.0.0.0/8'
    : scenario.endsWith('zero-ipv6') ? '::/1'
      : scenario.endsWith('valid-mapped') ? '::ffff:127.0.0.0/104' : 'loopback';
  const trust = proxyaddr.compile(subnet);
  if (scenario.endsWith('short-mapped') || scenario.endsWith('zero-ipv6')) {
    assert.equal(trust('203.0.113.7'), false);
    assert.equal(trust('127.0.0.1'), false);
  } else {
    assert.equal(trust('127.0.0.1'), true);
    assert.equal(trust('203.0.113.7'), false);
  }
  const app = mcp ? parent(parentEntry).createMcpExpressApp({ host: '127.0.0.1' })
    : local(expressEntry)();
  app.set('trust proxy', subnet);
  // The admission decision reads Express's real req.ip, never the raw header.
  app.get('/synthetic', (req, res) => res.status(req.ip === '198.51.100.4' ? 200 : 403)
    .json({ ip: req.ip, ips: req.ips }));
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const result = await new Promise((resolve, reject) => {
      const request = http.get({ hostname: '127.0.0.1', port: server.address().port,
        path: '/synthetic', headers: { 'x-forwarded-for': '198.51.100.4' } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.once('end', () => resolve({ status: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString()) }));
        response.once('error', reject);
      });
      request.once('error', reject);
    });
    const trusted = scenario.endsWith('valid-mapped') || scenario.endsWith('valid-loopback');
    assert.deepEqual(result, trusted
      ? { status: 200, body: { ip: '198.51.100.4', ips: ['198.51.100.4'] } }
      : { status: 403, body: { ip: '127.0.0.1', ips: [] } });
    return { consumer: parentEntry, express: expressEntry,
      dependency: express.resolve('proxy-addr'), subnet, result };
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
