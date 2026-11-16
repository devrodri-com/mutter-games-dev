import type { ClientWithId } from '../data/types';

type StoredClient = ClientWithId & { createdAt: unknown; updatedAt: unknown };

function clientText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Campo de cliente inválido: ${field}`);
  return value;
}

export function mapClientDocument(id: string, data: Record<string, unknown>): StoredClient {
  return {
    id,
    name: clientText(data.name || data.fullName || '-', 'name'),
    email: clientText(data.email || '', 'email').toLowerCase(),
    phone: clientText(data.phone || data.phoneNumber || '', 'phone'),
    address: clientText(data.address || data.addressLine1 || '', 'address'),
    city: clientText(data.city || '', 'city'),
    state: clientText(data.state || data.department || '', 'state'),
    zip: clientText(data.zip || data.postalCode || '', 'zip'),
    country: clientText(data.country || '', 'country'),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}
