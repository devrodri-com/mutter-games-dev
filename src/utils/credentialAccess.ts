import { signInWithCustomToken, type User } from 'firebase/auth';
import { auth } from '../firebase';

export type CredentialAdmission = {
  status: 'ACTIVE'; uid: string; admin: boolean; superadmin: boolean; expiresAtMs: number;
};
export class CredentialAccessError extends Error {
  constructor(public readonly code: 'RECOVERY_REQUIRED' | 'ACCESS_UNAVAILABLE', message: string) { super(message); }
}
const inflight = new Map<string, Promise<CredentialAdmission>>();
let recoveryNonce: string | null = null;
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function admission(value: unknown, uid: string): CredentialAdmission {
  if (!object(value) || value.status !== 'ACTIVE' || value.uid !== uid || typeof value.admin !== 'boolean' || typeof value.superadmin !== 'boolean' || typeof value.expiresAtMs !== 'number' || !Number.isFinite(value.expiresAtMs) || value.expiresAtMs <= Date.now()) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'No pudimos comprobar el acceso. Tu cuenta y tus datos se conservan.');
  return { status: 'ACTIVE', uid, admin: value.admin, superadmin: value.superadmin, expiresAtMs: value.expiresAtMs };
}
async function post(path: string, user: User, body: Record<string, string>): Promise<unknown> {
  const token = await user.getIdToken();
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), cache: 'no-store' });
  if (!response.ok) {
    if (response.status === 403) throw new CredentialAccessError('RECOVERY_REQUIRED', 'Tu cuenta y tus datos se conservan. Necesitás recuperar el acceso para continuar.');
    throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'No pudimos comprobar el acceso. Intentá nuevamente.');
  }
  if (auth.currentUser?.uid !== user.uid) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Cambió la cuenta durante el ingreso. Intentá nuevamente.');
  return response.json();
}
async function exchange(user: User, result: unknown): Promise<CredentialAdmission> {
  const parsed = admission(result, user.uid);
  if (object(result) && typeof result.customToken === 'string') {
    const credential = await signInWithCustomToken(auth, result.customToken);
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
