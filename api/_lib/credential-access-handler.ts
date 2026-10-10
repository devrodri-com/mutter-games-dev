import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { CredentialAccessError, object } from './credential-access-state.js';
import { createNativeSession, renewCredentialSession, type SessionResponse } from './credential-session.js';
import { completeCredentialRecovery, requestCredentialRecovery } from './credential-recovery.js';
export type AccessRequest = { method?: string; headers: Record<string, unknown>; body?: unknown };
export type AccessResponse = { setHeader(name: string, value: string): unknown; status(code: number): AccessResponse; json(body: unknown): unknown };
export type AccessAction = 'session' | 'request' | 'complete';
function input(value: unknown): Record<string, unknown> {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value ?? {};
  if (!object(parsed)) throw new CredentialAccessError(400, 'INVALID_INPUT', 'Revisá los datos e intentá nuevamente.');
  return parsed;
}
function keys(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new CredentialAccessError(400, 'INVALID_INPUT', 'Revisá los datos e intentá nuevamente.');
}
async function verifiedClaims(auth: Auth, req: AccessRequest): Promise<DecodedIdToken> {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 16000) throw new CredentialAccessError(401, 'INVALID_SESSION', 'Volvé a iniciar sesión para continuar.');
  try { return await auth.verifyIdToken(header.slice(7), true); }
  catch { throw new CredentialAccessError(401, 'INVALID_SESSION', 'Volvé a iniciar sesión para continuar.'); }
}
export async function handleCredentialAccess(action: AccessAction, auth: Auth, db: Firestore, req: AccessRequest, res: AccessResponse): Promise<unknown> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'POST') return res.status(405).json({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
  try {
    const body = input(req.body);
    if (action === 'request') {
      keys(body, ['email']);
      await requestCredentialRecovery(auth, db, body.email);
      return res.status(202).json({ status: 'REQUEST_RECEIVED' });
    }
    const claims = await verifiedClaims(auth, req);
    if (action === 'complete') {
      keys(body, ['nonce']);
      return res.status(200).json(await completeCredentialRecovery(auth, db, claims, body.nonce));
    }
    keys(body, []);
    let result: SessionResponse;
    if (claims.firebase.sign_in_provider === 'password' || claims.firebase.sign_in_provider === 'anonymous') {
      // Linking an admitted guest preserves the UID. Native reentry still needs
      // authoritative creation after the cutoff and protected roles=false.
      result = await createNativeSession(auth, db, claims);
    } else {
      result = await renewCredentialSession(auth, db, claims);
    }
    return res.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof CredentialAccessError) return res.status(error.status).json({ code: error.code, error: error.message });
    if (error instanceof SyntaxError) return res.status(400).json({ code: 'INVALID_INPUT', error: 'Revisá los datos e intentá nuevamente.' });
    return res.status(503).json({ code: 'ACCESS_UNAVAILABLE', error: 'No pudimos comprobar el acceso. Tu cuenta y tus datos se conservan.' });
  }
}
