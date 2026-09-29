/** Public, read-only Admin order projection. Private ownership, IP and payment credentials stay on the server. */
export type AdminInventoryState = 'reserved' | 'committed' | 'released' | 'historical' | 'unknown';
export type AdminOrderSummary = {
  id: string;
  historical: boolean;
  customer: { name: string; email: string; phone: string };
  createdAt: number | null;
  total: number | null;
  currency: string | null;
  paymentStatus: string;
  inventoryState: AdminInventoryState;
  reservedUntil: number | null;
  releasedAt: number | null;
  committedAt: number | null;
  lastVerifiedAt: number | null;
  nextCheckAt: number | null;
  attention: string | null;
  delivery: 'pickup' | 'shipping' | 'unknown';
};
export type AdminOrderDetail = AdminOrderSummary & {
  shipping: { address: string; address2: string; city: string; department: string; postalCode: string };
  shippingCost: number | null;
  items: { title: string; variant: string; quantity: number | null; unitPrice: number | null }[];
  itemsTruncated: boolean;
  paymentId: string | null;
  paymentDeadline: number | null;
  lastVerificationFailedAt: number | null;
  reconciliation: { state: string | null; lastProgressAt: number | null; lastError: string | null; coverageUntil: number | null };
};
export type AdminOrderPage = { orders: AdminOrderSummary[]; nextCursor: string | null };

