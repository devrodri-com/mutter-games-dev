import { PROJECT, DATABASE, PLANNED_ACCOUNT, LEGACY_ACCOUNTS, demand, digest, isHash, canonical } from './common.mjs';
import { PROJECTS } from '../release-cutover/policy.mjs';
import { instant, same } from './iam-evidence.mjs';
import { CREDENTIAL_FAMILIES, CLOSED_CREDENTIAL_DISPOSITIONS } from './authority-proofs.mjs';

export const INSTALLATION_PHASE = 'CONTROLLED_INSTALL_PENDING_CLOSURE';
export const REQUIRED_BARRIERS = Object.freeze([...Object.values(PROJECTS), 'firestore-direct', 'legacy-authority', 'delegation', 'administrative-launch']);
const sha = v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);

/** Installation admission never grants remote authority or closes credentials. */
export function verifyInstallationInput(input) {
  demand(input?.schema === 1 && input.phase === INSTALLATION_PHASE, 'explicit controlled installation phase required');
  demand(input.project === PROJECT && input.database === DATABASE && instant(input.nowMs)
    && instant(input.maxAgeMs) && input.maxAgeMs > 0, 'installation project/time identity');
  demand(typeof input.revision === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(input.revision), 'installation revision');
  demand(instant(input.window?.confirmedAtMs) && input.window.confirmedAtMs <= input.nowMs
    && instant(input.window.expiresAtMs) && input.nowMs < input.window.expiresAtMs
    && input.window.johnNotEditing === true && input.window.otherHumanWritersStopped === true, 'installation window expired/missing');
  for (const key of ['store', 'admin']) {
    const target = input.targets?.[key];
    demand(sha(target?.head) && sha(target.tree), 'installation target identity');
  }
  demand(input.identity?.candidate === PLANNED_ACCOUNT && Array.isArray(input.identity.legacy)
    && canonical([...input.identity.legacy].sort()) === canonical([...LEGACY_ACCOUNTS].sort()), 'installation identity');
  demand(Array.isArray(input.barriers) && input.barriers.length === REQUIRED_BARRIERS.length
    && new Set(input.barriers.map(b => b.scope)).size === REQUIRED_BARRIERS.length, 'installation barrier coverage');
  for (const scope of REQUIRED_BARRIERS) {
    const barrier = input.barriers.find(b => b.scope === scope);
    demand(barrier?.state === 'closed' && barrier.revision === input.revision
      && typeof barrier.version === 'string' && barrier.version.length > 0
      && instant(barrier.observedAtMs) && barrier.observedAtMs >= input.window.confirmedAtMs
      && barrier.observedAtMs < input.window.expiresAtMs && barrier.observedAtMs <= input.nowMs
      && input.nowMs - barrier.observedAtMs <= input.maxAgeMs && barrier.readbackMatches === true
      && barrier.enforcementEvidence === true && isHash(barrier.evidenceSha256), `installation barrier missing/contradictory: ${scope}`);
  }
  demand(input.delegation?.containedBeforeCandidateGrant === true
    && input.delegation.resourceAndInheritedBindingsReviewed === true
    && input.delegation.legacyElevatedAllowsRemoved === true && input.delegation.noUnresolvedEscape === true, 'installation delegation not contained');
}

/** This validates the honest pending inventory, not the final closure receipt.
 * The closed verifier remains verifyCredentials. A pending candidate is never
 * promoted into its reviewed-no-unresolved disposition by an IAM grant.
 */
export function verifyPendingCredentials(value, sourceHashes, effectiveAt, context) {
  demand(value?.status === 'PENDING_CLOSURE' && value.noIntrusionOrIssuanceInferred === true
    && value.keyDeletionRevokesIssuedTokens === false && value.tokenCreatorRemovalRevokesIssuedTokens === false
    && Number.isSafeInteger(value.unresolved) && value.unresolved > 0 && Array.isArray(value.families)
    && same(value.families.map(f => f.family).sort(), [...CREDENTIAL_FAMILIES].sort()), 'installation credential inventory must remain pending');
  const pending = value.families.filter(f => f.disposition === 'PENDING_TREATMENT');
  demand(pending.length === value.unresolved && pending.some(f => f.family === 'FIREBASE_SESSIONS')
    && pending.every(f => ['FIREBASE_SESSIONS', 'SIGNED_JWT_AND_BLOB'].includes(f.family)), 'installation pending family coverage');
  for (const family of value.families) {
    demand([...CLOSED_CREDENTIAL_DISPOSITIONS, 'PENDING_TREATMENT'].includes(family.disposition)
      && Array.isArray(family.representedPrincipals) && family.representedPrincipals.length > 0
      && typeof family.scope === 'string' && family.scope.length > 0
      && typeof family.validityBasis === 'string' && family.validityBasis.length >= 30
      && typeof family.reason === 'string' && family.reason.length >= 30
      && Array.isArray(family.sourceSha256) && family.sourceSha256.length > 0
      && family.sourceSha256.every(h => sourceHashes.includes(h)), 'installation credential family unsupported');
    demand(instant(family.reviewedAtMs) && family.reviewedAtMs >= effectiveAt
      && family.reviewedAtMs <= context.nowMs, 'installation credential review chronology');
    if (family.disposition === 'BOUNDED_VALIDITY_AND_ISSUANCE_CLOSED') demand(
      instant(family.lastPossibleIssueAtMs) && instant(family.validUntilMs)
      && family.lastPossibleIssueAtMs <= family.validUntilMs && family.validUntilMs <= family.reviewedAtMs
      && typeof family.issuanceClosureBasis === 'string' && family.issuanceClosureBasis.length >= 30
      && family.familySpecificValidity === true, 'installation elapsed time is insufficient');
    if (family.family === 'LEGACY_KEYS_AND_REPRESENTING_TOKENS') demand(
      family.disposition === 'DESTINATION_AUTHORITY_CONTAINED'
      && same([...family.representedPrincipals].sort(), [...LEGACY_ACCOUNTS].sort()), 'installation legacy destination authority unresolved');
    demand(!family.representedPrincipals.includes(PLANNED_ACCOUNT), 'installation preexisting candidate credentials unresolved');
  }
  return Math.max(...value.families.map(f => f.reviewedAtMs));
}
