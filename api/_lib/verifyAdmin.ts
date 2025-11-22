// api/_lib/verifyAdmin.ts

// api/_lib/verifyAdmin.ts

import { adminAuth } from './firebaseAdmin';

export interface VerifiedAdmin {
  uid: string;
  role: 'admin' | 'superadmin';
}

/**
 * Extracts and verifies the Firebase ID token from the Authorization header.
 * Returns uid + role, or throws standardized errors.
 */
export async function verifyAdmin(req: Request): Promise<VerifiedAdmin> {
  const authHeader = req.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Response('Missing or invalid Authorization header', { status: 401 });
  }

  const tokenString = authHeader.slice(7).trim();

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(tokenString);
  } catch (err) {
    throw new Response('Invalid or expired token', { status: 401 });
  }

  const isAdmin = decoded.admin === true;
  const isSuperadmin = decoded.superadmin === true;

  if (!isAdmin && !isSuperadmin) {
    throw new Response('Forbidden: admin access required', { status: 403 });
  }

  return {
    uid: decoded.uid,
    role: isSuperadmin ? 'superadmin' : 'admin',
  };
}