const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { workerMain } = require('./bounded.cjs');

const dispositions = {
  'multipart-field-cr': 'form-data; name="sample\rinjected"',
  'multipart-field-lf': 'form-data; name="sample\ninjected"',
  'multipart-file-cr': 'form-data; name="sample"; filename="asset\rinjected.txt"',
  'multipart-file-lf': 'form-data; name="sample"; filename="asset\ninjected.txt"',
  'multipart-field-encoded-cr': "form-data; name*=utf-8''sample%0Dinjected",
  'multipart-field-encoded-lf': "form-data; name*=utf-8''sample%0Ainjected",
  'multipart-file-encoded-cr': "form-data; name=sample; filename*=utf-8''asset%0Dinjected.txt",
  'multipart-file-encoded-lf': "form-data; name=sample; filename*=utf-8''asset%0Ainjected.txt",
};

workerMain(async (root, scenario) => {
  const local = createRequire(path.join(root, 'package.json'));
  const adminEntry = local.resolve('firebase-admin');
  const admin = createRequire(adminEntry);
  const Busboy = admin('@fastify/busboy');
  const boundary = 'synthetic-safe-boundary';
  const disposition = scenario === 'multipart-valid-file'
    ? 'form-data; name="sample"; filename="asset.txt"' : dispositions[scenario];
  assert.equal(typeof disposition, 'string');
  const body = Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\nContent-Type: text/plain\r\n\r\nvalue\r\n--${boundary}--\r\n`);
  const parser = new Busboy({ headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
  const fields = [];
  const files = [];
  parser.on('field', (name, value) => fields.push({ name, value }));
  parser.on('file', (name, stream, filename) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => files.push({ name, filename, data: Buffer.concat(chunks).toString() }));
  });
  const finished = new Promise((resolve, reject) => {
    parser.once('finish', resolve);
    parser.once('error', reject);
  });
  parser.end(body);
  await finished;
  assert.deepEqual(fields, []);
  assert.deepEqual(files, scenario === 'multipart-valid-file'
    ? [{ name: 'sample', filename: 'asset.txt', data: 'value' }] : []);
  return { consumer: adminEntry, dependency: admin.resolve('@fastify/busboy'),
    inputBytes: body.length, fields: fields.length, files: files.length };
});
