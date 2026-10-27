import type { Auth } from 'firebase-admin/auth';
import { CredentialAccessError, normalizeRecoveryEmail, object, safeTime } from './credential-access-state.js';

function authEndpoint(auth: Auth): { origin: string; projectId: string; emulator: boolean } {
  const projectId = auth.app.options.projectId ?? process.env.FIREBASE_PROJECT_ID;
  if (!projectId || !/^[a-z][a-z0-9-]{4,60}$/.test(projectId)) throw new CredentialAccessError(503, 'AUTH_CONFIGURATION_UNAVAILABLE', 'No pudimos preparar la recuperación.');
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (host) {
    if (!projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d{2,5}$/.test(host)) throw new CredentialAccessError(503, 'AUTH_CONFIGURATION_UNAVAILABLE', 'No pudimos preparar la recuperación.');
    return { origin: `http://${host}/identitytoolkit.googleapis.com`, projectId, emulator: true };
  }
  if (projectId !== 'mutter-games') throw new CredentialAccessError(503, 'AUTH_CONFIGURATION_UNAVAILABLE', 'No pudimos preparar la recuperación.');
  return { origin: 'https://identitytoolkit.googleapis.com', projectId, emulator: false };
}
export async function readPasswordUpdatedAt(auth: Auth, uid: string): Promise<{ passwordUpdatedAtMs: number; email: string | null }> {
  const endpoint = authEndpoint(auth);
  const credential = auth.app.options.credential;
  if (!endpoint.emulator && !credential) throw new CredentialAccessError(503, 'AUTH_READ_UNAVAILABLE', 'No pudimos comprobar la recuperación.');
  const accessToken = endpoint.emulator ? 'owner' : (await credential?.getAccessToken())?.access_token;
  if (!accessToken) throw new CredentialAccessError(503, 'AUTH_READ_UNAVAILABLE', 'No pudimos comprobar la recuperación.');
  const response = await fetch(`${endpoint.origin}/v1/projects/${endpoint.projectId}/accounts:lookup?fields=users(localId,email,passwordUpdatedAt)`, {
    method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: [uid] }),
  });
  const raw: unknown = await response.json();
  if (!response.ok || !object(raw) || !Array.isArray(raw.users) || raw.users.length !== 1) throw new CredentialAccessError(503, 'AUTH_READ_UNAVAILABLE', 'No pudimos comprobar la recuperación.');
  const user: unknown = raw.users[0];
  if (!object(user) || user.localId !== uid) throw new CredentialAccessError(503, 'AUTH_READ_UNAVAILABLE', 'No pudimos comprobar la recuperación.');
  // The official projection excludes credential material at origin. Still select
  // only these fields in memory and never log or persist the raw response.
  const value = typeof user.passwordUpdatedAt === 'number' ? user.passwordUpdatedAt :
    typeof user.passwordUpdatedAt === 'string' && /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(user.passwordUpdatedAt) ? Number(user.passwordUpdatedAt) : null;
  if (!safeTime(value)) throw new CredentialAccessError(503, 'AUTH_READ_UNAVAILABLE', 'No pudimos comprobar la recuperación.');
  return { passwordUpdatedAtMs: value, email: normalizeRecoveryEmail(user.email) };
}
export async function sendOfficialPasswordReset(auth: Auth, email: string, continueUrl: string): Promise<void> {
  const endpoint = authEndpoint(auth);
  const apiKey = endpoint.emulator ? 'synthetic' : process.env.VITE_FIREBASE_API_KEY ?? process.env.FIREBASE_AUTH_API_KEY;
  if (!apiKey) throw new CredentialAccessError(503, 'AUTH_CONFIGURATION_UNAVAILABLE', 'No pudimos preparar la recuperación.');
  const response = await fetch(`${endpoint.origin}/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Firebase-Locale': 'es' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email, continueUrl, canHandleCodeInApp: false, returnOobLink: false }),
  });
  // No response body or action link is returned to the caller or logged.
  if (!response.ok) throw new CredentialAccessError(503, 'RECOVERY_DELIVERY_UNCERTAIN', 'No pudimos confirmar el envío de recuperación.');
}
