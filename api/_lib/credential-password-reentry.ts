import { createHash } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { CredentialAccessError, CREDENTIAL_SESSION_TTL_MS, HASHED_CAPABILITY_FORMAT, JOHN_ADMIN_SCOPE,
  normalizeRecoveryEmail, object, parseAccount, parseCutover, parseSession, safeTime, validSecret,
  verifiedClaimIdentity, type PasswordBinding, type CredentialSession } from './credential-access-state.js';
import { readPasswordUpdatedAt } from './credential-auth-rest.js';
import { credentialSessionLocator, scopedSessionMatches } from './credential-capability.js';
import { parseChallenge, requestMatchesChallenge } from './credential-recovery-state.js';
import { emitScopedSession } from './credential-scoped-session.js';
import type { SessionResponse } from './credential-session.js';

function denied(): never {
  throw new CredentialAccessError(403, 'RECOVERY_REQUIRED', 'Necesitás completar el acceso con el enlace recibido. Tu cuenta y tus datos se conservan.');
}
/** Auth timestamps are seconds. Authentication in the password-change second
 * cannot prove which password was used, even when the token is unrevoked. */
export async function verifiedPasswordVersion(auth: Auth, claims: unknown): Promise<PasswordBinding> {
  const identity = verifiedClaimIdentity(claims);
  if (!identity || identity.provider !== 'password' || !object(claims) || !safeTime(claims.auth_time)
    || claims.auth_time > Math.floor(Date.now() / 1000)) denied();
  const [user, effect] = await Promise.all([auth.getUser(identity.uid), readPasswordUpdatedAt(auth, identity.uid)]);
  const email = normalizeRecoveryEmail(claims.email), revokedAt = Date.parse(user.tokensValidAfterTime ?? '');
  if (!email || user.uid !== identity.uid || user.disabled || normalizeRecoveryEmail(user.email) !== email
    || effect.email !== email || !Number.isFinite(revokedAt) || claims.auth_time * 1000 < revokedAt) denied();
  if (claims.auth_time <= Math.floor(effect.passwordUpdatedAtMs / 1000)) {
    throw new CredentialAccessError(401, 'REAUTHENTICATION_REQUIRED', 'Volvé a ingresar con tu contraseña usando este mismo enlace. No necesitás otro correo.');
  }
  return { versionMs: effect.passwordUpdatedAtMs, authTimeSeconds: claims.auth_time };
}

/** A password version is trusted only after the independent mail proof pinned
 * it. RECOVERED, a recent password timestamp, and public locator values alone
 * never authorize password reentry. The bearer token is kept only in memory. */
export async function createScopedPasswordSession(auth: Auth, db: Firestore, token: unknown): Promise<SessionResponse> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 16000) denied();
  const claims = await auth.verifyIdToken(token, true);
  const password = await verifiedPasswordVersion(auth, claims);
  const secret = createHash('sha256').update(`${JOHN_ADMIN_SCOPE}\0password-reentry\0${token}`).digest('hex');
  const locator = credentialSessionLocator(secret), sessionRef = db.doc(`credentialSessions/${locator}`);
  const control = parseCutover((await db.doc('operations/credentialAccessCutover').get()).data());
  const requestId = createHash('sha256').update(`${control.epoch}:${claims.uid}`).digest('hex');
  const requestRef = db.doc(`credentialRecoveryRequests/${requestId}`);
  const admit = async (tx: Transaction, create: boolean): Promise<void> => {
    const [controlSnap, accountSnap, requestSnap, sessionSnap] = await Promise.all([
      tx.get(db.doc('operations/credentialAccessCutover')), tx.get(db.doc(`credentialAccess/${claims.uid}`)),
      tx.get(requestRef), tx.get(sessionRef),
    ]);
    const current = parseCutover(controlSnap.data()), account = parseAccount(accountSnap.data());
    const proof = account?.passwordProof;
    const guardHash: unknown = requestSnap.get('challengeHash');
    if (current.schema !== 2 || current.epoch !== control.epoch || !account || account.uid !== claims.uid
      || !proof || !validSecret(guardHash)) denied();
    const challenge = parseChallenge((await tx.get(db.doc(`credentialRecoveryChallenges/${proof.challengeHash}`))).data());
    if (!challenge || challenge.schema !== 2 || challenge.secretHash !== proof.challengeHash
      || challenge.uid !== claims.uid || challenge.epoch !== current.epoch
      || challenge.deliveryState !== 'CONSUMED' || challenge.consumedAtMs !== proof.consumedAtMs
      || challenge.sessionLocator !== proof.sessionLocator || challenge.email !== account.recoveryEmail
      || normalizeRecoveryEmail(claims.email) !== account.recoveryEmail
      || challenge.channelEvidenceSha256 !== account.channelEvidenceSha256
      || challenge.roles.admin !== account.roles.admin || challenge.roles.superadmin !== account.roles.superadmin) denied();
    // A public request may replace the delivery guard, never the completed
    // password proof. Validate whichever challenge the guard currently names.
    const guarded = guardHash === proof.challengeHash ? challenge
      : parseChallenge((await tx.get(db.doc(`credentialRecoveryChallenges/${guardHash}`))).data());
    if (!guarded || guarded.secretHash !== guardHash || guarded.uid !== claims.uid || guarded.epoch !== current.epoch
      || guarded.schema !== 2 || !requestMatchesChallenge(requestSnap.data(), guarded)
      || guarded.email !== account.recoveryEmail || guarded.channelEvidenceSha256 !== account.channelEvidenceSha256
      || guarded.roles.admin !== account.roles.admin || guarded.roles.superadmin !== account.roles.superadmin) denied();
    const binding = challenge.passwordBinding;
    const root = parseSession((await tx.get(db.doc(`credentialSessions/${proof.sessionLocator}`))).data());
    if (!binding || binding.versionMs !== proof.versionMs || binding.authTimeSeconds !== proof.authTimeSeconds
      || proof.versionMs !== password.versionMs || password.authTimeSeconds < proof.authTimeSeconds
      || !root || !scopedSessionMatches(current, account, root)) denied();
    // Expiry limits possession of the old capability. A newly authenticated,
    // pinned password may create a fresh session; explicit revocation may not.
    if (sessionSnap.exists) {
      const previous = parseSession(sessionSnap.data());
      if (!previous || !scopedSessionMatches(current, account, previous) || previous.expiresAtMs <= Date.now()
        || previous.expiresAtMs > Date.now() + CREDENTIAL_SESSION_TTL_MS) denied();
      return;
    }
    if (!create) denied();
    const session: CredentialSession = { schema: 2, scope: JOHN_ADMIN_SCOPE, capabilityFormat: HASHED_CAPABILITY_FORMAT,
      status: 'ACTIVE', uid: claims.uid, epoch: current.epoch, expiresAtMs: Date.now() + CREDENTIAL_SESSION_TTL_MS,
      proofKind: 'RECOVERY_CHANNEL', roles: account.roles };
    tx.create(sessionRef, session);
  };
  await db.runTransaction(tx => admit(tx, true), { maxAttempts: 1 });
  const freshClaims = await auth.verifyIdToken(token, true);
  const currentPassword = await verifiedPasswordVersion(auth, freshClaims);
  if (currentPassword.versionMs !== password.versionMs || freshClaims.uid !== claims.uid) denied();
  return emitScopedSession(auth, db, claims.uid, secret, async () => {
    await db.runTransaction(tx => admit(tx, false), { maxAttempts: 1 });
  });
}
