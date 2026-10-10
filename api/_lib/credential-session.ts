import { randomBytes } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { CREDENTIAL_SESSION_TTL_MS, CredentialAccessError, object, parseAccount, parseCutover, parseSession,
  validSecret, verifiedClaimIdentity, type CredentialAccount, type CredentialCutover, type CredentialProofKind, type CredentialRoles,
  type CredentialSession } from './credential-access-state.js';

export type CredentialAdmission = {
  uid: string; admin: boolean; superadmin: boolean; expiresAtMs: number; sessionId: string;
};
export type SessionResponse = {
  status: 'ACTIVE'; uid: string; admin: boolean; superadmin: boolean; expiresAtMs: number; customToken?: string;
};
function recoveryRequired(): never {
  throw new CredentialAccessError(403, 'RECOVERY_REQUIRED', 'Necesitás recuperar el acceso. Tu cuenta y tus datos se conservan.');
}
function admissionForState(claims: unknown, cutover: CredentialCutover, account: CredentialAccount | null,
  session: CredentialSession | null, destination: 'buyer' | 'admin'): CredentialAdmission {
  const identity = verifiedClaimIdentity(claims);
  if (!identity || identity.provider !== 'custom' || !object(claims) || !validSecret(claims.mutterCredentialSession)) recoveryRequired();
  if (!account || !session || account.uid !== identity.uid || session.uid !== identity.uid
    || account.epoch !== cutover.epoch || session.epoch !== cutover.epoch || claims.mutterCredentialEpoch !== cutover.epoch
    || session.expiresAtMs <= Date.now() || session.expiresAtMs > Date.now() + CREDENTIAL_SESSION_TTL_MS || account.status === 'PENDING'
    || (session.proofKind === 'NEW_POST_CUTOVER' && account.status !== 'NATIVE_POST_CUTOVER')
    || (session.proofKind === 'RECOVERY_CHANNEL' && (account.status !== 'RECOVERED' || account.channelStatus !== 'INDEPENDENTLY_VERIFIED'))) recoveryRequired();
  const admin = session.roles.admin && account.roles.admin && claims.admin === true;
  const superadmin = session.roles.superadmin && account.roles.superadmin && claims.superadmin === true;
  if (destination === 'admin' && !admin && !superadmin) {
    throw new CredentialAccessError(403, 'FORBIDDEN', 'No tenés permisos para acceder a la administración.');
  }
  return { uid: identity.uid, admin, superadmin, expiresAtMs: session.expiresAtMs,
    sessionId: claims.mutterCredentialSession };
}
/** Claims must already have passed Firebase verifyIdToken(token, true). */
export async function requireCredentialSession(_auth: Auth, db: Firestore, claims: unknown, destination: 'buyer' | 'admin'): Promise<CredentialAdmission> {
  const identity = verifiedClaimIdentity(claims);
  if (!identity || identity.provider !== 'custom' || !object(claims) || !validSecret(claims.mutterCredentialSession)) recoveryRequired();
  const sessionId = claims.mutterCredentialSession;
  const [cutoverSnapshot, accountSnapshot, sessionSnapshot] = await Promise.all([
    db.doc('operations/credentialAccessCutover').get(), db.doc(`credentialAccess/${identity.uid}`).get(),
    db.doc(`credentialSessions/${sessionId}`).get(),
  ]);
  return admissionForState(claims, parseCutover(cutoverSnapshot.data()), parseAccount(accountSnapshot.data()),
    parseSession(sessionSnapshot.data()), destination);
}

