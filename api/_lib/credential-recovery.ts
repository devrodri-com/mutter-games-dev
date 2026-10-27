import { createHash, randomBytes } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { CredentialAccessError, RECOVERY_CHALLENGE_TTL_MS, normalizeRecoveryEmail, object, parseAccount, parseCutover,
  safeTime, validSecret, verifiedClaimIdentity, CREDENTIAL_SESSION_TTL_MS, JOHN_ADMIN_SCOPE,
  HASHED_CAPABILITY_FORMAT, parseSession, type CredentialAccount, type CredentialCutover, type CredentialSession } from './credential-access-state.js';
import { readPasswordUpdatedAt, sendOfficialPasswordReset } from './credential-auth-rest.js';
import { mintCredentialSession, type SessionResponse } from './credential-session.js';
import { credentialSessionLocator, scopedAccountMatches, scopedSecret, scopedSessionMatches, scopedSubjectAllowed } from './credential-capability.js';
import { verifiedPasswordVersion } from './credential-password-reentry.js';
import { parseChallenge, requestMatchesChallenge, type RecoveryChallenge } from './credential-recovery-state.js';
import { emitScopedSession } from './credential-scoped-session.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function failedRecovery(): never {
  throw new CredentialAccessError(403, 'RECOVERY_NOT_COMPLETED', 'No pudimos completar ese acceso. Pedí una recuperación nueva desde la tienda.');
}
function eligibleAccount(account: CredentialAccount | null, epoch: string): account is CredentialAccount & { recoveryEmail: string; channelEvidenceSha256: string } {
  return account !== null && account.epoch === epoch && account.status !== 'NATIVE_POST_CUTOVER'
    && account.channelStatus === 'INDEPENDENTLY_VERIFIED' && account.recoveryEmail !== null && account.channelEvidenceSha256 !== null;
}
function recoveryContinueUrl(nonce: string): string {
  // Only this registered production origin, or an explicit local demo origin, may receive the proof.
  const origin = process.env.FIREBASE_AUTH_EMULATOR_HOST ? 'http://127.0.0.1:5173' : 'https://muttergames.com';
  return `${origin}/login#recovery=${nonce}`;
}
async function recordDeliveryResult(db: Firestore, requestPath: string, challenge: RecoveryChallenge, delivered: boolean): Promise<void> {
  await db.runTransaction(async tx => {
    const requestRef = db.doc(requestPath), challengeRef = db.doc(`credentialRecoveryChallenges/${challenge.secretHash}`);
    const [requestSnapshot, challengeSnapshot] = await Promise.all([tx.get(requestRef), tx.get(challengeRef)]);
    const completed = parseChallenge(challengeSnapshot.data());
    // The holder can complete A and request B before A's acknowledgment arrives.
    // Consumed A is final; the newer per-UID guard belongs to B and stays intact.
    if (completed?.deliveryState === 'CONSUMED' && completed.secretHash === challenge.secretHash
      && completed.uid === challenge.uid && completed.epoch === challenge.epoch) return;
    if (requestSnapshot.get('challengeHash') !== challenge.secretHash || requestSnapshot.get('deliveryState') !== 'PENDING') {
      throw new Error('Recovery delivery journal changed');
    }
    const receipt = delivered ? { deliveryState: 'SENT', sentAtMs: Date.now() }
      : { deliveryState: 'UNCERTAIN', uncertainAtMs: Date.now() };
    tx.update(challengeRef, receipt);
    tx.update(requestRef, receipt);
  });
}
/** Public caller receives an acknowledgment, never account existence or a proof. */
export async function requestCredentialRecovery(auth: Auth, db: Firestore, requestedEmail: unknown): Promise<void> {
  const cutover = parseCutover((await db.doc('operations/credentialAccessCutover').get()).data());
  const email = normalizeRecoveryEmail(requestedEmail);
  if (!email) return;
  const matches = cutover.schema === 2
    ? (await Promise.all([cutover.subjectUid, ...(cutover.additionalSubject ? [cutover.additionalSubject.uid] : [])]
      .map(uid => db.doc(`credentialAccess/${uid}`).get())))
      .filter(snapshot => parseAccount(snapshot.data())?.recoveryEmail === email)
    : (await db.collection('credentialAccess').where('recoveryEmail', '==', email).limit(2).get()).docs;
  if (matches.length !== 1) return;
  const account = parseAccount(matches[0].data());
  if (!eligibleAccount(account, cutover.epoch) || account.recoveryEmail !== email || matches[0].id !== account.uid
    || (cutover.schema === 2 && !scopedAccountMatches(cutover, account)) || (cutover.schema === 1 && account.schema !== 1)) return;
  const requestRef = db.doc(`credentialRecoveryRequests/${digest(`${cutover.epoch}:${account.uid}`)}`);
  let baseline: { passwordUpdatedAtMs: number; email: string | null };
  try {
    const user = await auth.getUser(account.uid);
    if (user.disabled || normalizeRecoveryEmail(user.email) !== email) return;
    baseline = await readPasswordUpdatedAt(auth, account.uid);
    if (baseline.email !== email) return;
  } catch {
    // Preserve a real failure privately; REQUEST_RECEIVED never claims mail delivery.
    await db.collection('credentialRecoveryJournal').add({ schema: 1, uid: account.uid, epoch: cutover.epoch,
      action: 'PREPARATION_READ', status: 'FAILED', atMs: Date.now() });
    return;
  }
  const nonce = randomBytes(32).toString('hex'), secretHash = digest(nonce), now = Date.now();
  const challenge: RecoveryChallenge = { schema: cutover.schema, ...(cutover.schema === 2 ? { scope: JOHN_ADMIN_SCOPE } : {}), uid: account.uid, epoch: cutover.epoch, email,
    channelEvidenceSha256: account.channelEvidenceSha256, secretHash, createdAtMs: now,
    expiresAtMs: now + RECOVERY_CHALLENGE_TTL_MS, passwordUpdatedAtBeforeMs: baseline.passwordUpdatedAtMs,
    deliveryState: 'PENDING', roles: account.roles };
  const reserved = await db.runTransaction(async tx => {
    const [controlSnapshot, accountSnapshot, previousSnapshot] = await Promise.all([
      tx.get(db.doc('operations/credentialAccessCutover')), tx.get(db.doc(`credentialAccess/${account.uid}`)), tx.get(requestRef),
    ]);
    const currentCutover = parseCutover(controlSnapshot.data()), current = parseAccount(accountSnapshot.data());
    if (!eligibleAccount(current, cutover.epoch) || current.uid !== account.uid || currentCutover.epoch !== cutover.epoch || current.recoveryEmail !== email
      || currentCutover.schema !== cutover.schema || (currentCutover.schema === 2 && !scopedAccountMatches(currentCutover, current))
      || current.channelEvidenceSha256 !== account.channelEvidenceSha256
      || current.roles.admin !== account.roles.admin || current.roles.superadmin !== account.roles.superadmin) return false;
    if (previousSnapshot.exists) {
      const previous: unknown = previousSnapshot.data();
      // Interrupted/uncertain delivery is operator-resolved. Never blindly resend it.
      if (!object(previous) || previous.schema !== cutover.schema || previous.uid !== account.uid || previous.epoch !== cutover.epoch
        || (previous.deliveryState !== 'SENT' && previous.deliveryState !== 'CONSUMED')
        || !safeTime(previous.expiresAtMs) || (previous.deliveryState === 'SENT' && previous.expiresAtMs > now)) return false;
    }
    tx.create(db.doc(`credentialRecoveryChallenges/${secretHash}`), challenge);
    tx.set(requestRef, { schema: cutover.schema, ...(cutover.schema === 2 ? { scope: JOHN_ADMIN_SCOPE } : {}), uid: account.uid, epoch: cutover.epoch, challengeHash: secretHash,
      deliveryState: 'PENDING', createdAtMs: now, expiresAtMs: challenge.expiresAtMs });
    return true;
  });
  if (!reserved) return;
  try {
    await sendOfficialPasswordReset(auth, email, recoveryContinueUrl(nonce));
    await recordDeliveryResult(db, requestRef.path, challenge, true);
  } catch {
    await recordDeliveryResult(db, requestRef.path, challenge, false);
  }
}
/** Mail nonce is the ownership proof; a newer password is only a reset-effect check. */
export async function completeCredentialRecovery(auth: Auth, db: Firestore, claims: unknown, nonce: unknown): Promise<SessionResponse> {
  const identity = verifiedClaimIdentity(claims);
  if (!identity || identity.provider !== 'password' || !validSecret(nonce) || !object(claims)) failedRecovery();
  const currentControl = parseCutover((await db.doc('operations/credentialAccessCutover').get()).data());
  if (currentControl.schema === 2) return completeScopedRecovery(auth, db, claims, nonce, currentControl);
  const secretHash = digest(nonce), challengeRef = db.doc(`credentialRecoveryChallenges/${secretHash}`);
  const challenge = parseChallenge((await challengeRef.get()).data());
  if (!challenge || challenge.schema !== 1 || challenge.secretHash !== secretHash || challenge.uid !== identity.uid
    || challenge.deliveryState === 'CONSUMED' || challenge.expiresAtMs <= Date.now()
    || normalizeRecoveryEmail(claims.email) !== challenge.email) failedRecovery();
  const user = await auth.getUser(identity.uid);
  if (user.disabled || normalizeRecoveryEmail(user.email) !== challenge.email) failedRecovery();
  const effect = await readPasswordUpdatedAt(auth, identity.uid);
  if (effect.email !== challenge.email || effect.passwordUpdatedAtMs <= challenge.passwordUpdatedAtBeforeMs
    || effect.passwordUpdatedAtMs < challenge.createdAtMs) failedRecovery();
  const account = await db.runTransaction(async tx => {
    const requestRef = db.doc(`credentialRecoveryRequests/${digest(`${challenge.epoch}:${identity.uid}`)}`);
    const [controlSnapshot, accountSnapshot, currentChallengeSnapshot, requestSnapshot] = await Promise.all([
      tx.get(db.doc('operations/credentialAccessCutover')), tx.get(db.doc(`credentialAccess/${identity.uid}`)), tx.get(challengeRef),
      tx.get(requestRef),
    ]);
    const control = parseCutover(controlSnapshot.data()), current = parseAccount(accountSnapshot.data());
    const currentChallenge = parseChallenge(currentChallengeSnapshot.data());
    if (control.schema !== 1 || !eligibleAccount(current, control.epoch) || current.schema !== 1
      || current.uid !== identity.uid || !currentChallenge || currentChallenge.schema !== 1 || currentChallenge.uid !== identity.uid
      || currentChallenge.secretHash !== secretHash || currentChallenge.epoch !== control.epoch
      || currentChallenge.deliveryState === 'CONSUMED' || currentChallenge.expiresAtMs <= Date.now()
      || requestSnapshot.get('schema') !== 1 || requestSnapshot.get('uid') !== identity.uid || requestSnapshot.get('epoch') !== control.epoch
      || requestSnapshot.get('challengeHash') !== secretHash || requestSnapshot.get('deliveryState') !== currentChallenge.deliveryState
      || current.recoveryEmail !== currentChallenge.email || current.channelEvidenceSha256 !== currentChallenge.channelEvidenceSha256
      || current.roles.admin !== currentChallenge.roles.admin || current.roles.superadmin !== currentChallenge.roles.superadmin) failedRecovery();
    const recovered: CredentialAccount = { ...current, status: 'RECOVERED' };
    tx.update(challengeRef, { deliveryState: 'CONSUMED', consumedAtMs: Date.now() });
    tx.update(requestRef, { deliveryState: 'CONSUMED', consumedAtMs: Date.now() });
    tx.set(db.doc(`credentialAccess/${identity.uid}`), recovered);
    return recovered;
  });
  return mintCredentialSession(auth, db, account, 'RECOVERY_CHANNEL');
}

