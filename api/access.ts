import type { VercelRequest } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from './_lib/firebase-server.js';
import { handleCredentialAccess, type AccessAction, type AccessResponse } from './_lib/credential-access-handler.js';
import { handleReleaseAttestation } from './_lib/release-attestation.js';

export const config = { architecture: 'x86_64', maxDuration: 60 };
function actionForUrl(url: string | undefined): AccessAction | null {
  if (!url?.startsWith('/') || url.startsWith('//')) return null;
  const pathname = url.split('?')[0];
  if (pathname === '/api/access/session') return 'session';
  if (pathname === '/api/access/recovery/request') return 'request';
  if (pathname === '/api/access/recovery/complete') return 'complete';
  return null;
}
export default async function handler(req: VercelRequest, res: AccessResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const action = actionForUrl(req.url);
  if (!action) return res.status(404).json({ code: 'NOT_FOUND', error: 'Not found' });
  if (handleReleaseAttestation(req, res, 'access')) return;
  if (req.method !== 'POST') return res.status(405).json({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' });
  const authorization = req.headers.authorization;
  if (action !== 'request' && (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')
    || authorization.length <= 7 || authorization.length > 16000)) {
    return res.status(401).json({ code: 'INVALID_SESSION', error: 'Volvé a iniciar sesión para continuar.' });
  }
  try {
    const app = adminApp();
    return await handleCredentialAccess(action, getAuth(app), getFirestore(app), req, res);
  } catch {
    return res.status(503).json({ code: 'ACCESS_UNAVAILABLE', error: 'No pudimos comprobar el acceso. Tu cuenta y tus datos se conservan.' });
  }
}
