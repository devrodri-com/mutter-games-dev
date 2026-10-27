import type { Auth, UserRecord } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { BUYER_SCOPE, CREDENTIAL_SESSION_TTL_MS, CredentialAccessError, HASHED_CAPABILITY_FORMAT,
  object, parseAccount, parseCutover, parseSession, safeTime, validSecret, verifiedClaimIdentity,
  type CredentialAccount, type CredentialCutover, type CredentialSession } from './credential-access-state.js';
import { buyerAccountMatches, buyerSecret, buyerSessionMatches, credentialSessionLocator, scopedSubjectAllowed } from './credential-capability.js';
import type { CredentialAdmission, SessionResponse } from './credential-session.js';

type Control = Extract<CredentialCutover, { schema: 2 }>;
const roles = { admin: false, superadmin: false } as const;
function denied(): never { throw new CredentialAccessError(403, 'RECOVERY_REQUIRED', 'No pudimos comprobar el acceso comprador. Tu cuenta y tus datos se conservan.'); }
function sameControl(current: CredentialCutover, expected: Control): current is Control {
  return current.schema === 2 && current.epoch === expected.epoch && current.legacyCutoffMs === expected.legacyCutoffMs
    && current.subjectUid === expected.subjectUid && current.additionalSubject?.uid === expected.additionalSubject?.uid
    && current.additionalSubject?.email === expected.additionalSubject?.email;
}
function nativeCreation(user: UserRecord, control: Control, uid: string, now: number): number {
  const created = Date.parse(user.metadata.creationTime);
  if (user.uid !== uid || user.disabled || user.customClaims?.admin === true || user.customClaims?.superadmin === true
    || !safeTime(created) || created > now || created <= control.legacyCutoffMs || scopedSubjectAllowed(control, uid)) denied();
  return created;
}
function sourceIdentity(claims: unknown): { uid: string; secret: string; claims: Record<string, unknown> } {
  const identity = verifiedClaimIdentity(claims);
  if (!identity || identity.provider !== 'custom' || !object(claims) || claims.mutterCredentialScope !== BUYER_SCOPE
    || !validSecret(claims.mutterCredentialSession) || claims.admin !== false || claims.superadmin !== false) denied();
  return { uid: identity.uid, secret: claims.mutterCredentialSession, claims };
}
function unrevokedSource(claims: Record<string, unknown>, user: UserRecord, now: number): void {
  if (!safeTime(claims.auth_time) || claims.auth_time > Math.floor(now / 1000)) denied();
  // The official Admin SDK exposes no tokensValidAfterTime when Auth has no
  // recorded revocation boundary (including a new anonymous identity). This is
  // the same distinction used by verifyIdToken(token, true), which remains the
  // HTTP entry authority. A present boundary is still checked on every reissue.
  if (user.tokensValidAfterTime === undefined) return;
  const revokedAt = Date.parse(user.tokensValidAfterTime);
  if (!Number.isFinite(revokedAt) || claims.auth_time * 1000 < revokedAt) denied();
}
function assertState(control: Control, account: CredentialAccount | null, session: CredentialSession | null,
  user: UserRecord, uid: string, now: number): { account: CredentialAccount; session: CredentialSession } {
  if (!account || account.uid !== uid || !session || !buyerSessionMatches(control, account, session)
    || account.nativeCreatedAtMs !== nativeCreation(user, control, uid, now)
    || session.expiresAtMs > now + CREDENTIAL_SESSION_TTL_MS) denied();
  return { account, session };
}
async function readState(auth: Auth, db: Firestore, uid: string, secret: string, expected: Control) {
  const locator = credentialSessionLocator(secret);
  const [controlSnap, accountSnap, sessionSnap, user] = await Promise.all([
    db.doc('operations/credentialAccessCutover').get(), db.doc(`credentialAccess/${uid}`).get(),
    db.doc(`credentialSessions/${locator}`).get(), auth.getUser(uid),
  ]);
  const control = parseCutover(controlSnap.data());
  if (!sameControl(control, expected)) denied();
  return { ...assertState(control, parseAccount(accountSnap.data()), parseSession(sessionSnap.data()), user, uid, Date.now()), user, locator };
}
function active(uid: string, session: CredentialSession): SessionResponse {
  return { status: 'ACTIVE', uid, ...roles, scope: BUYER_SCOPE, expiresAtMs: session.expiresAtMs };
}
async function emit(auth: Auth, db: Firestore, uid: string, secret: string, control: Control,
  beforeIssue: () => Promise<void>): Promise<SessionResponse> {
  const state = await readState(auth, db, uid, secret, control);
  if (state.session.expiresAtMs <= Date.now()) denied();
  await beforeIssue();
  try {
    const customToken = await auth.createCustomToken(uid, { mutterCredentialSession: secret,
      mutterCredentialEpoch: control.epoch, mutterCredentialScope: BUYER_SCOPE, ...roles });
    return { ...active(uid, state.session), customToken };
  } catch {
    // The same verified source derives this committed secret again. Never store
    // it, replace a failed signer with success, or create another capability.
    throw new CredentialAccessError(503, 'SESSION_ISSUANCE_UNCERTAIN', 'No pudimos completar el acceso. Volvé a verificar el mismo ingreso.');
  }
}

