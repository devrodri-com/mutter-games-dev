import { beforeAuthStateChanged, signInWithCustomToken, type User } from 'firebase/auth';
import { auth } from '../firebase';

export type CredentialAdmission = {
  status: 'ACTIVE'; uid: string; admin: boolean; superadmin: boolean; expiresAtMs: number;
  scope?: 'JOHN_ADMIN_CLOSED_V1' | 'BUYER_POST_CUTOVER_V1';
};
export type LegacyGuestNewPurchase = { kind: 'LEGACY_ANONYMOUS'; uid: string; epoch: string };
export class CredentialAccessError extends Error {
  constructor(public readonly code: 'RECOVERY_REQUIRED' | 'ACCESS_UNAVAILABLE', message: string,
    public readonly newPurchase: LegacyGuestNewPurchase | null = null) { super(message); }
}
const inflight = new Map<string, Promise<CredentialAdmission>>();
let recoveryNonce: string | null = null;
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function admission(value: unknown, uid: string): CredentialAdmission {
  if (!object(value) || value.status !== 'ACTIVE' || value.uid !== uid || typeof value.admin !== 'boolean' || typeof value.superadmin !== 'boolean' || typeof value.expiresAtMs !== 'number' || !Number.isFinite(value.expiresAtMs) || value.expiresAtMs <= Date.now()) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'No pudimos comprobar el acceso. Tu cuenta y tus datos se conservan.');
  if ('scope' in value && value.scope !== 'JOHN_ADMIN_CLOSED_V1' && value.scope !== 'BUYER_POST_CUTOVER_V1'
    || value.scope === 'BUYER_POST_CUTOVER_V1' && (value.admin !== false || value.superadmin !== false))
    throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'No pudimos comprobar el alcance del acceso.');
  return { status: 'ACTIVE', uid, admin: value.admin, superadmin: value.superadmin, expiresAtMs: value.expiresAtMs,
    ...(value.scope === 'JOHN_ADMIN_CLOSED_V1' || value.scope === 'BUYER_POST_CUTOVER_V1' ? { scope: value.scope } : {}) };
}
async function post(path: string, user: User, body: Record<string, string>): Promise<unknown> {
  const token = await user.getIdToken();
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), cache: 'no-store' });
  if (!response.ok) {
    if (response.status === 403) {
      const result: unknown = await response.json();
      if (auth.currentUser?.uid !== user.uid) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Cambió la cuenta durante el ingreso. Intentá nuevamente.');
      const offered = object(result) ? result.newPurchase : null;
      const newPurchase: LegacyGuestNewPurchase | null = object(result) && result.code === 'RECOVERY_REQUIRED'
        && object(offered) && offered.kind === 'LEGACY_ANONYMOUS' && offered.uid === user.uid
        && typeof offered.epoch === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(offered.epoch)
        ? { kind: 'LEGACY_ANONYMOUS', uid: user.uid, epoch: offered.epoch } : null;
      throw new CredentialAccessError('RECOVERY_REQUIRED', 'Tu cuenta y tus datos se conservan. Necesitás recuperar el acceso para continuar.', newPurchase);
    }
    if (response.status === 503 && path === '/api/access/recovery/complete') {
      const failure: unknown = await response.json();
      if (object(failure) && failure.code === 'SESSION_ISSUANCE_UNCERTAIN') {
        throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'No pudimos completar el acceso. Volvé a ingresar usando este mismo enlace; no solicites otro correo.');
      }
    }
    throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'No pudimos comprobar el acceso. Intentá nuevamente.');
  }
  if (auth.currentUser?.uid !== user.uid) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Cambió la cuenta durante el ingreso. Intentá nuevamente.');
  const result: unknown = await response.json();
  if (auth.currentUser?.uid !== user.uid) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Cambió la cuenta durante el ingreso. Intentá nuevamente.');
  return result;
}
async function exchange(user: User, result: unknown): Promise<CredentialAdmission> {
  const parsed = admission(result, user.uid);
  if (auth.currentUser?.uid !== user.uid) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Cambió la cuenta durante el ingreso. Intentá nuevamente.');
  if (object(result) && typeof result.customToken === 'string') {
    // Block applying this exchange if another account signed in while the real
    // Auth HTTP request was pending. Other accounts remain free to sign in.
    const stop = beforeAuthStateChanged(auth, next => {
      if (next?.uid === user.uid && auth.currentUser?.uid !== user.uid) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Cambió la cuenta durante el ingreso. Intentá nuevamente.');
    });
    let credential;
    try { credential = await signInWithCustomToken(auth, result.customToken); }
    catch (error: unknown) {
      if (auth.currentUser?.uid !== user.uid) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Cambió la cuenta durante el ingreso. Intentá nuevamente.');
      throw error;
    } finally { stop(); }
    if (credential.user.uid !== user.uid) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'No pudimos comprobar la misma cuenta.');
    const confirmed = await post('/api/access/session', credential.user, {});
    if (object(confirmed) && 'customToken' in confirmed) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'No pudimos confirmar el acceso.');
    return admission(confirmed, user.uid);
  }
  return parsed;
}
export function ensureCredentialSession(user: User): Promise<CredentialAdmission> {
  const existing = inflight.get(user.uid);
  if (existing) return existing;
  const request = post('/api/access/session', user, {}).then(result => exchange(user, result)).finally(() => inflight.delete(user.uid));
  inflight.set(user.uid, request);
  return request;
}
export async function requestCredentialRecovery(email: string): Promise<void> {
  const response = await fetch('/api/access/recovery/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }), cache: 'no-store' });
  if (response.status !== 202) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'No pudimos recibir la solicitud. Intentá nuevamente.');
}
export async function completeCredentialRecovery(user: User, nonce: string): Promise<CredentialAdmission> {
  // Settle the token observer's earlier admission check before replacing this same user's token.
  await inflight.get(user.uid)?.catch(() => undefined);
  return exchange(user, await post('/api/access/recovery/complete', user, { nonce }));
}
export function captureRecoveryNonce(): string | null {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const candidate = hash.get('recovery');
  if (candidate !== null) {
    recoveryNonce = /^[a-f0-9]{64}$/.test(candidate) ? candidate : null;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return recoveryNonce;
}
export function discardRecoveryNonce(): void { recoveryNonce = null; }
