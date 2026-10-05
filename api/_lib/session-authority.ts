/**
 * Only call with Firebase-verified claims, never decoded client input.
 * The independently deployed Admin carries this same policy; paired tests
 * enforce byte identity. This rejects current custom sessions, not their
 * historical origin after account linking (see LEGACY_AUTH_CLOSURE.md).
 */
export function admitsSession(claims: unknown, destination: 'buyer' | 'admin'): boolean {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims) || !('firebase' in claims)) return false;
  const firebase = claims.firebase;
  if (!firebase || typeof firebase !== 'object' || Array.isArray(firebase) || !('sign_in_provider' in firebase)) return false;
  return firebase.sign_in_provider === 'password'
    || (destination === 'buyer' && firebase.sign_in_provider === 'anonymous');
}