/** The mail proof deterministically recovers one capability after an interrupted
 * response. Only its hash/locator is stored; consuming it and creating the session
 * are one Firestore transaction. A replay cannot create a second session. */
async function completeScopedRecovery(auth: Auth, db: Firestore, claims: Record<string, unknown>, nonce: string,
  expectedControl: Extract<CredentialCutover, { schema: 2 }>): Promise<SessionResponse> {
  const identity = verifiedClaimIdentity(claims);
  if (!identity || !scopedSubjectAllowed(expectedControl, identity.uid)) failedRecovery();
  const secretHash = digest(nonce), secret = scopedSecret(nonce, 'recovery');
  const locator = credentialSessionLocator(secret), challengeRef = db.doc(`credentialRecoveryChallenges/${secretHash}`);
  const challenge = parseChallenge((await challengeRef.get()).data());
  if (!challenge || challenge.schema !== 2 || challenge.scope !== JOHN_ADMIN_SCOPE || challenge.uid !== identity.uid
    || challenge.epoch !== expectedControl.epoch || challenge.secretHash !== secretHash
    || normalizeRecoveryEmail(claims.email) !== challenge.email) failedRecovery();
  const user = await auth.getUser(identity.uid);
  if (user.disabled || normalizeRecoveryEmail(user.email) !== challenge.email) failedRecovery();
  const effect = await readPasswordUpdatedAt(auth, identity.uid);
  const passwordBinding = await verifiedPasswordVersion(auth, claims);
  if (passwordBinding.versionMs !== effect.passwordUpdatedAtMs) failedRecovery();
  if (effect.email !== challenge.email || effect.passwordUpdatedAtMs <= challenge.passwordUpdatedAtBeforeMs
    || effect.passwordUpdatedAtMs < challenge.createdAtMs) failedRecovery();
  await db.runTransaction(async tx => {
    const accountRef = db.doc(`credentialAccess/${identity.uid}`), sessionRef = db.doc(`credentialSessions/${locator}`);
    const requestRef = db.doc(`credentialRecoveryRequests/${digest(`${challenge.epoch}:${identity.uid}`)}`);
    const [controlSnap, accountSnap, challengeSnap, requestSnap, sessionSnap] = await Promise.all([
      tx.get(db.doc('operations/credentialAccessCutover')), tx.get(accountRef), tx.get(challengeRef), tx.get(requestRef), tx.get(sessionRef),
    ]);
    const control = parseCutover(controlSnap.data()), account = parseAccount(accountSnap.data()), current = parseChallenge(challengeSnap.data());
    if (control.schema !== 2 || !scopedSubjectAllowed(control, identity.uid) || control.epoch !== expectedControl.epoch
      || !account || account.uid !== identity.uid || !scopedAccountMatches(control, account) || !current || current.schema !== 2
      || current.epoch !== control.epoch || current.uid !== identity.uid || current.secretHash !== secretHash
      || account.recoveryEmail !== current.email || account.channelEvidenceSha256 !== current.channelEvidenceSha256
      || account.roles.admin !== current.roles.admin || account.roles.superadmin !== current.roles.superadmin) failedRecovery();
    if (current.deliveryState === 'CONSUMED') {
      const committed = parseSession(sessionSnap.data());
      if (current.sessionLocator !== locator || !committed || !scopedSessionMatches(control, account, committed)
        || committed.expiresAtMs <= Date.now() || committed.expiresAtMs > Date.now() + CREDENTIAL_SESSION_TTL_MS) failedRecovery();
      if (!safeTime(current.consumedAtMs)
        || (requestSnap.get('challengeHash') === secretHash && !requestMatchesChallenge(requestSnap.data(), current))) failedRecovery();
      tx.update(challengeRef, { passwordBinding });
      tx.update(accountRef, { status: 'RECOVERED', passwordProof: {
        ...passwordBinding, challengeHash: secretHash, sessionLocator: locator, consumedAtMs: current.consumedAtMs,
      } });
      return;
    }
    // A later explicit request owns the per-UID guard. It cannot erase an
    // already committed result, but only its own unconsumed challenge may mint.
    // One actual admission instant governs both the expiry decision and its
    // persisted receipt; a later clock read must not produce an invalid closure.
    const consumedAtMs = Date.now();
    if (!requestMatchesChallenge(requestSnap.data(), current)
      || current.expiresAtMs <= consumedAtMs || sessionSnap.exists) failedRecovery();
    const session: CredentialSession = { schema: 2, scope: JOHN_ADMIN_SCOPE, capabilityFormat: HASHED_CAPABILITY_FORMAT,
      status: 'ACTIVE', uid: identity.uid, epoch: control.epoch, expiresAtMs: consumedAtMs + CREDENTIAL_SESSION_TTL_MS,
      proofKind: 'RECOVERY_CHANNEL', roles: account.roles };
    const receipt = { deliveryState: 'CONSUMED', consumedAtMs, sessionLocator: locator };
    // Validate the full persisted closure with the consumer's parser before any
    // write. This also rejects a clock regression preceding challenge creation.
    if (!parseChallenge({ ...current, ...receipt, passwordBinding })) failedRecovery();
    tx.update(challengeRef, { passwordBinding });
    tx.create(sessionRef, session); tx.update(challengeRef, receipt); tx.update(requestRef, receipt);
    tx.update(accountRef, { status: 'RECOVERED', passwordProof: {
      ...passwordBinding, challengeHash: secretHash, sessionLocator: locator, consumedAtMs: receipt.consumedAtMs,
    } });
  }, { maxAttempts: 1 });
  const passwordAfter = await verifiedPasswordVersion(auth, claims);
  if (passwordAfter.versionMs !== passwordBinding.versionMs) failedRecovery();
  return emitScopedSession(auth, db, identity.uid, secret);
}
