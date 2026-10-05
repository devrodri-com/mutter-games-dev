import { admitsSession } from './session-authority.js';
import { FieldPath, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { CheckoutError } from './checkout-domain.js';
import { ADMIN_ORDER_TIMESTAMP_RANGE, adminCommercialAttention, parseAdminOrderCursor, type AdminOrderCursor, type AdminOrderDetail, type AdminOrderPage, type AdminOrderSummary } from '../../src/domain/adminOrders.js';

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(...values: unknown[]): string {
  const value = values.find(value => typeof value === 'string' && value.trim());
  return typeof value === 'string' ? value.slice(0, 600) : '';
}
function amount(...values: unknown[]): number | null {
  const value = values.find(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return typeof value === 'number' ? value : null;
}
function time(value: unknown): number | null {
  const millis = value instanceof Timestamp ? value.toMillis() : value instanceof Date ? value.getTime() :
    typeof value === 'string' ? Date.parse(value) : value;
  return typeof millis === 'number' && Number.isFinite(millis) && millis >= 0 && millis <= 8_640_000_000_000_000 ? millis : null;
}
function customer(order: Record<string, unknown>) {
  const client = object(order.clientInfo ?? order.client), shipping = object(order.shipping ?? order.shippingInfo), legacy = object(order.cliente);
  return {
    name: text(client.name, client.nombre, shipping.name, shipping.fullName, legacy.nombre, typeof order.client === 'string' ? order.client : ''),
    email: text(client.email, shipping.email, shipping.contactEmail, legacy.email),
    phone: text(client.phone, client.telefono, shipping.phone, shipping.phoneNumber, legacy.telefono),
  };
}
export function projectAdminOrder(id: string, value: unknown): AdminOrderSummary {
  const order = object(value), inventory = object(order.inventory), reconciliation = object(order.reconciliation);
  const historical = order.commerceVersion !== 2;
  const state = inventory.state;
  const inventoryState = historical ? 'historical' : state === 'reserved' || state === 'released' || state === 'committed' ? state : 'unknown';
  const shipping = object(order.shipping ?? order.shippingInfo);
  return {
    id, historical, customer: customer(order), createdAt: order.createdAt instanceof Timestamp ? order.createdAt.toMillis() : null,
    createdAtState: order.createdAt instanceof Timestamp ? 'verified' : !Object.hasOwn(order, 'createdAt') ? 'missing' : order.createdAt === null ? 'null' : 'invalid',
    total: amount(order.total, order.totalAmount),
    currency: typeof order.currency === 'string' && /^[A-Z]{3}$/.test(order.currency) ? order.currency : null,
    paymentStatus: historical ? 'historical_unverified' : text(order.paymentStatus) || 'unknown', inventoryState,
    reservedUntil: historical ? null : time(inventory.expiresAt), releasedAt: historical ? null : time(inventory.releasedAt),
    committedAt: historical ? null : time(inventory.committedAt), lastVerifiedAt: historical ? null : time(order.lastVerifiedAt),
    nextCheckAt: historical ? null : time(reconciliation.nextCheckAt),
    attention: historical ? null : adminCommercialAttention({ inventoryState, paymentStatus: text(order.paymentStatus),
      attention: text(order.attention) || (inventoryState === 'unknown' ? 'inventory_state_unavailable' : null) }),
    delivery: shipping.pickup === true ? 'pickup' : shipping.pickup === false ? 'shipping' : 'unknown',
  };
}
export function projectAdminOrderDetail(id: string, value: unknown): AdminOrderDetail {
  const order = object(value), shipping = object(order.shipping ?? order.shippingInfo), client = object(order.clientInfo ?? order.client), legacy = object(order.cliente), reconciliation = object(order.reconciliation);
  const summary = projectAdminOrder(id, order);
  const items = Array.isArray(order.items) ? order.items.slice(0, 100) : [];
  return {
    ...summary,
    shipping: {
      address: text(shipping.address, shipping.addressLine1, client.address, client.direccion, legacy.direccion, order.address),
      address2: text(shipping.address2, shipping.addressLine2, client.address2, client.apto, client.address_line2),
      city: text(shipping.city, legacy.ciudad, order.city), department: text(shipping.department, shipping.state, legacy.departamento, order.department),
      postalCode: text(shipping.postalCode, shipping.zip, shipping.zipCode, legacy.codigoPostal, order.postalCode),
    },
    shippingCost: amount(order.shippingCost),
    itemsTruncated: Array.isArray(order.items) && order.items.length > 100,
    items: items.map(value => {
      const item = object(value);
      return { title: text(item.title, object(item.title).es, object(item.title).en, object(item.name).es, item.name, typeof value === 'string' ? value : '') || 'Producto sin título',
        variant: text(item.variantLabel, item.options, item.variantId), quantity: amount(item.quantity), unitPrice: amount(item.unitPrice, item.price, item.priceUSD) };
    }),
    paymentId: summary.historical ? null : text(order.approvedPaymentId) || null,
    paymentDeadline: summary.historical ? null : time(order.paymentDeadline),
    lastVerificationFailedAt: summary.historical ? null : time(order.lastVerificationFailedAt),
    reconciliation: { state: summary.historical ? null : text(reconciliation.state) || null,
      lastProgressAt: summary.historical ? null : time(reconciliation.lastProgressAt),
      lastError: summary.historical ? null : text(reconciliation.lastError) || null,
      coverageUntil: summary.historical ? null : time(reconciliation.coverageUntil) },
  };
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 1500 && !value.includes('/') && value !== '.' && value !== '..';
}
/** Claims must come only from verifyIdToken(token, true), as in the existing Admin API. No permissions document is required. */
export async function adminOrders(db: Firestore, verifiedClaims: Record<string, unknown>, body: Record<string, unknown>): Promise<AdminOrderPage | { order: AdminOrderDetail }> {
  if (!admitsSession(verifiedClaims, 'admin') || (verifiedClaims.admin !== true && verifiedClaims.superadmin !== true)) throw new CheckoutError(403, 'FORBIDDEN', 'No tenés permisos para consultar pedidos.');
  return readAdminOrders(db, body);
}

/** Dedicated release bearer must already be verified. No session or role is fabricated. */
export async function adminOrderReadSmoke(db: Firestore): Promise<number> {
  const page = await readAdminOrders(db, { action: 'admin_orders', limit: 1 });
  return 'orders' in page ? page.orders.length : 0;
}

async function readAdminOrders(db: Firestore, body: Record<string, unknown>): Promise<AdminOrderPage | { order: AdminOrderDetail }> {
  if (body.action === 'admin_order') {
    if (Object.keys(body).some(key => !['action', 'orderId'].includes(key)) || !validId(body.orderId)) throw new CheckoutError(400, 'INVALID_INPUT', 'Pedido inválido.');
    const snapshot = await db.collection('orders').doc(body.orderId).get();
    if (!snapshot.exists) throw new CheckoutError(404, 'ORDER_NOT_FOUND', 'No encontramos este pedido.');
    return { order: projectAdminOrderDetail(snapshot.id, snapshot.data()) };
  }
  if (body.action !== 'admin_orders' || Object.keys(body).some(key => !['action', 'limit', 'cursor', 'section'].includes(key)) ||
    (body.limit !== undefined && (typeof body.limit !== 'number' || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 50)) ||
    (body.section !== undefined && body.section !== 'recent' && body.section !== 'undated')) throw new CheckoutError(400, 'INVALID_INPUT', 'Página de pedidos inválida.');
  const pageSize = typeof body.limit === 'number' ? body.limit : 20;
  const section = body.section === 'undated' ? 'undated' : 'recent';
  let cursor: AdminOrderCursor | undefined;
  if (body.cursor !== undefined) {
    try { cursor = parseAdminOrderCursor(body.cursor); }
    catch { throw new CheckoutError(400, 'INVALID_INPUT', 'Cursor de pedidos inválido.'); }
    if (cursor.section !== section) throw new CheckoutError(400, 'INVALID_INPUT', 'Cursor de pedidos inválido.');
  }
  // Timestamp bounds exclude other Firestore types. Same-direction ID tie-break uses
  // the normal descending createdAt index, preserving the full timestamp cursor.
  const base = section === 'recent'
    ? db.collection('orders').where('createdAt', '>=', new Timestamp(ADMIN_ORDER_TIMESTAMP_RANGE.minSeconds, 0))
      .where('createdAt', '<=', new Timestamp(ADMIN_ORDER_TIMESTAMP_RANGE.maxSeconds, ADMIN_ORDER_TIMESTAMP_RANGE.maxNanoseconds))
      .orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc')
    : db.collection('orders').orderBy(FieldPath.documentId(), 'asc');
  const query = !cursor ? base : cursor.section === 'recent'
    ? base.startAfter(new Timestamp(cursor.createdAt.seconds, cursor.createdAt.nanoseconds), cursor.id)
    : base.startAfter(cursor.id);
  const page = await query.limit(pageSize + 1).get();
  const selected = page.docs.slice(0, pageSize);
  const projected = selected.map(snapshot => projectAdminOrder(snapshot.id, snapshot.data()));
  const last = selected[selected.length - 1];
  let nextCursor: AdminOrderCursor | null = null;
  if (page.size > pageSize && last) {
    const createdAt: unknown = last.get('createdAt');
    if (section === 'recent') {
      if (!(createdAt instanceof Timestamp)) throw new Error('La consulta de pedidos devolvió una fecha inválida.');
      nextCursor = { section, id: last.id, createdAt: { seconds: createdAt.seconds, nanoseconds: createdAt.nanoseconds } };
    } else nextCursor = { section, id: last.id };
  }
  // An empty filtered page is not the end: advance using the last inspected ID.
  return { section, scannedCount: selected.length,
    orders: section === 'recent' ? projected : projected.filter(order => order.createdAtState !== 'verified'), nextCursor };
}
