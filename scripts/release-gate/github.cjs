'use strict';
// Read-only management boundary. No token is passed to a build process.
const { execFileSync, spawnSync } = require('node:child_process');
const { assert, fs, path, sha, write } = require('./common.cjs');
function request(endpoint) {
  assert(/^repos\/devrodri-com\/mutter-games-(?:dev|admin-api)\//.test(endpoint));
  return JSON.parse(execFileSync('gh', ['api', '--method', 'GET', endpoint], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}
function pages(endpoint, field, get = request) {
  const items = [], records = []; let total;
  for (let page = 1; page <= 100; page++) {
    const data = get(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    assert(Number.isSafeInteger(data.total_count) && data.total_count >= 0 && Array.isArray(data[field]), 'Invalid pagination response');
    if (total === undefined) total = data.total_count;
    assert.equal(data.total_count, total, 'Pagination changed during read');
    records.push(data); items.push(...data[field]);
    assert.equal(new Set(items.map(x => x.id)).size, items.length, 'Duplicate paginated item');
    assert(items.length <= total);
    if (items.length === total) return { items, records };
    assert.equal(data[field].length, 100, 'Incomplete pagination');
  }
  throw new Error('Pagination not exhausted');
}
function validateArtifact(meta, run, name, digest) {
  assert.equal(meta.name, name); assert.equal(meta.expired, false);
  assert.equal(meta.workflow_run?.id, run.id); assert.equal(meta.workflow_run?.head_sha, run.head_sha);
  assert.equal(meta.digest, `sha256:${digest}`, 'Official artifact digest mismatch');
  const created = Date.parse(meta.created_at), start = Date.parse(run.run_started_at), end = Date.parse(run.updated_at);
  assert(Number.isFinite(created) && created >= start && created <= end, 'Artifact outside run attempt');
}
function download(meta, run, name, output) {
  fs.mkdirSync(output, { recursive: false });
  const zip = path.join(output, 'artifact.zip'), fd = fs.openSync(zip, 'wx');
  let result;
  try { result = spawnSync('gh', ['api', '--method', 'GET', `repos/${run.repository.full_name}/actions/artifacts/${meta.id}/zip`], { stdio: ['ignore', fd, 'pipe'], timeout: 120000 }); }
  finally { fs.closeSync(fd); }
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Artifact download failed'); assert.equal(result.signal, null);
  const stat = fs.statSync(zip); assert(stat.size > 0 && stat.size < 512 * 1024 * 1024, 'Archive size outside bound');
  validateArtifact(meta, run, name, sha(fs.readFileSync(zip)));
  write(path.join(output, 'metadata.json'), meta);
  execFileSync('python3', [path.join(__dirname, 'archive.py'), 'zip', zip, path.join(output, 'files')], { stdio: 'pipe' });
  return path.join(output, 'files');
}
function artifact(items, name) {
  const found = items.filter(a => a.name === name); assert.equal(found.length, 1, `Missing/duplicate artifact: ${name}`); return found[0];
}
module.exports = { request, pages, validateArtifact, download, artifact };
