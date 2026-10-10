import { createHash, randomBytes } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { CredentialAccessError, RECOVERY_CHALLENGE_TTL_MS, normalizeRecoveryEmail, object, parseAccount, parseCutover,
  safeTime, validEpoch, validSecret, validUid, verifiedClaimIdentity, type CredentialAccount } from './credential-access-state.js';
import { readPasswordUpdatedAt, sendOfficialPasswordReset } from './credential-auth-rest.js';
import { mintCredentialSession, type SessionResponse } from './credential-session.js';

type RecoveryChallenge = {
  schema: 1; uid: string; epoch: string; email: string; channelEvidenceSha256: string; secretHash: string;
  createdAtMs: number; expiresAtMs: number; passwordUpdatedAtBeforeMs: number;
  deliveryState: 'PENDING' | 'SENT' | 'UNCERTAIN' | 'CONSUMED'; roles: CredentialAccount['roles'];
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function failedRecovery(): never {
  throw new CredentialAccessError(403, 'RECOVERY_NOT_COMPLETED', 'No pudimos completar ese acceso. Pedí una recuperación nueva desde la tienda.');
}
function parseChallenge(value: unknown): RecoveryChallenge | null {
  if (!object(value) || value.schema !== 1 || !validUid(value.uid) || !validEpoch(value.epoch)
    || !validSecret(value.secretHash) || !validSecret(value.channelEvidenceSha256)
    || !safeTime(value.createdAtMs) || !safeTime(value.expiresAtMs) || !safeTime(value.passwordUpdatedAtBeforeMs)
    || value.expiresAtMs <= value.createdAtMs || value.expiresAtMs > value.createdAtMs + RECOVERY_CHALLENGE_TTL_MS
    || (value.deliveryState !== 'PENDING' && value.deliveryState !== 'SENT' && value.deliveryState !== 'UNCERTAIN' && value.deliveryState !== 'CONSUMED') || !object(value.roles)
    || typeof value.roles.admin !== 'boolean' || typeof value.roles.superadmin !== 'boolean') return null;
  const email = normalizeRecoveryEmail(value.email);
  if (!email) return null;
  const deliveryState = value.deliveryState === 'SENT' ? 'SENT' : value.deliveryState === 'UNCERTAIN' ? 'UNCERTAIN' : value.deliveryState === 'CONSUMED' ? 'CONSUMED' : 'PENDING';
  return { schema: 1, uid: value.uid, epoch: value.epoch, email, channelEvidenceSha256: value.channelEvidenceSha256,
    secretHash: value.secretHash, createdAtMs: value.createdAtMs, expiresAtMs: value.expiresAtMs,
    passwordUpdatedAtBeforeMs: value.passwordUpdatedAtBeforeMs, deliveryState,
    roles: { admin: value.roles.admin, superadmin: value.roles.superadmin } };
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
  const matches = await db.collection('credentialAccess').where('recoveryEmail', '==', email).limit(2).get();
  if (matches.size !== 1) return;
  const account = parseAccount(matches.docs[0].data());
  if (!eligibleAccount(account, cutover.epoch) || account.recoveryEmail !== email || matches.docs[0].id !== account.uid) return;
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
  const challenge: RecoveryChallenge = { schema: 1, uid: account.uid, epoch: cutover.epoch, email,
    channelEvidenceSha256: account.channelEvidenceSha256, secretHash, createdAtMs: now,
    expiresAtMs: now + RECOVERY_CHALLENGE_TTL_MS, passwordUpdatedAtBeforeMs: baseline.passwordUpdatedAtMs,
    deliveryState: 'PENDING', roles: account.roles };
  const reserved = await db.runTransaction(async tx => {
    const [controlSnapshot, accountSnapshot, previousSnapshot] = await Promise.all([
      tx.get(db.doc('operations/credentialAccessCutover')), tx.get(db.doc(`credentialAccess/${account.uid}`)), tx.get(requestRef),
    ]);
    const currentCutover = parseCutover(controlSnapshot.data()), current = parseAccount(accountSnapshot.data());
    if (!eligibleAccount(current, cutover.epoch) || current.uid !== account.uid || currentCutover.epoch !== cutover.epoch || current.recoveryEmail !== email
      || current.channelEvidenceSha256 !== account.channelEvidenceSha256
      || current.roles.admin !== account.roles.admin || current.roles.superadmin !== account.roles.superadmin) return false;
    if (previousSnapshot.exists) {
      const previous: unknown = previousSnapshot.data();
      // Interrupted/uncertain delivery is operator-resolved. Never blindly resend it.
      if (!object(previous) || previous.schema !== 1 || previous.uid !== account.uid || previous.epoch !== cutover.epoch
        || (previous.deliveryState !== 'SENT' && previous.deliveryState !== 'CONSUMED')
        || !safeTime(previous.expiresAtMs) || (previous.deliveryState === 'SENT' && previous.expiresAtMs > now)) return false;
    }
    tx.create(db.doc(`credentialRecoveryChallenges/${secretHash}`), challenge);
    tx.set(requestRef, { schema: 1, uid: account.uid, epoch: cutover.epoch, challengeHash: secretHash,
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
  const secretHash = digest(nonce), challengeRef = db.doc(`credentialRecoveryChallenges/${secretHash}`);
  const challenge = parseChallenge((await challengeRef.get()).data());
  if (!challenge || challenge.secretHash !== secretHash || challenge.uid !== identity.uid
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
    if (!eligibleAccount(current, control.epoch) || current.uid !== identity.uid || !currentChallenge || currentChallenge.uid !== identity.uid
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
