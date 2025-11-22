// api/_lib/permissions.ts

// api/_lib/permissions.ts

export function assertAdmin(role: 'admin' | 'superadmin') {
  if (role !== 'admin' && role !== 'superadmin') {
    throw new Response('Forbidden: admin access required', { status: 403 });
  }
}

export function assertSuperadmin(role: 'admin' | 'superadmin') {
  if (role !== 'superadmin') {
    throw new Response('Forbidden: superadmin access required', { status: 403 });
  }
}