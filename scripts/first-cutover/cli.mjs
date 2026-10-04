import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { demand, canonical } from './common.mjs';
import { containmentProposal, legacyAllowProposal, verifyAllowBase, verifyAllowAfter } from './authority.mjs';
import { readPolicy, PROJECT_RESOURCE } from './iam-evidence.mjs';
import { loadBackup, privateDirectory } from './backup.mjs';
import { compare, proposeRepair } from './recovery.mjs';
import { localFirestore, restoreLocal } from './local-firestore.mjs';

const [command, first, second, third] = process.argv.slice(2);
try {
  const json = async path => JSON.parse(await readFile(path, 'utf8'));
  let result;
  if (command === 'propose-authority') {
    const supported = await json(first); result = containmentProposal(supported.permissions ?? supported);
  }
  else if (['propose-allow', 'verify-allow-base', 'verify-allow-after'].includes(command)) {
    const bundle = await json(first);
    const before = readPolicy(bundle.before, PROJECT_RESOURCE, bundle.context);
    const options = { requestedPolicyVersion: 3, responseComplete: true };
    if (command === 'propose-allow') result = { proposal: legacyAllowProposal(before, options), sourceReceipt: bundle.before };
    else {
      const fresh = readPolicy(bundle.fresh, PROJECT_RESOURCE, bundle.context);
      const proposal = legacyAllowProposal(before, options);
      demand(canonical(bundle.proposal) === canonical(proposal), 'proposal differs from source');
      const verified = command === 'verify-allow-base' ? verifyAllowBase(proposal, fresh, options) : verifyAllowAfter(proposal, before, fresh, options);
      result = { status: 'LOCAL_POLICY_CONSISTENCY_ONLY', verified, productionWrites: 0, providerAuthenticityRequiresIndependentReview: true };
    }
  }
  else if (command === 'evaluate') {
    demand(second && third, 'evaluate now requires <receipts.json> <publication-config.json> <new-evidence-dir>');
    const config = await json(second);
    demand(config.cutoverEvidenceFile === first, 'publication config must bind this cutover evidence');
    const { main } = await import('../release-gate/cli.cjs');
    result = await main(['publication-check', second, third]);
  } else if (command === 'verify-backup') {
    const { manifest } = await loadBackup(first);
    result = { status: 'PRIVATE_BACKUP_INTEGRITY_VERIFIED', documents: manifest.documents, atomic: false,
      stableAcrossPasses: manifest.stableAcrossPasses, productionWrites: 0 };
  } else if (command === 'restore-local') {
    const { documents } = await loadBackup(first);
    result = await restoreLocal(localFirestore(second), documents);
  } else if (command === 'compare' || command === 'propose-repair') {
    const base = await loadBackup(first); const current = await loadBackup(second);
    const directory = await privateDirectory(second);
    const output = command === 'compare' ? compare(base.documents, current.documents)
      : proposeRepair(base.documents, current.documents, await json(third));
    await writeFile(join(directory, `${command}.json`), JSON.stringify(output, null, 2), { mode: 0o600, flag: 'wx' });
    result = { status: 'PRIVATE_PROPOSAL_WRITTEN', productionWrites: 0 };
  } else throw new Error('Commands: propose-authority <supported-permissions.json>; propose-allow|verify-allow-base|verify-allow-after <bound-policy-sources.json>; evaluate <receipts.json> <publication-config.json> <new-evidence-dir>; verify-backup <private-dir>; restore-local <private-dir> <loopback-origin>; compare <backup> <readback>; propose-repair <backup> <readback> <incident.json>. No apply command exists.');
  demand(result, 'missing result'); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'BLOCKED: invalid input'); process.exitCode = 1;
}
