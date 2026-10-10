import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from './common.mjs';
import { bindContainment, pendingInstallation, syntheticSequenceClosure } from './containment-fixtures.mjs';
import { syntheticEvidence } from './fixtures.mjs';
import { verifyContainment, verifyInstallationIsolation } from './containment.mjs';
import { verifyCredentials } from './authority-proofs.mjs';
import { AUTH_CAPTURE_KINDS, AUTH_REQUIRED_BOUNDARIES, AUTH_CONTAINMENT_MECHANISM,
  verifyAuthDestinationContainment } from './auth-destination-proof.mjs';

const hash = char => char.repeat(64);
function fixture(context) {
  const observations = {
    AUTH_ACCOUNT_INVENTORY: { complete: true, pages: 1, nextPageToken: null, accounts: [
      { uid: 'john-demo', createdAtMs: 10, classification: 'REGISTERED' },
      { uid: 'buyer-demo', createdAtMs: 11, classification: 'REGISTERED' },
      { uid: 'anonymous-demo', createdAtMs: 12, classification: 'ANONYMOUS' },
      { uid: 'disabled-demo', createdAtMs: 13, classification: 'DISABLED' },
    ] },
    PROTECTED_ACCOUNT_STATE: { control: { schema: 1, phase: 'ENFORCED', epoch: hash('e'), legacyCutoffMs: 100 },
      accounts: ['john-demo', 'buyer-demo', 'anonymous-demo', 'disabled-demo'].map(uid => ({ schema: 1, uid,
        epoch: hash('e'), status: 'PENDING', recoveryEmail: null, channelStatus: 'UNVERIFIED',
        channelEvidenceSha256: null, roles: { admin: uid === 'john-demo', superadmin: uid === 'john-demo' } })) },
    SESSION_CAPABILITY_POLICY: { schema: 1, epoch: hash('e'), controlPath: 'operations/credentialAccessCutover',
      accountPath: 'credentialAccess/{uid}', sessionPath: 'credentialSessions/{capability}',
      claims: { session: 'mutterCredentialSession', epoch: 'mutterCredentialEpoch' }, capabilityBytes: 32,
      maximumLifetimeMs: 7 * 24 * 60 * 60 * 1000, renewalWindowMs: 12 * 60 * 60 * 1000, expiredSessionMayRenew: false,
      serverOwned: true, clientMayReleaseRestriction: false, uidWideRelease: false, customUserClaimsUsed: false,
      activeSessions: [] },
    FIRESTORE_RULES: { schema: 1, activeReleaseVerified: true, r1bSha256: hash('a'), cutoverSha256: hash('b'),
      privateReadsAndWritesRequireCapability: true, protectedStateClientWritesDenied: true },
    SDK_DESTINATION_ENFORCEMENT: { schema: 1, targets: context.targets, storeSourceSha256: hash('c'),
      adminSourceSha256: hash('d'), runtimePairVerified: true, sdkRevocationChecked: true,
      privateDestinationsRequireCapability: true,
      boundaries: AUTH_REQUIRED_BOUNDARIES.map(id => ({ id, result: 'PASS', evidenceSha256: hash('f') })) },
    DATA_CONTINUITY: { schema: 1, sameUidCount: 4, usersDeleted: 0, usersRecreated: 0, uidChanges: 0,
      ordersChanged: 0, cartsChanged: 0, publicationsChanged: 0, quantitiesChanged: 0,
      beforeSha256: hash('9'), afterSha256: hash('9') },
  };
  return { schema: 1, mechanism: AUTH_CONTAINMENT_MECHANISM, project: 'mutter-games', synthetic: true,
    revision: context.revision, targets: context.targets, epoch: hash('e'), legacyCutoffMs: 100, observedAtMs: 100110,
    containedAccountCount: 4, postCutoverAccountCount: 0, dispositionCounts: { PENDING_RETURN: 0, RETURN_COMPLETE: 0, NO_VERIFIED_CHANNEL: 3, DISABLED: 1 },
    captures: AUTH_CAPTURE_KINDS.map(kind => ({ kind, project: 'mutter-games', synthetic: true, observedAtMs: 100110,
      observation: observations[kind], sha256: digest(observations[kind]) })) };
}
function updateCapture(proof, kind, mutate) {
  const row = proof.captures.find(c => c.kind === kind); mutate(row.observation); row.sha256 = digest(row.observation);
}
const context = { synthetic: true, revision: 'demo_revision_20261010', nowMs: 100200, maxAgeMs: 100000, effectiveAt: 100085,
  targets: { store: { head: 'a'.repeat(40), tree: 'b'.repeat(40) }, admin: { head: 'c'.repeat(40), tree: 'd'.repeat(40) } } };