export async function mintCredentialSession(auth: Auth, db: Firestore, account: CredentialAccount, proofKind: CredentialProofKind): Promise<SessionResponse> {
  return issueCredentialSession(auth, db, account, proofKind);
}
/** Only a still-valid session can renew; checking state again in the issuance transaction closes revocation races. */
export async function renewCredentialSession(auth: Auth, db: Firestore, claims: unknown): Promise<SessionResponse> {
  const admission = await requireCredentialSession(auth, db, claims, 'buyer');
  if (admission.expiresAtMs - Date.now() > 12 * 60 * 60 * 1000) {
    return { status: 'ACTIVE', uid: admission.uid, admin: admission.admin, superadmin: admission.superadmin,
      expiresAtMs: admission.expiresAtMs };
  }
  const [accountSnapshot, sessionSnapshot] = await Promise.all([
    db.doc(`credentialAccess/${admission.uid}`).get(), db.doc(`credentialSessions/${admission.sessionId}`).get(),
  ]);
  const account = parseAccount(accountSnapshot.data()), session = parseSession(sessionSnapshot.data());
  if (!account || !session) recoveryRequired();
  return issueCredentialSession(auth, db, account, session.proofKind, { id: admission.sessionId, claims });
}
async function issueCredentialSession(auth: Auth, db: Firestore, account: CredentialAccount,
  proofKind: CredentialProofKind, source?: { id: string; claims: unknown }): Promise<SessionResponse> {
  const sessionId = randomBytes(32).toString('hex');
  const expiresAtMs = Date.now() + CREDENTIAL_SESSION_TTL_MS;
  const issuedRoles = await db.runTransaction(async tx => {
    const [controlSnapshot, accountSnapshot] = await Promise.all([
      tx.get(db.doc('operations/credentialAccessCutover')), tx.get(db.doc(`credentialAccess/${account.uid}`)),
    ]);
    const control = parseCutover(controlSnapshot.data());
    const current = parseAccount(accountSnapshot.data());
    if (!current || current.uid !== account.uid || current.epoch !== account.epoch || control.epoch !== account.epoch
      || current.status !== account.status || current.status === 'PENDING'
      || current.roles.admin !== account.roles.admin || current.roles.superadmin !== account.roles.superadmin) recoveryRequired();
    if ((proofKind === 'NEW_POST_CUTOVER' && current.status !== 'NATIVE_POST_CUTOVER')
      || (proofKind === 'RECOVERY_CHANNEL' && (current.status !== 'RECOVERED' || current.channelStatus !== 'INDEPENDENTLY_VERIFIED'))) recoveryRequired();
    let sessionRoles = account.roles;
    if (source) {
      const previous = parseSession((await tx.get(db.doc(`credentialSessions/${source.id}`))).data());
      const admitted = admissionForState(source.claims, control, current, previous, 'buyer');
      if (admitted.sessionId !== source.id || previous?.proofKind !== proofKind) recoveryRequired();
      sessionRoles = { admin: admitted.admin, superadmin: admitted.superadmin };
    }
    tx.create(db.doc(`credentialSessions/${sessionId}`), { schema: 1, status: 'ACTIVE', uid: account.uid,
      epoch: account.epoch, expiresAtMs, proofKind, roles: sessionRoles });
    return sessionRoles;
  });
  try {
    // Additional claims belong to this session; never grant persistent user claims.
    const customToken = await auth.createCustomToken(account.uid, {
      mutterCredentialSession: sessionId, mutterCredentialEpoch: account.epoch,
      admin: issuedRoles.admin, superadmin: issuedRoles.superadmin,
    });
    return { status: 'ACTIVE', uid: account.uid, ...issuedRoles, expiresAtMs, customToken };
  } catch {
    await db.doc(`credentialSessions/${sessionId}`).update({ status: 'ISSUANCE_UNCERTAIN' });
    throw new CredentialAccessError(503, 'SESSION_ISSUANCE_UNCERTAIN', 'No pudimos completar el acceso. Conservamos tu cuenta; volvé a recuperar el acceso.');
  }
}

/** Native sign-in only bootstraps a genuinely new account after issuer retirement. */
export async function createNativeSession(auth: Auth, db: Firestore, claims: unknown): Promise<SessionResponse> {
  const identity = verifiedClaimIdentity(claims);
  if (!identity || (identity.provider !== 'password' && identity.provider !== 'anonymous')) recoveryRequired();
  const cutover = parseCutover((await db.doc('operations/credentialAccessCutover').get()).data());
  const user = await auth.getUser(identity.uid);
  const createdAtMs = Date.parse(user.metadata.creationTime);
  if (user.disabled || !Number.isSafeInteger(createdAtMs) || createdAtMs <= cutover.legacyCutoffMs) recoveryRequired();
  const deniedRoles: CredentialRoles = { admin: false, superadmin: false };
  const account: CredentialAccount = { schema: 1, uid: identity.uid, epoch: cutover.epoch, status: 'NATIVE_POST_CUTOVER',
    recoveryEmail: null, channelStatus: 'UNVERIFIED', channelEvidenceSha256: null, roles: deniedRoles };
  await db.runTransaction(async tx => {
    const [controlSnapshot, currentSnapshot] = await Promise.all([
      tx.get(db.doc('operations/credentialAccessCutover')), tx.get(db.doc(`credentialAccess/${identity.uid}`)),
    ]);
    const currentCutover = parseCutover(controlSnapshot.data());
    if (currentCutover.epoch !== cutover.epoch || currentCutover.legacyCutoffMs !== cutover.legacyCutoffMs) recoveryRequired();
    if (currentSnapshot.exists) {
      const current = parseAccount(currentSnapshot.data());
      if (!current || current.uid !== identity.uid || current.status !== 'NATIVE_POST_CUTOVER' || current.epoch !== cutover.epoch
        || current.roles.admin || current.roles.superadmin) recoveryRequired();
    } else tx.create(db.doc(`credentialAccess/${identity.uid}`), account);
  });
  return mintCredentialSession(auth, db, account, 'NEW_POST_CUTOVER');
}
