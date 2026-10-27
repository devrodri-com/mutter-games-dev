import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { CredentialAccessError, CREDENTIAL_SESSION_TTL_MS, HASHED_CAPABILITY_FORMAT, JOHN_ADMIN_SCOPE,
  normalizeRecoveryEmail, parseAccount, parseCutover, parseSession, type CredentialSession } from './credential-access-state.js';
import { credentialSessionLocator, scopedSecret, scopedSessionMatches } from './credential-capability.js';
import type { SessionResponse } from './credential-session.js';

function unavailable(): never {
  throw new CredentialAccessError(403, 'RECOVERY_REQUIRED', 'Necesitás recuperar el acceso. Tu cuenta y tus datos se conservan.');
}
/** Repeat delivery of one committed capability, never creation of a second one. */
export async function emitScopedSession(auth: Auth, db: Firestore, uid: string, secret: string, beforeIssue?: () => Promise<void>): Promise<SessionResponse> {
  const locator = credentialSessionLocator(secret);
  const [controlSnap, accountSnap, sessionSnap, user] = await Promise.all([
    db.doc('operations/credentialAccessCutover').get(), db.doc(`credentialAccess/${uid}`).get(),
    db.doc(`credentialSessions/${locator}`).get(), auth.getUser(uid),
  ]);
  const control = parseCutover(controlSnap.data()), account = parseAccount(accountSnap.data()), session = parseSession(sessionSnap.data());
  if (!account || account.uid !== uid || !session || !scopedSessionMatches(control, account, session)
    || session.expiresAtMs <= Date.now() || session.expiresAtMs > Date.now() + CREDENTIAL_SESSION_TTL_MS
    || user.uid !== uid || user.disabled || normalizeRecoveryEmail(user.email) !== account.recoveryEmail) unavailable();
  await beforeIssue?.();
  try {
    const customToken = await auth.createCustomToken(uid, { mutterCredentialSession: secret,
      mutterCredentialEpoch: control.epoch, mutterCredentialScope: JOHN_ADMIN_SCOPE,
      admin: session.roles.admin, superadmin: session.roles.superadmin });
    return { status: 'ACTIVE', uid, ...session.roles, expiresAtMs: session.expiresAtMs, scope: JOHN_ADMIN_SCOPE, customToken };
  } catch {
    // The committed locator remains recoverable with the same mail proof. No raw
    // secret is persisted and a signing error never creates another capability.
    throw new CredentialAccessError(503, 'SESSION_ISSUANCE_UNCERTAIN', 'No pudimos completar el acceso. Volvé a abrir el mismo enlace recibido; no solicites otro correo.');
  }
}

export async function renewScopedSession(auth: Auth, db: Firestore, uid: string, secret: string): Promise<SessionResponse> {
  const locator = credentialSessionLocator(secret), nextSecret = scopedSecret(secret, 'renewal');
  const nextLocator = credentialSessionLocator(nextSecret);
  const result = await db.runTransaction(async tx => {
    const parentRef = db.doc(`credentialSessions/${locator}`), nextRef = db.doc(`credentialSessions/${nextLocator}`);
    const [controlSnap, accountSnap, parentSnap, nextSnap] = await Promise.all([
      tx.get(db.doc('operations/credentialAccessCutover')), tx.get(db.doc(`credentialAccess/${uid}`)),
      tx.get(parentRef), tx.get(nextRef),
    ]);
    const control = parseCutover(controlSnap.data()), account = parseAccount(accountSnap.data()), parent = parseSession(parentSnap.data());
    if (!account || account.uid !== uid || !parent || !scopedSessionMatches(control, account, parent) || parent.expiresAtMs <= Date.now()) unavailable();
    if (parent.expiresAtMs - Date.now() > 12 * 60 * 60 * 1000) return { rotated: false, session: parent };
    if (parent.renewedToLocator !== undefined) {
      const next = parseSession(nextSnap.data());
      if (parent.renewedToLocator !== nextLocator || !next || !scopedSessionMatches(control, account, next)
        || next.expiresAtMs <= Date.now() || next.expiresAtMs > Date.now() + CREDENTIAL_SESSION_TTL_MS) unavailable();
      return { rotated: true, session: next };
    }
    if (nextSnap.exists) unavailable();
    const next: CredentialSession = { schema: 2, scope: JOHN_ADMIN_SCOPE, capabilityFormat: HASHED_CAPABILITY_FORMAT,
      status: 'ACTIVE', uid, epoch: control.epoch, proofKind: 'RECOVERY_CHANNEL', roles: account.roles,
      expiresAtMs: Date.now() + CREDENTIAL_SESSION_TTL_MS };
    tx.create(nextRef, next); tx.update(parentRef, { renewedToLocator: nextLocator });
    return { rotated: true, session: next };
  });
  if (!result.rotated) return { status: 'ACTIVE', uid, ...result.session.roles,
    expiresAtMs: result.session.expiresAtMs, scope: JOHN_ADMIN_SCOPE };
  return emitScopedSession(auth, db, uid, nextSecret);
}
