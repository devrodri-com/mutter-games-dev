import { generateKeyPairSync } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';

/** Prevent ADC/metadata discovery in the real SDK while retaining its actual
 * implementation. The synthetic signing identity exists only in memory. */
export function initializeDemoAdmin(name: string) {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9198'
    || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8188') throw Error('Exact demo emulators required');
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  return initializeApp({ projectId: 'demo-mutter-r1', credential: cert({
    projectId: 'demo-mutter-r1', clientEmail: 'synthetic-loopback@demo-mutter-r1.iam.gserviceaccount.com', privateKey,
  }) }, name);
}