/** Only a newly created native Auth identity can bootstrap this buyer domain.
 * Existing schema1 or historical recovered accounts are never silently promoted. */
export async function createBuyerSession(auth: Auth, db: Firestore, claims: unknown, token: unknown,
  expected: Control): Promise<SessionResponse> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 16000) denied();
  const verified = await auth.verifyIdToken(token, true), identity = verifiedClaimIdentity(claims);
  if (!identity || verified.uid !== identity.uid || !['password', 'anonymous'].includes(identity.provider)
    || verified.firebase.sign_in_provider !== identity.provider || verified.admin === true || verified.superadmin === true) denied();
  const uid = identity.uid, secret = buyerSecret(token, 'native'), locator = credentialSessionLocator(secret);
  await db.runTransaction(async tx => {
    const [controlSnap, accountSnap, sessionSnap, user] = await Promise.all([
      tx.get(db.doc('operations/credentialAccessCutover')), tx.get(db.doc(`credentialAccess/${uid}`)),
      tx.get(db.doc(`credentialSessions/${locator}`)), auth.getUser(uid),
    ]);
    // Each attempt observes the clock after its reads, including a capability
    // committed by a later request while this request was waiting or retrying.
    const now = Date.now(), expiresAtMs = now + CREDENTIAL_SESSION_TTL_MS;
    const control = parseCutover(controlSnap.data());
    if (!sameControl(control, expected)) denied();
    const nativeCreatedAtMs = nativeCreation(user, control, uid, now);
    const account: CredentialAccount = { schema: 2, scope: BUYER_SCOPE, uid, epoch: control.epoch, status: 'NATIVE_POST_CUTOVER',
      recoveryEmail: null, channelStatus: 'UNVERIFIED', channelEvidenceSha256: null, roles, nativeCreatedAtMs };
    if (accountSnap.exists) {
      const previous = parseAccount(accountSnap.data());
      if (!buyerAccountMatches(control, previous) || previous?.uid !== uid || previous.nativeCreatedAtMs !== nativeCreatedAtMs) denied();
    }
    const session: CredentialSession = { schema: 2, scope: BUYER_SCOPE, capabilityFormat: HASHED_CAPABILITY_FORMAT,
      status: 'ACTIVE', uid, epoch: control.epoch, expiresAtMs, proofKind: 'NEW_POST_CUTOVER', roles, nativeCreatedAtMs };
    if (sessionSnap.exists) {
      const previous = parseSession(sessionSnap.data());
      if (!previous || !buyerSessionMatches(control, account, previous) || previous.expiresAtMs <= now
        || previous.expiresAtMs > now + CREDENTIAL_SESSION_TTL_MS) denied();
    } else tx.create(sessionSnap.ref, session);
    if (!accountSnap.exists) tx.create(accountSnap.ref, account);
  });
  return emit(auth, db, uid, secret, expected, async () => {
    const current = await auth.verifyIdToken(token, true);
    if (current.uid !== uid || current.firebase.sign_in_provider !== identity.provider) denied();
  });
}

