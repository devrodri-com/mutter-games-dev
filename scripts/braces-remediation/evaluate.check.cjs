'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { evaluate } = require('./evaluate.cjs');
const { sha } = require('./control.cjs');
const root = path.resolve(__dirname, '../..');
test('native advisory graph is classified without waiving raw red; malformed/unknown/disconnected graphs fail closed', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutter-braces-audit-'));
  const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/all.json')));
  const receipt = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/all.receipt.json')));
  function write(audit, extra = {}) {
    const bytes = JSON.stringify(audit);
    fs.writeFileSync(path.join(temp, 'all.json'), bytes);
    fs.writeFileSync(path.join(temp, 'all.receipt.json'), JSON.stringify({ ...receipt, rawSha256: sha(bytes), ...extra }));
  }
  try {
    write(original); const classified = evaluate(root, temp, 'all');
    assert.equal(classified.NPM_AUDIT_RAW_STATUS, 'FAIL'); assert.equal(classified.RELEASE_ELIGIBLE, 'NO');
    for (const mutate of [
      a => { a.vulnerabilities.braces.via[0].url = 'https://github.com/advisories/GHSA-unknown'; },
      a => { a.vulnerabilities.braces.via[0].range = '*'; },
      a => { a.vulnerabilities.micromatch.via = ['absent']; },
      a => { a.vulnerabilities.braces.nodes.push('node_modules/extra/braces'); },
      a => { a.error = { code: 'EAUDIT' }; },
      a => { a.metadata.vulnerabilities.total = 0; },
      a => { a.vulnerabilities.micromatch.via = ['micromatch']; },
      a => { a.auditReportVersion = 99; },
    ]) { const changed = structuredClone(original); mutate(changed); write(changed); assert.throws(() => evaluate(root, temp, 'all')); }
    for (const changed of [{ exitCode: 0 }, { signal: 'SIGTERM' }, { lockSha256: 'drift' }, { rawSha256: 'drift' }]) {
      write(original, changed); assert.throws(() => evaluate(root, temp, 'all'));
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
