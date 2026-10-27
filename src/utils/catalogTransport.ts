import { auth } from '../firebase';
import { ensureCredentialSession } from './credentialAccess';
export type Actor = NonNullable<typeof auth.currentUser>;
export function assertActor(actor: Actor): void {
  if (auth.currentUser !== actor || auth.currentUser.uid !== actor.uid) throw new Error('Cambió la cuenta. Volvé a abrir la publicación.');
}
export async function actorForEdit(): Promise<Actor> {
  const initial = auth.currentUser;
  if (!initial) throw new Error('Ingresá a tu cuenta para editar.');
  const admission = await ensureCredentialSession(initial);
  // A legitimate token exchange can replace Firebase's User for the same UID.
  // Pin the admitted current actor for every subsequent await and dispatch.
  const actor = auth.currentUser;
  if (!actor || actor.uid !== initial.uid) throw new Error('Cambió la cuenta. Volvé a abrir la publicación.');
  if (admission.uid !== actor.uid || admission.scope !== 'JOHN_ADMIN_CLOSED_V1'
    || !(admission.admin || admission.superadmin) || admission.expiresAtMs <= Date.now()) {
    throw new Error('No pudimos comprobar el permiso para editar publicaciones.');
  }
  return actor;
}
export function catalogPath(id: string, operationId?: string): string {
  if (!id || id.includes('/') || [...id].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
    || id.length > 200) throw new Error('La publicación no es válida.');
  const query = new URLSearchParams({ id });
  if (operationId) query.set('operationId', operationId);
  return '/api/catalog-edit?' + query.toString();
}
export async function catalogRequest(actor: Actor, url: string, method = 'GET', body?: string, beforeDispatch?: () => void): Promise<{ status: number; value: unknown }> {
  if (!/^\/api\/catalog-(?:edit|media)(?:\?|$)/.test(url)) throw new Error('Destino de publicación inválido.');
  assertActor(actor); const token = await actor.getIdToken(); assertActor(actor);
  beforeDispatch?.();
  const response = await fetch(url, { method, redirect: 'error', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body } : {}) });
  assertActor(actor); const value: unknown = await response.json(); assertActor(actor);
  return { status: response.status, value };
}
