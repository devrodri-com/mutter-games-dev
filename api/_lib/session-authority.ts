/**
 * Only call with Firebase-verified claims, never decoded client input.
 * Legacy provider characterization only. It is never the credential-admission
 * decision: credential-session verifies the server capability and account state.
 * The paired Admin preserves this same historical filter for regression evidence.
 */
export function admitsSession(claims: unknown, destination: 'buyer' | 'admin'): boolean {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims) || !('firebase' in claims)) return false;
  const firebase = claims.firebase;
  if (!firebase || typeof firebase !== 'object' || Array.isArray(firebase) || !('sign_in_provider' in firebase)) return false;
  return firebase.sign_in_provider === 'password'
    || (destination === 'buyer' && firebase.sign_in_provider === 'anonymous');
}
