'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { inspect, sha } = require('./control.cjs');
const manifest = require('./manifest.json');

function evaluate(directory, auditDirectory, scope) {
  const root = fs.realpathSync(directory);
  const installed = inspect(root);
  const raw = fs.readFileSync(path.join(auditDirectory, `${scope}.json`));
  const receipt = JSON.parse(fs.readFileSync(path.join(auditDirectory, `${scope}.receipt.json`)));
  assert.equal(receipt.rawSha256, sha(raw));
  assert.equal(receipt.lockSha256, sha(fs.readFileSync(path.join(root, 'package-lock.json'))));
  assert.equal(receipt.scope, scope); assert.equal(receipt.signal, null);
  assert.deepEqual(receipt.command, ['npm', 'audit', ...(scope === 'prod' ? ['--omit=dev', '--audit-level=moderate'] : ['--audit-level=high']), '--json']);
  const audit = JSON.parse(raw);
  assert.equal(audit.auditReportVersion, 2);
  assert(!audit.error && audit.vulnerabilities && audit.metadata?.vulnerabilities, 'Invalid native audit');
  const findings = Object.entries(audit.vulnerabilities);
  assert.equal(receipt.exitCode, findings.length ? 1 : 0, 'Unexpected native exit');
  assert.equal(audit.metadata.vulnerabilities.total, findings.length);
  const edges = [];
  for (const [name, finding] of findings) {
    assert.equal(finding.name, name);
    assert(Array.isArray(finding.nodes) && finding.nodes.length && Array.isArray(finding.via) && finding.via.length);
    for (const via of finding.via) {
      if (typeof via === 'object') {
        assert.equal(name, 'braces', 'A different direct advisory blocks');
        assert.equal(via.name, 'braces'); assert.equal(via.dependency, 'braces');
        assert.equal(via.url, `https://github.com/advisories/${manifest.advisory}`, 'Unreviewed advisory');
        assert.equal(via.range, '<=3.0.3');
        assert.deepEqual([...finding.nodes].sort(), installed.copies);
      } else {
        assert.equal(typeof via, 'string'); assert(audit.vulnerabilities[via], 'Missing advisory parent');
        for (const node of finding.nodes) {
          assert(!path.isAbsolute(node) && !node.split('/').includes('..'));
          const file = path.join(root, node, 'package.json');
          const metadata = JSON.parse(fs.readFileSync(file));
          assert.equal(metadata.name, name);
          assert(Object.hasOwn(metadata.dependencies || {}, via) || Object.hasOwn(metadata.peerDependencies || {}, via), 'Not an actual dependency edge');
          const resolved = createRequire(file).resolve(`${via}/package.json`);
          const target = path.relative(root, path.dirname(resolved)).split(path.sep).join('/');
          assert(audit.vulnerabilities[via].nodes.includes(target), 'Advisory edge resolves elsewhere');
          edges.push({ from: node, via, resolved: target });
        }
      }
    }
  }
  // Every transitive finding must reach this exact single advisory, even in a cyclic graph.
  for (const [name] of findings) {
    const queue = [name], seen = new Set(); let direct = false;
    while (queue.length) {
      const item = queue.pop(); if (seen.has(item)) continue; seen.add(item);
      for (const via of audit.vulnerabilities[item].via) {
        if (typeof via === 'string') queue.push(via); else direct = true;
      }
    }
    assert(direct, 'Unresolved advisory cycle');
  }
  return { scope, nativeAuditExit: receipt.exitCode, NPM_AUDIT_RAW_STATUS: receipt.exitCode ? 'FAIL' : 'PASS',
    LOCAL_SOURCE_BYTES: 'VERIFIED', advisory: findings.length ? manifest.advisory : null, installed, edges,
    INDEPENDENT_REMEDIATION_AUDIT: 'PENDING', RELEASE_ELIGIBLE: 'NO',
    limitation: 'This classification requires the separate compatibility/regression gates; it never overrides the native audit or authorizes release.' };
}
if (require.main === module) {
  const [root, auditDirectory, scope] = process.argv.slice(2);
  assert(process.argv.length === 5 && ['prod', 'all'].includes(scope));
  console.log(JSON.stringify(evaluate(root, auditDirectory, scope), null, 2));
}
module.exports = { evaluate };