test('all legacy accounts remain contained while return is still pending, preserving data', () => {
  const result = verifyAuthDestinationContainment(fixture(context), context);
  assert.equal(result.containedAccountCount, 4);
  assert.equal(result.pendingReturnIsRecovered, false);
  assert.equal(result.dispositionCounts.RETURN_COMPLETE, 0);
  assert.equal(result.remoteEnforcementAttestedByThisTool, false);
});
const rejected = {
  inventoryIncomplete: p => updateCapture(p, 'AUTH_ACCOUNT_INVENTORY', o => { o.complete = false; }),
  missingAccount: p => updateCapture(p, 'PROTECTED_ACCOUNT_STATE', o => { o.accounts.pop(); }),
  disabledRecovered: p => updateCapture(p, 'PROTECTED_ACCOUNT_STATE', o => { o.accounts[3].status = 'RECOVERED'; }),
  unverifiedMail: p => updateCapture(p, 'PROTECTED_ACCOUNT_STATE', o => { o.accounts[0].recoveryEmail = 'demo@example.invalid'; }),
  countFabricated: p => { p.dispositionCounts.RETURN_COMPLETE = 1; },
  clientsMayRelease: p => updateCapture(p, 'SESSION_CAPABILITY_POLICY', o => { o.clientMayReleaseRestriction = true; }),
  unboundedLifetime: p => updateCapture(p, 'SESSION_CAPABILITY_POLICY', o => { o.maximumLifetimeMs *= 2; }),
  expiredRenewal: p => updateCapture(p, 'SESSION_CAPABILITY_POLICY', o => { o.expiredSessionMayRenew = true; }),
  uidWide: p => updateCapture(p, 'SESSION_CAPABILITY_POLICY', o => { o.uidWideRelease = true; }),
  customUserClaims: p => updateCapture(p, 'SESSION_CAPABILITY_POLICY', o => { o.customUserClaimsUsed = true; }),
  oldRules: p => updateCapture(p, 'FIRESTORE_RULES', o => { o.privateReadsAndWritesRequireCapability = false; }),
  runtimePending: p => updateCapture(p, 'SDK_DESTINATION_ENFORCEMENT', o => { o.runtimePairVerified = false; }),
  missingBoundary: p => updateCapture(p, 'SDK_DESTINATION_ENFORCEMENT', o => { o.boundaries.pop(); }),
  failedBoundary: p => updateCapture(p, 'SDK_DESTINATION_ENFORCEMENT', o => { o.boundaries[0].result = 'FAIL'; }),
  changedCart: p => updateCapture(p, 'DATA_CONTINUITY', o => { o.cartsChanged = 1; }),
  syntheticAsReal: p => { p.synthetic = false; },
  wrongPair: p => { p.targets = { store: context.targets.store }; },
  uncertainRestriction: p => updateCapture(p, 'PROTECTED_ACCOUNT_STATE', o => { o.control.phase = 'UNCERTAIN'; }),
};
for (const [name, mutate] of Object.entries(rejected)) test(`Auth destination proof rejects ${name}`, () => {
  const proof = fixture(context); mutate(proof); assert.throws(() => verifyAuthDestinationContainment(proof, context), /BLOCKED/);
});

test('an old credential cannot gain a capability while its account remains pending', () => {
  const proof = fixture(context);
  updateCapture(proof, 'SESSION_CAPABILITY_POLICY', o => { o.activeSessions.push({ schema: 1, capabilitySha256: hash('7'),
    capabilityFormat: '64_LOWER_HEX', uid: 'buyer-demo', epoch: proof.epoch, status: 'ACTIVE', expiresAtMs: 100300,
    proofKind: 'RECOVERY_CHANNEL', roles: { admin: false, superadmin: false } }); });
  assert.throws(() => verifyAuthDestinationContainment(proof, context), /Pending account/);
});

test('legitimate same-UID recovery is counted separately; fresh anonymous remains ordinary and unprivileged', () => {
  const proof = fixture(context); proof.postCutoverAccountCount = 1;
  updateCapture(proof, 'AUTH_ACCOUNT_INVENTORY', o => { o.accounts.push({ uid: 'new-anonymous-demo', createdAtMs: 101, classification: 'ANONYMOUS' }); });
  updateCapture(proof, 'PROTECTED_ACCOUNT_STATE', o => {
    o.accounts.push({ schema: 1, uid: 'new-anonymous-demo', epoch: proof.epoch, status: 'NATIVE_POST_CUTOVER',
      recoveryEmail: null, channelStatus: 'UNVERIFIED', channelEvidenceSha256: null, roles: { admin: false, superadmin: false } });
    Object.assign(o.accounts[0], { status: 'RECOVERED', channelStatus: 'INDEPENDENTLY_VERIFIED',
      recoveryEmail: 'john@example.invalid', channelEvidenceSha256: hash('4'), recoveryProofSha256: hash('5') });
  });
  updateCapture(proof, 'SESSION_CAPABILITY_POLICY', o => {
    o.activeSessions.push({ schema: 1, capabilitySha256: hash('6'), capabilityFormat: '64_LOWER_HEX',
      uid: 'john-demo', epoch: proof.epoch, status: 'ACTIVE', expiresAtMs: 100300, proofKind: 'RECOVERY_CHANNEL',
      roles: { admin: true, superadmin: true } });
    o.activeSessions.push({ schema: 1, capabilitySha256: hash('7'), capabilityFormat: '64_LOWER_HEX',
      uid: 'new-anonymous-demo', epoch: proof.epoch, status: 'ACTIVE', expiresAtMs: 100300,
      proofKind: 'NEW_POST_CUTOVER', authCreatedAtMs: 101, roles: { admin: false, superadmin: false } });
  });
  proof.dispositionCounts.RETURN_COMPLETE = 1; proof.dispositionCounts.NO_VERIFIED_CHANNEL = 2;
  assert.equal(verifyAuthDestinationContainment(proof, context).dispositionCounts.RETURN_COMPLETE, 1);
  for (const mutate of [
    s => { s.uid = 'buyer-demo'; }, s => { s.epoch = hash('0'); }, s => { s.expiresAtMs = 100109; },
    s => { s.roles.superadmin = true; }, s => { s.authCreatedAtMs = 99; },
    s => { s.uid = 'not-in-complete-inventory'; }, s => { s.expiresAtMs = proof.observedAtMs + 8 * 24 * 60 * 60 * 1000; },
  ]) {
    const changed = structuredClone(proof);
    updateCapture(changed, 'SESSION_CAPABILITY_POLICY', o => mutate(o.activeSessions[1]));
    assert.throws(() => verifyAuthDestinationContainment(changed, context), /BLOCKED/);
  }
});

