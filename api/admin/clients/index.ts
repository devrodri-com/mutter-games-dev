// api/admin/clients/index.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import withAdmin from '../../_lib/withAdmin';
import { adminDb } from '../../_lib/firebaseAdmin';
import { assertAdmin } from '../../_lib/permissions';

// GET → List all clients (admin + superadmin)

async function clientsHandler({
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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Only admins/superadmins can read clients
  assertAdmin(role);

  const snapshot = await adminDb.collection('clients').get();
  const clients = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  return res.status(200).json({ clients });
}

export default withAdmin(clientsHandler);