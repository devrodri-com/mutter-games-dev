import { readFile } from 'node:fs/promises';
import { closureProposal, verifyProposalBase, candidateSmokeProposal, reconciliationProposal } from './policy.mjs';
import { evaluateDrain } from './drain.mjs';
import { dirname } from 'node:path';
import { verifyEvidenceFiles } from './evidence.mjs';

const [command, file, project] = process.argv.slice(2);
try {
  if (!file || !['propose-closure', 'propose-candidate', 'propose-reconciling', 'verify-drain'].includes(command)) {
    throw new Error('Usage: node scripts/release-cutover/cli.mjs propose-closure <waf-snapshot.json> <store|admin|storeLegacy|adminLegacy> | propose-candidate <closed-waf.json> <candidate.json> | propose-reconciling <closed-waf.json> <phase.json> | verify-drain <evidence.json>');
  }
  const input = JSON.parse(await readFile(file, 'utf8'));
  if (command === 'verify-drain') {
    const integrity = await verifyEvidenceFiles(input, dirname(file));
    const timeline = evaluateDrain(input);
    console.log(JSON.stringify({ status: 'NOT_VERIFIED', integrity, timeline,
      reason: 'No provider-coverage adapter is available for complete runtime/admission/Firestore write observations. Operator counters are not attestation. Preserve and verify primary evidence before cutover.' }, null, 2));
    process.exitCode = 1;
  }
  else if (command === 'propose-candidate' || command === 'propose-reconciling') {
    const candidate = JSON.parse(await readFile(project, 'utf8'));
    console.log(JSON.stringify(command === 'propose-candidate' ? candidateSmokeProposal(input, candidate)
      : reconciliationProposal(input, candidate), null, 2));
  } else {
    const proposal = closureProposal(input, project);
    verifyProposalBase(proposal, input);
    console.log(JSON.stringify(proposal, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'NOT_VERIFIED: invalid evidence');
  process.exitCode = 1;
}