export function adminOrderLabel(order: AdminOrderSummary): string {
  if (order.historical) return 'Histórica no verificada';
  if (order.attention === 'duplicate_approved_payment') return 'Pago duplicado';
  if (order.attention === 'approved_without_stock') return 'Pago aprobado sin unidad';
  if (order.inventoryState === 'committed' && order.paymentStatus === 'approved') return 'Pagada y stock descontado';
  if (order.attention || ['in_review', 'in_process', 'in_mediation', 'authorized'].includes(order.paymentStatus)) return 'En revisión';
  if (order.inventoryState === 'released') return 'Reserva liberada';
  if (order.inventoryState === 'reserved') return 'Reservada';
  return 'Estado pendiente de revisión';
}
export function adminPaymentLabel(order: AdminOrderSummary): string {
  if (order.historical) return 'Pago histórico no verificado';
  const labels: Record<string, string> = {
    approved: 'Pago aprobado por el proveedor', pending: 'Sin aprobación verificada', rejected: 'Pago rechazado',
    expired: 'Cierre sin venta verificada', cancelled: 'Pago cancelado', in_review: 'Pago en revisión',
    in_process: 'Pago en proceso', authorized: 'Pago autorizado, sin confirmación', in_mediation: 'Pago en mediación',
  };
  return labels[order.paymentStatus] ?? 'Pago pendiente de revisión';
}
export function adminInventoryLabel(state: AdminInventoryState): string {
  return { reserved: 'Reserva activa', committed: 'Stock descontado', released: 'Reserva liberada', historical: 'Histórico: sin movimiento automático', unknown: 'Inventario pendiente de revisión' }[state];
}
export function adminAttentionLabel(reason: string): string {
  const labels: Record<string, string> = {
    approved_without_stock: 'Pago aprobado sin unidades disponibles. Revisar en Mercado Pago y resolver manualmente; no se descontó stock.',
    duplicate_approved_payment: 'Hay más de un pago aprobado para este pedido. Revisar el cobro duplicado en Mercado Pago; no se descontó stock otra vez.',
    preference_creation_uncertain: 'La creación del enlace quedó incierta. El servidor conserva el intento para verificarlo.',
    provider_verification_unavailable: 'No se pudo consultar al proveedor. La reserva se conserva hasta verificar el pago.',
    awaiting_provider_evidence: 'La reserva espera evidencia del proveedor antes de cerrarse.',
    payment_identity_mismatch: 'La identidad o el importe del pago no coincide con el pedido.',
    payment_already_linked: 'El pago ya está vinculado a otro pedido.',
    inventory_ledger_mismatch: 'El movimiento de stock requiere revisión.',
    reservation_ledger_mismatch: 'La reserva requiere revisión del inventario.',
    inventory_state_unavailable: 'No se pudo interpretar el estado del inventario de este pedido.',
    late_payment_requires_attention: 'Se observó un pago posterior a la liberación. Requiere revisión.',
    approved_payment_requires_attention: 'Hay una aprobación registrada que requiere revisión.',
    payment_requires_attention: 'El proveedor informó un estado que requiere revisión.',
  };
  return labels[reason] ?? `El servidor requiere atención: ${reason}`;
}
export function adminMoney(amount: number | null, currency: string | null): string {
  return amount === null ? 'Importe no disponible' : `${currency ?? 'Moneda no verificada'} ${amount.toFixed(2)}`;
}
export function adminDate(value: number | null): string {
  return value === null ? 'No registrado' : new Date(value).toLocaleString('es-UY');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respuesta de pedidos inválida.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Respuesta de pedidos inválida.');
  return value;
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function nullableNumber(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Respuesta de pedidos inválida.');
  return value;
}
export function parseAdminOrder(value: unknown): AdminOrderSummary {
  const raw = object(value), customer = object(raw.customer);
  const inventory = raw.inventoryState, delivery = raw.delivery;
  if (typeof raw.historical !== 'boolean' ||
    (inventory !== 'reserved' && inventory !== 'committed' && inventory !== 'released' && inventory !== 'historical' && inventory !== 'unknown') ||
    (delivery !== 'pickup' && delivery !== 'shipping' && delivery !== 'unknown')) throw new Error('Respuesta de pedidos inválida.');
  return {
    id: text(raw.id), historical: raw.historical, customer: { name: text(customer.name), email: text(customer.email), phone: text(customer.phone) },
    createdAt: nullableNumber(raw.createdAt), total: nullableNumber(raw.total), currency: nullableText(raw.currency),
    paymentStatus: text(raw.paymentStatus), inventoryState: inventory, reservedUntil: nullableNumber(raw.reservedUntil),
    releasedAt: nullableNumber(raw.releasedAt), committedAt: nullableNumber(raw.committedAt), lastVerifiedAt: nullableNumber(raw.lastVerifiedAt),
    nextCheckAt: nullableNumber(raw.nextCheckAt), attention: nullableText(raw.attention), delivery,
  };
}
export function parseAdminOrderPage(value: unknown): AdminOrderPage {
  const raw = object(value);
  if (!Array.isArray(raw.orders) || raw.orders.length > 50) throw new Error('Respuesta de pedidos inválida.');
  return { orders: raw.orders.map(parseAdminOrder), nextCursor: nullableText(raw.nextCursor) };
}
export function parseAdminOrderDetail(value: unknown): AdminOrderDetail {
  const raw = object(value), shipping = object(raw.shipping), reconciliation = object(raw.reconciliation);
  if (!Array.isArray(raw.items) || raw.items.length > 100 || typeof raw.itemsTruncated !== 'boolean') throw new Error('Respuesta de pedidos inválida.');
  return {
    ...parseAdminOrder(raw), shipping: { address: text(shipping.address), address2: text(shipping.address2), city: text(shipping.city), department: text(shipping.department), postalCode: text(shipping.postalCode) },
    shippingCost: nullableNumber(raw.shippingCost), items: raw.items.map(value => { const item = object(value); return { title: text(item.title), variant: text(item.variant), quantity: nullableNumber(item.quantity), unitPrice: nullableNumber(item.unitPrice) }; }),
    itemsTruncated: raw.itemsTruncated,
    paymentId: nullableText(raw.paymentId), paymentDeadline: nullableNumber(raw.paymentDeadline), lastVerificationFailedAt: nullableNumber(raw.lastVerificationFailedAt),
    reconciliation: { state: nullableText(reconciliation.state), lastProgressAt: nullableNumber(reconciliation.lastProgressAt), lastError: nullableText(reconciliation.lastError), coverageUntil: nullableNumber(reconciliation.coverageUntil) },
  };
}
