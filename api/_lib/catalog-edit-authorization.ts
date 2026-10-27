import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { requireCredentialSession } from './credential-session.js';
import { CREDENTIAL_SESSION_TTL_MS, JOHN_ADMIN_SCOPE, normalizeRecoveryEmail, parseAccount,
  parseCutover, parseSession } from './credential-access-state.js';
import { scopedSessionMatches } from './credential-capability.js';
import { CatalogEditError, object } from './catalog-edit-policy.js';

export type Editor = { uid: string; sessionId: string; claims: DecodedIdToken; token: string };
const forbidden = (): never => { throw new CatalogEditError(403, 'CATALOG_EDIT_FORBIDDEN', 'No pudimos comprobar el permiso para editar.'); };
export async function authenticateEditor(auth: Auth, db: Firestore, header: unknown): Promise<Editor> {
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length <= 7 || header.length > 16000)
    throw new CatalogEditError(401, 'INVALID_SESSION', 'Volvé a iniciar sesión para editar.');
  const token = header.slice(7);
  let claims: DecodedIdToken;
  try { claims = await auth.verifyIdToken(token, true); }
  catch { throw new CatalogEditError(401, 'INVALID_SESSION', 'La sesión no está vigente. Volvé a ingresar.'); }
  const admission = await requireCredentialSession(auth, db, claims, 'admin');
  if (admission.scope !== JOHN_ADMIN_SCOPE || !(admission.admin || admission.superadmin)) forbidden();
  return { uid: admission.uid, sessionId: admission.sessionId, claims, token };
}
/** Scoped catalogue edits coexist with closed purchases, sales and payment
 * reconciliation. Each save revalidates this control inside its transaction and
 * protects existing reservations; this does not grant checkout admission. */
export function assertCatalogWriteControl(value: unknown): void {
  if (!object(value) || value.schema !== 1 || (value.state !== 'closed' && value.state !== 'open' && value.state !== 'reconciling')
    || typeof value.revision !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(value.revision)
    || !object(value.updatedAt) || typeof value.updatedAt.toMillis !== 'function'
    || !Number.isFinite(value.updatedAt.toMillis())) throw new CatalogEditError(503, 'CATALOG_EDIT_CONTROL_UNAVAILABLE',
    'No pudimos comprobar que la edición esté habilitada. No se envió otra edición.');
}
export async function revalidateEditor(auth: Auth, db: Firestore, editor: Editor, tx?: Transaction): Promise<void> {
  // Recheck Auth on every transaction attempt; Firestore state is read inside
  // that transaction so a concurrent epoch/session/account change aborts it.
  const claims = await auth.verifyIdToken(editor.token, true).catch(() => forbidden());
  const user = await auth.getUser(editor.uid);
  const read = (path: string) => tx ? tx.get(db.doc(path)) : db.doc(path).get();
  const [controlSnap, accountSnap, sessionSnap, webSnap] = await Promise.all([
    read('operations/credentialAccessCutover'), read(`credentialAccess/${editor.uid}`),
    read(`credentialSessions/${editor.sessionId}`), read('operations/webStockCutover'),
  ]);
  const control = parseCutover(controlSnap.data()), account = parseAccount(accountSnap.data());
  const session = parseSession(sessionSnap.data());
  if (control.schema !== 2 || !account || !session || account.uid !== editor.uid || claims.uid !== editor.uid
    || !scopedSessionMatches(control, account, session) || claims.firebase.sign_in_provider !== 'custom'
    || claims.mutterCredentialEpoch !== control.epoch || claims.mutterCredentialScope !== JOHN_ADMIN_SCOPE
    || claims.mutterCredentialSession !== editor.claims.mutterCredentialSession
    || claims.admin !== account.roles.admin || claims.superadmin !== account.roles.superadmin
    || session.expiresAtMs <= Date.now() || session.expiresAtMs > Date.now() + CREDENTIAL_SESSION_TTL_MS
    || user.uid !== editor.uid || user.disabled || normalizeRecoveryEmail(user.email) !== account.recoveryEmail
    || normalizeRecoveryEmail(claims.email) !== account.recoveryEmail) forbidden();
  assertCatalogWriteControl(webSnap.data());
}
