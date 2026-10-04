'use strict';
// Synthetic transport records exercise the real gate, never claim provider evidence.
const test = require('node:test');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { assert, fs, path, sha, read, write, identity, policy, components, trusted, scopes, audits } = require('./common.cjs');
const { pages, validateArtifact, artifact } = require('./github.cjs');
const { validateRun, validateCheckout, validateJobs, validatePair } = require('./results.cjs');
const { reviewEvidence, publicationCheck } = require('./publication.cjs');
const root = path.resolve(__dirname, '../..'), role = fs.existsSync(path.join(root, 'functions/package-lock.json')) ? 'frontend' : 'admin';
const expected = read(path.join(__dirname, 'jobs.json'));
const target = identity(root), attempt = 3, runId = 123;
const binding = { repository: policy.audited[role].repository, event: 'push', ref: `refs/heads/${policy.branch}`,
  runId, attempt, head: target.head, checkout: target.head, tree: target.tree, workflowSha256: sha(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'))), job: 'security' };
const clone = value => structuredClone(value);
function run() { return { id: runId, repository: { full_name: binding.repository }, path: '.github/workflows/ci.yml', head_sha: target.head,
  head_branch: policy.branch, event: 'push', run_attempt: attempt, status: 'completed', conclusion: 'failure' }; }
function input(clean = false) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutter-release-gate-'));
  const originals = read(path.join(root, 'scripts/braces-remediation/fixtures/all.json'));
  for (const { directory, scope } of scopes(role)) {
    const folder = path.join(temp, `native-audit-${directory}-${scope}-${attempt}`); fs.mkdirSync(folder);
    const raw = clean || directory === 'functions' ? { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } } : clone(originals);
    const bytes = JSON.stringify(raw); fs.writeFileSync(path.join(folder, `${scope}.json`), bytes);
    fs.writeFileSync(path.join(folder, `${scope}.stderr.log`), '');
    const lock = path.join(root, directory === 'functions' ? 'functions' : '', 'package-lock.json');
    write(path.join(folder, `${scope}.receipt.json`), { scope, command: ['npm', 'audit', ...(scope === 'prod' ? ['--omit=dev', '--audit-level=moderate'] : ['--audit-level=high']), '--json'], exitCode: Object.keys(raw.vulnerabilities).length ? 1 : 0, signal: null, rawSha256: sha(bytes), lockSha256: sha(fs.readFileSync(lock)) });
    write(path.join(folder, 'context.json'), { context: binding, scope, directory, receiptSha256: sha(fs.readFileSync(path.join(folder, `${scope}.receipt.json`))), stderrSha256: sha('') });
  }
  return temp;
}
function withInput(clean, callback) { const temp = input(clean); try { callback(temp); } finally { fs.rmSync(temp, { recursive: true }); } }
function jobs(native) {
  return Object.entries(expected).map(([name, def], index) => {
    const fail = def.audit && native.find(n => n.directory === def.audit.directory && n.scope === def.audit.scope).nativeAuditExit === 1;
    return { id: index + 1, name, run_id: runId, run_attempt: attempt, status: 'completed', conclusion: fail ? 'failure' : 'success',
      steps: def.steps.map((name, index) => ({ name, number: index + 1, status: 'completed', conclusion: fail && name === 'Native required dependency audit' ? 'failure' : 'success' })) };
  });
}
test('real installed audited bytes and transitive graphs explain only native exits; raw red retained', () => {
  trusted(root, role);
  withInput(false, temp => {
    const result = audits(root, role, temp, binding);
    assert(result.some(r => r.SECURITY_DISPOSITION === 'VERIFIED_SOURCE_REMEDIATION' && r.NPM_AUDIT_RAW_STATUS === 'FAIL'));
    validateJobs(jobs(result), expected, result, run());
  });
});
test('clean native graphs still require full functional job and step coverage', () => withInput(true, temp => {
  const result = audits(root, role, temp, binding), r = run(); r.conclusion = 'success';
  validateJobs(jobs(result), expected, result, r);
  const broken = jobs(result); broken[0].steps.pop(); assert.throws(() => validateJobs(broken, expected, result, r));
}));
for (const field of ['runId', 'attempt', 'head', 'checkout', 'tree', 'repository', 'event', 'ref', 'workflowSha256', 'job']) {
  test(`reject foreign ${field} even with same lock and exact known audit`, () => withInput(false, temp => {
    const { directory, scope } = scopes(role)[0], file = path.join(temp, `native-audit-${directory}-${scope}-${attempt}`, 'context.json');
    const value = read(file); value.context[field] = 'foreign'; fs.writeFileSync(file, JSON.stringify(value));
    assert.throws(() => audits(root, role, temp, binding));
  }));
}
for (const fault of ['missing', 'invalid', 'scope', 'signal', 'exit', 'stderr', 'advisory', 'transitive', 'graph']) {
  test(`reject audit ${fault}`, () => withInput(false, temp => {
    const { directory, scope } = scopes(role)[0], folder = path.join(temp, `native-audit-${directory}-${scope}-${attempt}`);
    const rawFile = path.join(folder, `${scope}.json`), receiptFile = path.join(folder, `${scope}.receipt.json`), contextFile = path.join(folder, 'context.json');
    const receipt = read(receiptFile), ctx = read(contextFile), data = read(rawFile);
    if (fault === 'missing') fs.unlinkSync(rawFile);
    else if (fault === 'invalid') fs.writeFileSync(rawFile, '{');
    else if (fault === 'scope') receipt.scope = 'other';
    else if (fault === 'signal') receipt.signal = 'SIGTERM';
    else if (fault === 'exit') receipt.exitCode = 2;
    else if (fault === 'stderr') fs.appendFileSync(path.join(folder, `${scope}.stderr.log`), 'network failure');
    else {
      if (fault === 'advisory') data.vulnerabilities.braces.via[0].url = 'https://github.com/advisories/GHSA-other';
      if (fault === 'transitive') data.vulnerabilities.micromatch.via.push({ name: 'micromatch', dependency: 'micromatch', url: 'https://github.com/advisories/GHSA-other', range: '*' });
      if (fault === 'graph') data.vulnerabilities.micromatch.via = ['micromatch'];
      fs.writeFileSync(rawFile, JSON.stringify(data));
    }
    if (fs.existsSync(rawFile)) receipt.rawSha256 = sha(fs.readFileSync(rawFile));
    fs.writeFileSync(receiptFile, JSON.stringify(receipt)); ctx.receiptSha256 = sha(fs.readFileSync(receiptFile)); fs.writeFileSync(contextFile, JSON.stringify(ctx));
    assert.throws(() => audits(root, role, temp, binding));
  }));
}
for (const conclusion of ['failure', 'skipped', 'cancelled', 'timed_out', null, 'in_progress']) {
  test(`reject functional or security installation step ${conclusion}`, () => withInput(false, temp => {
    const result = audits(root, role, temp, binding), functional = jobs(result);
    functional[0].steps[0].conclusion = conclusion; assert.throws(() => validateJobs(functional, expected, result, run()));
    const security = jobs(result); security.find(j => j.name.startsWith('Security')).steps[0].conclusion = conclusion;
    assert.throws(() => validateJobs(security, expected, result, run()));
  }));
}
for (const name of ['patch.json', 'manifest.json', 'control.cjs', 'evaluate.cjs', 'install.cjs']) {
  test(`immutable audit trust rejects changed ${name}`, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutter-release-components-'));
    try {
      for (const file of Object.keys(policy.audited[role].files)) { const dest = path.join(temp, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(root, file), dest); }
      fs.mkdirSync(path.join(temp, 'scripts/release-gate'), { recursive: true }); fs.copyFileSync(path.join(__dirname, 'policy.json'), path.join(temp, 'scripts/release-gate/policy.json'));
      components(temp, role); fs.appendFileSync(path.join(temp, 'scripts/braces-remediation', name), '\n'); assert.throws(() => components(temp, role));
    } finally { fs.rmSync(temp, { recursive: true }); }
  });
}
test('pagination exhausts all pages and rejects partial, duplicate or failed responses', () => {
  const data = Array.from({ length: 101 }, (_, id) => ({ id }));
  assert.equal(pages('test', 'jobs', url => ({ total_count: 101, jobs: url.endsWith('page=1') ? data.slice(0, 100) : data.slice(100) })).items.length, 101);
  assert.throws(() => pages('test', 'jobs', () => ({ total_count: 101, jobs: [] })));
  assert.throws(() => pages('test', 'jobs', () => ({ total_count: 2, jobs: [{ id: 1 }, { id: 1 }] })));
  assert.throws(() => pages('test', 'jobs', () => { throw new Error('network unavailable'); }));
});
test('artifact requires exact official digest, run, attempt window and unique name', () => {
  const r = { ...run(), run_started_at: '2026-10-04T10:00:00Z', updated_at: '2026-10-04T11:00:00Z' };
  const meta = { name: 'candidate-3', expired: false, digest: `sha256:${'a'.repeat(64)}`, created_at: '2026-10-04T10:30:00Z', workflow_run: { id: r.id, head_sha: r.head_sha } };
  validateArtifact(meta, r, meta.name, 'a'.repeat(64));
  for (const change of [{ digest: 'sha256:bad' }, { expired: true }, { name: 'candidate-2' }, { created_at: '2026-10-03T10:30:00Z' }, { workflow_run: { id: 999, head_sha: r.head_sha } }])
    assert.throws(() => validateArtifact({ ...meta, ...change }, r, meta.name, 'a'.repeat(64)));
  assert.throws(() => artifact([], 'candidate-3'));
});
test('run and PR checkout identity cannot substitute a merge for branch head', () => {
  const r = run(); validateRun(r, role, target.head, attempt);
  const head = { sha: target.head, commit: { tree: { sha: target.tree } } };
  validateCheckout(binding, r, head, head, binding.workflowSha256);
  assert.throws(() => validateRun({ ...r, run_attempt: 4 }, role, target.head, attempt));
  assert.throws(() => validateCheckout({ ...binding, checkout: 'a'.repeat(40) }, r, head, head, binding.workflowSha256));
  assert.throws(() => validateCheckout(binding, { ...r, event: 'pull_request' }, head, head, binding.workflowSha256));
});
test('manual PASS or historical source approval cannot authorize publication', async () => {
  assert.throws(() => reviewEvidence({ status: 'PASS_EXACT_TARGET' }, Buffer.from('PASS'), { RELEASE_TECHNICAL_GATE_STATUS: 'PASS' }));
  await assert.rejects(publicationCheck({}, { RELEASE_TECHNICAL_GATE_STATUS: 'PASS' }), /Independent review/);
});
test('pair requires exact Admin head and tree, literal pin and all six audits', () => {
  const admin = { target, results: [{}, {}] }, store = { paired: target, results: [{}, {}, {}, {}] };
  const workflow = `      WEB_INVENTORY_ADMIN_SHA: ${target.head}\n`;
  validatePair(store, admin, workflow);
  assert.throws(() => validatePair({ ...store, paired: { ...target, head: 'f'.repeat(40) } }, admin, workflow));
  assert.throws(() => validatePair({ ...store, paired: { ...target, tree: 'f'.repeat(40) } }, admin, workflow));
  assert.throws(() => validatePair(store, admin, '      WEB_INVENTORY_ADMIN_SHA: main\n'));
  assert.throws(() => validatePair({ ...store, results: [] }, admin, workflow));
});
test('versioned job inventory covers every workflow step without ignored jobs', () => {
  const text = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const names = [...text.matchAll(/^      - name: (.+)$/gm)].map(m => m[1]);
  const covered = new Set(Object.values(expected).flatMap(j => j.steps));
  for (const name of names) assert(covered.has(name), `Step missing from release policy: ${name}`);
  assert(!text.includes('continue-on-error:')); assert(!text.includes('pull_request_target:'));
});
for (const fault of ['extra copy', 'unpatched file', 'wrong version', 'missing copy']) {
  test(`gate installation boundary rejects ${fault}`, () => {
    // A reduced package fixture tests inspect's real copy/byte boundary; it is
    // not used as proof that npm installed the complete application graph.
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutter-release-installation-'));
    try {
      for (const file of Object.keys(policy.audited[role].files)) { const dest = path.join(temp, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(root, file), dest); }
      fs.mkdirSync(path.join(temp, 'scripts/release-gate'), { recursive: true }); fs.copyFileSync(path.join(__dirname, 'policy.json'), path.join(temp, 'scripts/release-gate/policy.json'));
      for (const pkg of ['braces', 'micromatch']) fs.cpSync(path.join(root, 'node_modules', pkg), path.join(temp, 'node_modules', pkg), { recursive: true });
      trusted(temp, role);
      if (fault === 'extra copy') fs.cpSync(path.join(temp, 'node_modules/braces'), path.join(temp, 'node_modules/micromatch/node_modules/braces'), { recursive: true });
      if (fault === 'unpatched file') fs.appendFileSync(path.join(temp, 'node_modules/braces/lib/parse.js'), '\n');
      if (fault === 'wrong version') { const file = path.join(temp, 'node_modules/braces/package.json'); const pkg = read(file); pkg.version = '3.0.4'; fs.writeFileSync(file, JSON.stringify(pkg)); }
      if (fault === 'missing copy') fs.rmSync(path.join(temp, 'node_modules/braces'), { recursive: true });
      assert.throws(() => trusted(temp, role));
    } finally { fs.rmSync(temp, { recursive: true }); }
  });
}
test('archive extractor rejects traversal, links, unsupported types and corrupted content', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutter-release-archive-'));
  try {
    const generate = spawnSync('python3', ['-c', `import zipfile,sys,tarfile,io\nfrom pathlib import Path\np=Path(sys.argv[1])\nfor name,entry in [('good','receipt.json'),('traversal','../escape')]:\n with zipfile.ZipFile(p/(name+'.zip'),'w') as z:z.writestr(entry,'{}')\nwith zipfile.ZipFile(p/'link.zip','w') as z:\n i=zipfile.ZipInfo('link');i.external_attr=0o120777<<16;z.writestr(i,'outside')\nwith tarfile.open(p/'link.tar.gz','w:gz') as t:\n i=tarfile.TarInfo('link');i.type=tarfile.SYMTYPE;i.linkname='../outside';t.addfile(i)\n(p/'corrupt.zip').write_bytes(b'not a zip')`, temp], { encoding: 'utf8' });
    assert.equal(generate.status, 0, generate.stderr);
    for (const name of ['good', 'traversal', 'link', 'corrupt']) {
      const result = spawnSync('python3', [path.join(__dirname, 'archive.py'), 'zip', path.join(temp, name + '.zip'), path.join(temp, name)], { encoding: 'utf8' });
      assert.equal(result.status === 0, name === 'good');
    }
    assert.notEqual(spawnSync('python3', [path.join(__dirname, 'archive.py'), 'tar', path.join(temp, 'link.tar.gz'), path.join(temp, 'tar-output')]).status, 0);
  } finally { fs.rmSync(temp, { recursive: true }); }
});
