import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { PROJECT, demand, digest, isHash, canonical } from './common.mjs';

export const AUTH_CONTAINMENT_MECHANISM = 'SERVER_OWNED_SESSION_CAPABILITY_V1';
export const AUTH_CAPTURE_KINDS = Object.freeze([
  'AUTH_ACCOUNT_INVENTORY', 'PROTECTED_ACCOUNT_STATE', 'SESSION_CAPABILITY_POLICY',
  'FIRESTORE_RULES', 'SDK_DESTINATION_ENFORCEMENT', 'DATA_CONTINUITY',
]);
export const AUTH_REQUIRED_BOUNDARIES = Object.freeze([
  'OLD_PASSWORD_LOGIN', 'OLD_REFRESH_TOKEN', 'OLD_CUSTOM_PASSWORD_LINK', 'OLD_AUTH_ACCOUNT_UPDATE',
  'OLD_RECOVERY_ACTION', 'DIRECT_PRIVATE_READ', 'DIRECT_PRIVATE_WRITE', 'ADMIN_SDK',
  'BUYER_SDK', 'CLIENT_RESTRICTION_WRITE', 'CLIENT_CAPABILITY_WRITE', 'MAIL_PROOF_SAME_UID',
  'CAPABILITY_UID_EPOCH_EXPIRY', 'PENDING_RETURN_DENIED', 'NEW_PASSWORD', 'NEW_ANONYMOUS',
]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const time = value => Number.isSafeInteger(value) && value >= 0;
const roles = value => record(value) && typeof value.admin === 'boolean' && typeof value.superadmin === 'boolean';
const uid = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s/]/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;

/** Checks evidence consistency, never provider authenticity or production effects.
 * A pending return is contained only by the protected destination restriction.
 */
