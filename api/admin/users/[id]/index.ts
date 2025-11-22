// api/admin/users/[id]/index.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import withAdmin from '../../../_lib/withAdmin';
import { adminDb, adminAuth } from '../../../_lib/firebaseAdmin';
import { assertAdmin, assertSuperadmin } from '../../../_lib/permissions';

// GET → Get a single admin user (admin + superadmin)
// PATCH → Update admin fields (superadmin required for role changes)
// DELETE → Remove admin user (superadmin only)

async function handler({
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
  const userId = req.query.id as string;

  if (!userId) {
    return res.status(400).json({ error: 'Missing user id' });
  }

  if (req.method === 'GET') {
    return handleGet(userId, req, res, role);
  }

  if (req.method === 'PATCH') {
    return handlePatch(userId, req, res, role);
  }

  if (req.method === 'DELETE') {
    return handleDelete(userId, req, res, role);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

/* =============================================
   GET /api/admin/users/[id]
   Admin + Superadmin can read
============================================= */
async function handleGet(
  userId: string,
  req: VercelRequest,
  res: VercelResponse,
  role: 'admin' | 'superadmin'
) {
  assertAdmin(role);

  const doc = await adminDb.collection('adminUsers').doc(userId).get();
  if (!doc.exists) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.status(200).json({ id: doc.id, ...doc.data() });
}

/* =============================================
   PATCH /api/admin/users/[id]
   Superadmin required to change "rol"
   Admin can update: nombre, activo
============================================= */
async function handlePatch(
  userId: string,
  req: VercelRequest,
  res: VercelResponse,
  role: 'admin' | 'superadmin'
) {
  const raw = req.body;
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;

  const { nombre, activo, rol: newRole } = payload || {};

  const updateData: Record<string, any> = {};

  if (nombre !== undefined) updateData.nombre = nombre;
  if (activo !== undefined) updateData.activo = activo;

  // Role changes → only superadmin
  if (newRole !== undefined) {
    assertSuperadmin(role);

    if (newRole !== 'admin' && newRole !== 'superadmin') {
      return res.status(400).json({ error: 'Invalid role value' });
    }

    updateData.rol = newRole;

    // Sync Firebase Auth claims
    await adminAuth.setCustomUserClaims(userId, {
      admin: newRole === 'admin' || newRole === 'superadmin',
      superadmin: newRole === 'superadmin',
    });
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  updateData.updatedAt = new Date().toISOString();

  await adminDb.collection('adminUsers').doc(userId).update(updateData);

  return res.status(200).json({ id: userId, updated: true });
}

/* =============================================
   DELETE /api/admin/users/[id]
   Superadmin only
============================================= */
async function handleDelete(
  userId: string,
  req: VercelRequest,
  res: VercelResponse,
  role: 'admin' | 'superadmin'
) {
  assertSuperadmin(role);

  try {
    // Delete from Auth
    await adminAuth.deleteUser(userId);

    // Delete from Firestore
    await adminDb.collection('adminUsers').doc(userId).delete();

    return res.status(200).json({ id: userId, deleted: true });
  } catch (err: any) {
    console.error('Error deleting admin user:', err);
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
}

export default withAdmin(handler);