export async function requireBuyerSession(auth: Auth, db: Firestore, claims: unknown, control: Control): Promise<CredentialAdmission> {
  const source = sourceIdentity(claims), state = await readState(auth, db, source.uid, source.secret, control);
  if (source.claims.mutterCredentialEpoch !== control.epoch || state.session.expiresAtMs <= Date.now()) denied();
  unrevokedSource(source.claims, state.user, Date.now());
  return { uid: source.uid, ...roles, scope: BUYER_SCOPE, sessionId: state.locator, expiresAtMs: state.session.expiresAtMs };
}

/** One source has one deterministic child. A live capability rotates only near
 * expiry; an expired native buyer can reenter without changing UID or data.
 * Revoked/missing parents and expired already-issued children are never revived. */
export async function resumeBuyerSession(auth: Auth, db: Firestore, claims: unknown, expected: Control,
  allowExpired = true): Promise<SessionResponse> {
  const source = sourceIdentity(claims), state = await readState(auth, db, source.uid, source.secret, expected);
  const observedAt = Date.now();
  if (source.claims.mutterCredentialEpoch !== expected.epoch || !allowExpired && state.session.expiresAtMs <= observedAt) denied();
  unrevokedSource(source.claims, state.user, observedAt);
  if (state.session.expiresAtMs - observedAt > 12 * 60 * 60 * 1000) return active(source.uid, state.session);
  const nextSecret = buyerSecret(source.secret, 'renewal'), nextLocator = credentialSessionLocator(nextSecret);
  await db.runTransaction(async tx => {
    const parentRef = db.doc(`credentialSessions/${state.locator}`), nextRef = db.doc(`credentialSessions/${nextLocator}`);
    const [controlSnap, accountSnap, parentSnap, nextSnap, user] = await Promise.all([
      tx.get(db.doc('operations/credentialAccessCutover')), tx.get(db.doc(`credentialAccess/${source.uid}`)),
      tx.get(parentRef), tx.get(nextRef), auth.getUser(source.uid),
    ]);
    const now = Date.now();
    const control = parseCutover(controlSnap.data());
    if (!sameControl(control, expected)) denied();
    const current = assertState(control, parseAccount(accountSnap.data()), parseSession(parentSnap.data()), user, source.uid, now);
    unrevokedSource(source.claims, user, now);
    if (!allowExpired && current.session.expiresAtMs <= now) denied();
    if (current.session.renewedToLocator !== undefined) {
      const next = parseSession(nextSnap.data());
      if (current.session.renewedToLocator !== nextLocator || !next || !buyerSessionMatches(control, current.account, next)
        || next.expiresAtMs <= now || next.expiresAtMs > now + CREDENTIAL_SESSION_TTL_MS) denied();
      return;
    }
    if (nextSnap.exists) denied();
    tx.create(nextRef, { schema: 2, scope: BUYER_SCOPE, capabilityFormat: HASHED_CAPABILITY_FORMAT,
      status: 'ACTIVE', uid: source.uid, epoch: control.epoch, proofKind: 'NEW_POST_CUTOVER', roles,
      expiresAtMs: now + CREDENTIAL_SESSION_TTL_MS, nativeCreatedAtMs: current.account.nativeCreatedAtMs });
    tx.update(parentRef, { renewedToLocator: nextLocator });
  });
  return emit(auth, db, source.uid, nextSecret, expected, async () => {
    unrevokedSource(source.claims, await auth.getUser(source.uid), Date.now());
  });
}
