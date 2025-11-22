// api/admin/users/index.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb, adminAuth } from '../../_lib/firebaseAdmin';
import withAdmin from '../../_lib/withAdmin';
import { assertAdmin, assertSuperadmin } from '../../_lib/permissions';

// GET → List all admin users (admin + superadmin)
// POST → Create a new admin user (superadmin only)

async function usersHandler({
  req,
  res,
  uid,
  role,
}: {
  req: VercelRequest;
  res: VercelResponse;
  uid: string;
  role: 'admin' | 'superadmin';
}) {
  if (req.method === 'GET') {
    return handleGet(req, res, role);
  }

  if (req.method === 'POST') {
    return handlePost(req, res, role);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

/* ================================
   GET /api/admin/users
   Admins + Superadmins can read
================================ */
async function handleGet(req: VercelRequest, res: VercelResponse, role: 'admin' | 'superadmin') {
  assertAdmin(role);

  const snapshot = await adminDb.collection('adminUsers').get();
  const users = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  return res.status(200).json({ users });
}

/* ================================
   POST /api/admin/users
   Only superadmin can create admins
================================ */
async function handlePost(
  req: VercelRequest,
  res: VercelResponse,
  role: 'admin' | 'superadmin'
) {
  assertSuperadmin(role);

  const rawBody = req.body;
  const payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

  const { email, password, nombre, rol } = payload || {};

  if (!email || !password || !rol) {
    return res.status(400).json({ error: 'email, password y rol son requeridos' });
  }

  if (rol !== 'admin' && rol !== 'superadmin') {
    return res.status(400).json({ error: 'rol debe ser "admin" o "superadmin"' });
  }

  try {
    const userRecord = await adminAuth.createUser({
      email,
      password,
      emailVerified: true,
      disabled: false,
    });

    await adminAuth.setCustomUserClaims(userRecord.uid, {
      admin: rol === 'admin' || rol === 'superadmin',
      superadmin: rol === 'superadmin',
    });

    await adminDb.collection('adminUsers').doc(userRecord.uid).set({
      email,
      nombre: nombre || '',
      rol,
      activo: true,
      uid: userRecord.uid,
      createdAt: new Date().toISOString(),
    });

    return res.status(201).json({ id: userRecord.uid, email, rol });
  } catch (err: any) {
    console.error('Error creando admin:', err);
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
}

export default withAdmin(usersHandler);