export function verifyAuthDestinationContainment(proof, context) {
  demand(proof?.schema === 1 && proof.mechanism === AUTH_CONTAINMENT_MECHANISM
    && proof.project === PROJECT && proof.revision === context.revision
    && canonical(proof.targets) === canonical(context.targets), 'Auth containment identity/target mismatch');
  demand(proof.synthetic === (context.synthetic === true) && isHash(proof.epoch)
    && time(proof.legacyCutoffMs) && time(proof.observedAtMs)
    && proof.observedAtMs >= context.effectiveAt && proof.observedAtMs <= context.nowMs
    && context.nowMs - proof.observedAtMs <= context.maxAgeMs,
  'Auth containment chronology/synthetic provenance');
  demand(Array.isArray(proof.captures) && proof.captures.length === AUTH_CAPTURE_KINDS.length
    && new Set(proof.captures.map(c => c.kind)).size === AUTH_CAPTURE_KINDS.length,
  'Auth containment capture coverage');
  const observations = new Map();
  for (const kind of AUTH_CAPTURE_KINDS) {
    const capture = proof.captures.find(c => c.kind === kind);
    demand(capture && capture.project === PROJECT && capture.synthetic === proof.synthetic
      && time(capture.observedAtMs) && capture.observedAtMs >= context.effectiveAt
      && capture.observedAtMs <= proof.observedAtMs && isHash(capture.sha256)
      && capture.sha256 === digest(capture.observation), 'Auth capture identity/integrity/chronology');
    observations.set(kind, capture.observation);
  }
  const inventory = observations.get('AUTH_ACCOUNT_INVENTORY');
  demand(inventory?.complete === true && count(inventory.pages) && inventory.pages > 0
    && inventory.nextPageToken === null && Array.isArray(inventory.accounts)
    && inventory.accounts.every(a => uid(a.uid) && time(a.createdAtMs) && a.createdAtMs <= proof.observedAtMs
      && ['REGISTERED', 'ANONYMOUS', 'NO_RECOVERY_CHANNEL', 'DISABLED'].includes(a.classification))
    && new Set(inventory.accounts.map(a => a.uid)).size === inventory.accounts.length,
  'Auth inventory incomplete/duplicate');
  const legacyAccounts = inventory.accounts.filter(a => a.createdAtMs <= proof.legacyCutoffMs);
  const postCutoverAccounts = inventory.accounts.filter(a => a.createdAtMs > proof.legacyCutoffMs);
  demand(proof.postCutoverAccountCount === postCutoverAccounts.length, 'Auth post-cutover inventory count mismatch');
  const protectedState = observations.get('PROTECTED_ACCOUNT_STATE');
  demand(protectedState?.control?.schema === 1 && protectedState.control.phase === 'ENFORCED'
    && protectedState.control.epoch === proof.epoch
    && protectedState.control.legacyCutoffMs === proof.legacyCutoffMs
    && Array.isArray(protectedState.accounts)
    && protectedState.accounts.length >= legacyAccounts.length
    && protectedState.accounts.length <= inventory.accounts.length
    && protectedState.accounts.every(a => inventory.accounts.some(i => i.uid === a.uid))
    && new Set(protectedState.accounts.map(a => a.uid)).size === protectedState.accounts.length,
  'Auth protected-state coverage/control mismatch');
  const dispositions = { PENDING_RETURN: 0, RETURN_COMPLETE: 0, NO_VERIFIED_CHANNEL: 0, DISABLED: 0 };
  for (const account of legacyAccounts) {
    const state = protectedState.accounts.find(a => a.uid === account.uid);
    demand(state?.schema === 1 && state.epoch === proof.epoch && roles(state.roles)
      && ['PENDING', 'RECOVERED'].includes(state.status)
      && ['UNVERIFIED', 'INDEPENDENTLY_VERIFIED'].includes(state.channelStatus),
    'Auth account restriction missing/malformed');
    if (state.channelStatus === 'INDEPENDENTLY_VERIFIED') demand(
      typeof state.recoveryEmail === 'string' && state.recoveryEmail.length > 3
      && isHash(state.channelEvidenceSha256), 'Auth recovery channel not independently bound');
    else demand(state.recoveryEmail === null && state.channelEvidenceSha256 === null,
      'Unverified channel cannot authorize recovery');
    if (account.classification === 'DISABLED') {
      demand(state.status === 'PENDING', 'Disabled account silently recovered'); dispositions.DISABLED++;
    } else if (state.status === 'RECOVERED') {
      demand(state.channelStatus === 'INDEPENDENTLY_VERIFIED' && isHash(state.recoveryProofSha256),
        'Recovered account lacks independent same-UID mail proof'); dispositions.RETURN_COMPLETE++;
    } else if (state.channelStatus === 'INDEPENDENTLY_VERIFIED') dispositions.PENDING_RETURN++;
    else dispositions.NO_VERIFIED_CHANNEL++;
  }
  demand(canonical(proof.dispositionCounts) === canonical(dispositions)
    && proof.containedAccountCount === legacyAccounts.length,
  'Auth disposition counts conceal missing/recovered accounts');
  for (const account of postCutoverAccounts) {
    const state = protectedState.accounts.find(a => a.uid === account.uid);
    // A new Auth account without a protected record is not yet admitted; bootstrap
    // must create NATIVE_POST_CUTOVER first. It cannot access private destinations.
    if (state) demand(state.schema === 1 && state.epoch === proof.epoch
      && ['PENDING', 'NATIVE_POST_CUTOVER'].includes(state.status)
      && (account.classification !== 'DISABLED' || state.status === 'PENDING') && roles(state.roles)
      && state.roles.admin === false && state.roles.superadmin === false
      && state.channelStatus === 'UNVERIFIED' && state.recoveryEmail === null
      && state.channelEvidenceSha256 === null, 'Post-cutover account has legacy or privileged authority');
  }
  const sessions = observations.get('SESSION_CAPABILITY_POLICY');
  demand(sessions?.schema === 1 && sessions.epoch === proof.epoch && sessions.controlPath === 'operations/credentialAccessCutover'
    && sessions.accountPath === 'credentialAccess/{uid}' && sessions.sessionPath === 'credentialSessions/{capability}'
    && sessions.claims?.session === 'mutterCredentialSession' && sessions.claims.epoch === 'mutterCredentialEpoch'
    && sessions.capabilityBytes === 32 && sessions.maximumLifetimeMs === 7 * 24 * 60 * 60 * 1000
    && sessions.renewalWindowMs === 12 * 60 * 60 * 1000 && sessions.expiredSessionMayRenew === false
    && sessions.serverOwned === true
    && sessions.clientMayReleaseRestriction === false && sessions.uidWideRelease === false
    && sessions.customUserClaimsUsed === false && Array.isArray(sessions.activeSessions),
  'Auth capability policy incomplete/UID-wide authority');
  for (const session of sessions.activeSessions) {
    demand(session?.schema === 1 && isHash(session.capabilitySha256) && session.capabilityFormat === '64_LOWER_HEX' && uid(session.uid)
      && session.epoch === proof.epoch && session.status === 'ACTIVE' && time(session.expiresAtMs)
      && session.expiresAtMs > proof.observedAtMs
      && session.expiresAtMs <= proof.observedAtMs + sessions.maximumLifetimeMs && roles(session.roles)
      && ['NEW_POST_CUTOVER', 'RECOVERY_CHANNEL'].includes(session.proofKind), 'Auth capability state invalid');
    const inventoried = inventory.accounts.find(a => a.uid === session.uid);
    demand(inventoried && inventoried.classification !== 'DISABLED', 'Active capability absent/disabled in complete Auth inventory');
    if (inventoried.createdAtMs <= proof.legacyCutoffMs) {
      const state = protectedState.accounts.find(a => a.uid === session.uid);
      demand(state.status === 'RECOVERED' && session.proofKind === 'RECOVERY_CHANNEL'
        && canonical(state.roles) === canonical(session.roles), 'Pending account has authority/capability role drift');
    } else {
      const state = protectedState.accounts.find(a => a.uid === session.uid);
      demand(state?.status === 'NATIVE_POST_CUTOVER' && session.proofKind === 'NEW_POST_CUTOVER'
        && session.authCreatedAtMs === inventoried.createdAtMs && session.roles.admin === false
        && session.roles.superadmin === false, 'New-account capability bypasses legacy cutoff');
    }
  }
  const rules = observations.get('FIRESTORE_RULES');
  demand(rules?.schema === 1 && rules.activeReleaseVerified === true
    && isHash(rules.r1bSha256) && isHash(rules.cutoverSha256)
    && rules.privateReadsAndWritesRequireCapability === true && rules.protectedStateClientWritesDenied === true,
  'Auth Rules destination not verified');
  const sdk = observations.get('SDK_DESTINATION_ENFORCEMENT');
  demand(sdk?.schema === 1 && canonical(sdk.targets) === canonical(proof.targets)
    && isHash(sdk.storeSourceSha256) && isHash(sdk.adminSourceSha256)
    && sdk.runtimePairVerified === true && sdk.sdkRevocationChecked === true
    && sdk.privateDestinationsRequireCapability === true && Array.isArray(sdk.boundaries)
    && new Set(sdk.boundaries.map(b => b.id)).size === AUTH_REQUIRED_BOUNDARIES.length
    && sdk.boundaries.length === AUTH_REQUIRED_BOUNDARIES.length
    && AUTH_REQUIRED_BOUNDARIES.every(id => sdk.boundaries.some(b => b.id === id && b.result === 'PASS' && isHash(b.evidenceSha256))),
  'Auth SDK/direct endpoint boundary incomplete');
  const continuity = observations.get('DATA_CONTINUITY');
  demand(continuity?.schema === 1 && continuity.sameUidCount === legacyAccounts.length
    && continuity.usersDeleted === 0 && continuity.usersRecreated === 0 && continuity.uidChanges === 0
    && continuity.ordersChanged === 0 && continuity.cartsChanged === 0 && continuity.publicationsChanged === 0
    && continuity.quantitiesChanged === 0 && isHash(continuity.beforeSha256)
    && continuity.beforeSha256 === continuity.afterSha256,
  'Auth-only treatment changed UID/commercial data');
  return { status: 'AUTH_DESTINATION_EVIDENCE_CONSISTENT', containedAccountCount: proof.containedAccountCount,
    postCutoverAccountCount: postCutoverAccounts.length, dispositionCounts: dispositions, proofSha256: digest(proof), pendingReturnIsRecovered: false,
    remoteEnforcementAttestedByThisTool: false, providerAuthenticityRequiresIndependentReview: true };
}

export async function verifyAuthDestinationReceiptFiles(proof, root) {
  demand(Array.isArray(proof.captureFiles) && proof.captureFiles.length === AUTH_CAPTURE_KINDS.length,
    'Auth primary capture files missing');
  for (const kind of AUTH_CAPTURE_KINDS) {
    const ref = proof.captureFiles.find(r => r.kind === kind);
    demand(ref && typeof ref.path === 'string' && !isAbsolute(ref.path)
      && !ref.path.split(/[\\/]/).includes('..') && isHash(ref.sha256), 'Unsafe Auth primary source reference');
    const file = await realpath(resolve(root, ref.path)), local = relative(root, file);
    demand(local && !local.startsWith('..') && !isAbsolute(local), 'Auth source outside private evidence');
    const bytes = await readFile(file); demand(digest(bytes) === ref.sha256, 'Auth primary source file integrity');
    const receipt = JSON.parse(bytes), capture = proof.captures.find(c => c.kind === kind);
    demand(receipt.synthetic !== true && receipt.provenanceReviewed === true
      && typeof receipt.primarySource === 'string' && receipt.primarySource.length > 0
      && canonical(receipt.observation) === canonical(capture), 'Unbound/synthetic Auth primary capture');
  }
}
