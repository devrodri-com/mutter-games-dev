import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { requireValue } from './policy.mjs';

/** Hashes establish local integrity only. They are not provider signatures. */
export async function verifyEvidenceFiles(input, evidenceRoot) {
  const root = await realpath(evidenceRoot);
  const references = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if ('source' in value && 'sha256' in value) references.push(value);
    for (const child of Object.values(value)) walk(child);
  }
  walk(input);
  requireValue(references.length > 0 && input.metadataEvidence, 'evidence file references missing');
  const verified = new Map();
  for (const reference of references) {
    requireValue(typeof reference.source === 'string' && !isAbsolute(reference.source)
      && !reference.source.split(/[\\/]/).includes('..') && /^[a-f0-9]{64}$/.test(reference.sha256), 'invalid evidence reference');
    const path = await realpath(resolve(root, reference.source));
    const local = relative(root, path);
    requireValue(local !== '' && !local.startsWith('..') && !isAbsolute(local), 'evidence symlink escapes package');
    const bytes = await readFile(path);
    requireValue(createHash('sha256').update(bytes).digest('hex') === reference.sha256, `evidence hash mismatch: ${reference.source}`);
    verified.set(reference.source, bytes);
  }
  const metadata = JSON.parse(verified.get(input.metadataEvidence.source).toString('utf8'));
  requireValue(metadata.readOnly === true && metadata.applicationRequests === 0
    && JSON.stringify(metadata.snapshots) === JSON.stringify(input.snapshots), 'effective metadata not bound to input');
  requireValue(Array.isArray(metadata.ledger) && input.snapshots.every(snapshot => metadata.ledger.some(row =>
    row.exitCode === 0 && Array.isArray(row.command) && row.command.includes('GET')
    && row.command.some(part => typeof part === 'string' && part.startsWith(`/v11/deployments/${snapshot.deployment.id}/builds?`)))),
  'per-function GET provenance missing');
  return { status: 'LOCAL_EVIDENCE_INTEGRITY_VERIFIED', fileCount: verified.size, remoteDrainVerified: false };
}