test('installation keeps both pending families; final verifier requires the new proof after migration', () => {
  const input = syntheticEvidence(); pendingInstallation(input); const installed = verifyInstallationIsolation(input.containment, input);
  assert.equal(installed.credentialRoutesClosed, false); assert.equal(installed.credentials.unresolved, 2);
  const closed = syntheticSequenceClosure(input, 100110), proofContext = { ...context, targets: closed.targets,
    revision: closed.revision, nowMs: closed.nowMs, maxAgeMs: closed.maxAgeMs };
  const proof = fixture(proofContext); closed.containment.authDestinationContainment = proof;
  for (const family of closed.containment.credentials.families) if (['FIREBASE_SESSIONS', 'SIGNED_JWT_AND_BLOB'].includes(family.family)) {
    family.disposition = 'DESTINATION_AUTHORITY_CONTAINED'; family.authDestinationContainmentSha256 = digest(proof);
  }
  // Containment digest also binds the new Auth proof, without putting its captures in IAM reviewSources.
  bindContainment(closed);
  assert.equal(verifyContainment(closed.containment, closed).status, 'CONTAINMENT_DOCUMENTS_CONSISTENT');
  const sources = installed.sourceHashes;
  assert.throws(() => verifyCredentials(closed.containment.credentials, sources, 100085, proofContext), /Auth containment/);
  assert.deepEqual(closed.containment.installationCredentials, input.containment.credentials);
});


test('complete inventory separates post-cutover accounts without reducing conservative legacy closure', () => {
  const proof = fixture(context); proof.postCutoverAccountCount = 1;
  updateCapture(proof, 'AUTH_ACCOUNT_INVENTORY', o => { o.accounts.push({ uid: 'new-not-admitted', createdAtMs: 101, classification: 'ANONYMOUS' }); });
  const result = verifyAuthDestinationContainment(proof, context);
  assert.equal(result.containedAccountCount, 4); assert.equal(result.postCutoverAccountCount, 1);
  assert.equal(result.dispositionCounts.NO_VERIFIED_CHANNEL, 3);
  const missingLegacy = structuredClone(proof);
  updateCapture(missingLegacy, 'PROTECTED_ACCOUNT_STATE', o => { o.accounts.splice(0, 1); });
  assert.throws(() => verifyAuthDestinationContainment(missingLegacy, context), /BLOCKED/);
  const falseNative = structuredClone(proof);
  updateCapture(falseNative, 'PROTECTED_ACCOUNT_STATE', o => { o.accounts[0].status = 'NATIVE_POST_CUTOVER'; });
  assert.throws(() => verifyAuthDestinationContainment(falseNative, context), /BLOCKED/);
  const futureCreation = structuredClone(proof);
  updateCapture(futureCreation, 'AUTH_ACCOUNT_INVENTORY', o => { o.accounts.at(-1).createdAtMs = proof.observedAtMs + 1; });
  assert.throws(() => verifyAuthDestinationContainment(futureCreation, context), /BLOCKED/);
  const disabledNative = structuredClone(proof);
  updateCapture(disabledNative, 'AUTH_ACCOUNT_INVENTORY', o => { o.accounts.at(-1).classification = 'DISABLED'; });
  updateCapture(disabledNative, 'PROTECTED_ACCOUNT_STATE', o => { o.accounts.push({ schema: 1, uid: 'new-not-admitted', epoch: proof.epoch,
    status: 'NATIVE_POST_CUTOVER', recoveryEmail: null, channelStatus: 'UNVERIFIED', channelEvidenceSha256: null, roles: { admin: false, superadmin: false } }); });
  assert.throws(() => verifyAuthDestinationContainment(disabledNative, context), /BLOCKED/);
});
