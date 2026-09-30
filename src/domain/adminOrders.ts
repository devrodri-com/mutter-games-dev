/** Public, read-only Admin order projection. Private ownership, IP and payment credentials stay on the server. */
export type AdminInventoryState = 'reserved' | 'committed' | 'released' | 'historical' | 'unknown';
export type AdminOrderSection = 'recent' | 'undated';
export type AdminOrderDateState = 'verified' | 'missing' | 'null' | 'invalid';
export const ADMIN_ORDER_TIMESTAMP_RANGE = { minSeconds: -62135596800, maxSeconds: 253402300799, maxNanoseconds: 999999999 } as const;
export type AdminOrderCursor =
  | { section: 'recent'; createdAt: { seconds: number; nanoseconds: number }; id: string }
  | { section: 'undated'; id: string };
export type AdminOrderSummary = {
  id: string;
  historical: boolean;
  customer: { name: string; email: string; phone: string };
  createdAt: number | null;
  createdAtState: AdminOrderDateState;
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
export type AdminOrderPage = { section: AdminOrderSection; scannedCount: number; orders: AdminOrderSummary[]; nextCursor: AdminOrderCursor | null };

/** A failed follow-up cannot undo this server evidence. Other attention remains commercial. */
export function adminCommercialAttention(order: Pick<AdminOrderSummary, 'attention' | 'inventoryState' | 'paymentStatus'>): string | null {
  return order.inventoryState === 'committed' && order.paymentStatus === 'approved' &&
    order.attention === 'reservation_reconciliation_failed' ? null : order.attention;
}

export function adminOrderLabel(order: AdminOrderSummary): string {
  if (order.historical) return 'Histórica no verificada';
  if (order.attention === 'duplicate_approved_payment') return 'Pago duplicado';
  if (order.attention === 'approved_without_stock') return 'Pago aprobado sin unidad';
  if (adminCommercialAttention(order)) return 'En revisión';
  if (order.inventoryState === 'committed' && order.paymentStatus === 'approved') return 'Pagada y stock descontado';
  if (['in_review', 'in_process', 'in_mediation', 'authorized'].includes(order.paymentStatus)) return 'En revisión';
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
export function adminAttentionLabel(reason: string, order?: AdminOrderSummary): string {
  if (reason === 'reservation_reconciliation_failed' && order?.inventoryState === 'committed' && order.paymentStatus === 'approved') {
    return 'La venta está confirmada. Una comprobación posterior tuvo un problema técnico; su seguimiento figura en mantenimiento.';
  }
  const labels: Record<string, string> = {
    reservation_reconciliation_failed: 'No se pudo completar la comprobación de este pedido. Requiere seguimiento; no se debe asumir que el pago terminó ni liberar su reserva manualmente.',
    payment_tracking_capacity_exceeded: 'Este pedido tiene más pagos de los que el seguimiento automático puede revisar. Requiere revisión en Mercado Pago antes de resolverlo.',
    provider_history_window_exceeded: 'Terminó el período de seguimiento automático de este pedido. Su estado requiere revisión en Mercado Pago; no se libera stock por ese motivo.',
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
export function adminOrderDateLabel(order: AdminOrderSummary): string {
  return order.createdAtState === 'verified' ? adminDate(order.createdAt) :
    { missing: 'Fecha ausente', null: 'Fecha no registrada', invalid: 'Fecha inválida: requiere revisión' }[order.createdAtState];
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
export function parseAdminOrderCursor(value: unknown): AdminOrderCursor {
  const raw = object(value), id = text(raw.id);
  if (!id || new TextEncoder().encode(id).length > 1500 || id.includes('/') || id === '.' || id === '..') throw new Error('Cursor de pedidos inválido.');
  if (raw.section === 'undated' && Object.keys(raw).every(key => ['section', 'id'].includes(key))) return { section: 'undated', id };
  if (raw.section !== 'recent' || Object.keys(raw).some(key => !['section', 'id', 'createdAt'].includes(key))) throw new Error('Cursor de pedidos inválido.');
  const timestamp = object(raw.createdAt), seconds = timestamp.seconds, nanoseconds = timestamp.nanoseconds;
  if (Object.keys(timestamp).some(key => !['seconds', 'nanoseconds'].includes(key)) ||
    typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < ADMIN_ORDER_TIMESTAMP_RANGE.minSeconds || seconds > ADMIN_ORDER_TIMESTAMP_RANGE.maxSeconds ||
    typeof nanoseconds !== 'number' || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds > ADMIN_ORDER_TIMESTAMP_RANGE.maxNanoseconds) throw new Error('Cursor de pedidos inválido.');
  return { section: 'recent', id, createdAt: { seconds, nanoseconds } };
}
export function parseAdminOrder(value: unknown): AdminOrderSummary {
  const raw = object(value), customer = object(raw.customer);
  const inventory = raw.inventoryState, delivery = raw.delivery, dateState = raw.createdAtState;
  if (typeof raw.historical !== 'boolean' ||
    (inventory !== 'reserved' && inventory !== 'committed' && inventory !== 'released' && inventory !== 'historical' && inventory !== 'unknown') ||
    (delivery !== 'pickup' && delivery !== 'shipping' && delivery !== 'unknown') ||
    (raw.createdAt !== null && (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt) || Math.abs(raw.createdAt) > 8_640_000_000_000_000)) ||
    (dateState === 'verified') !== (raw.createdAt !== null)) throw new Error('Respuesta de pedidos inválida.');
  // Narrow the date state explicitly rather than accepting arbitrary string-like objects.
  if (dateState !== 'verified' && dateState !== 'missing' && dateState !== 'null' && dateState !== 'invalid') throw new Error('Respuesta de pedidos inválida.');
  return {
    id: text(raw.id), historical: raw.historical, customer: { name: text(customer.name), email: text(customer.email), phone: text(customer.phone) },
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : null, createdAtState: dateState, total: nullableNumber(raw.total), currency: nullableText(raw.currency),
    paymentStatus: text(raw.paymentStatus), inventoryState: inventory, reservedUntil: nullableNumber(raw.reservedUntil),
    releasedAt: nullableNumber(raw.releasedAt), committedAt: nullableNumber(raw.committedAt), lastVerifiedAt: nullableNumber(raw.lastVerifiedAt),
    nextCheckAt: nullableNumber(raw.nextCheckAt), attention: nullableText(raw.attention), delivery,
  };
}
export function parseAdminOrderPage(value: unknown): AdminOrderPage {
  const raw = object(value);
  if (!Array.isArray(raw.orders) || raw.orders.length > 50 || (raw.section !== 'recent' && raw.section !== 'undated') ||
    typeof raw.scannedCount !== 'number' || !Number.isInteger(raw.scannedCount) || raw.scannedCount < raw.orders.length || raw.scannedCount > 50) throw new Error('Respuesta de pedidos inválida.');
  const nextCursor = raw.nextCursor === null ? null : parseAdminOrderCursor(raw.nextCursor);
  if (nextCursor && nextCursor.section !== raw.section) throw new Error('Respuesta de pedidos inválida.');
  return { section: raw.section, scannedCount: raw.scannedCount, orders: raw.orders.map(parseAdminOrder), nextCursor };
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
