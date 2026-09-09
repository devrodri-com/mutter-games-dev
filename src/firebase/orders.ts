// src/firebase/orders.ts

import { collection, getDocs, orderBy, query } from "firebase/firestore";
import type { Order } from "../data/types";
import { db } from "../firebaseUtils";

/** Old callers cannot submit authoritative snapshots. Use catalog checkout. */
export async function saveOrderToFirebase(_order:unknown):Promise<string> {
  void _order; // Legacy payload is deliberately never trusted.
  throw new Error("Actualizá la página y usá la compra verificada desde el carrito.");
}

function mapOrderForAdmin(id: string, data: any) {
  const createdMs =
    data?.createdAt && typeof data.createdAt?.toMillis === "function"
      ? data.createdAt.toMillis()
      : typeof data?.createdAt === "number"
      ? data.createdAt
      : data?.date
      ? Date.parse(data.date)
      : Date.now();

  const clientRaw = data?.client || {};
  const shippingInfo = data?.shipping || data?.shippingInfo || {};

  const client = {
    name: clientRaw.name || data?.name || "",
    email: clientRaw.email || data?.email || "",
    phone: clientRaw.phone || data?.phone || "",
    address:
      clientRaw.address ||
      shippingInfo.address ||
      clientRaw.address1 ||
      "",
    city: clientRaw.city || shippingInfo.city || "",
    state: clientRaw.state || shippingInfo.state || "",
    zip:
      clientRaw.zip ||
      shippingInfo.zip ||
      shippingInfo.postalCode ||
      "",
    country: clientRaw.country || shippingInfo.country || "",
  };

  const items = data?.items || data?.cartItems || [];
  const totalAmount = Number(data?.total ?? data?.totalAmount ?? 0);
  const shippingCost = Number(shippingInfo?.cost ?? data?.shippingCost ?? 0);
  const estado = data?.estado || data?.status || "Pendiente";

  return {
    id,
    cartItems: items,
    client,
    totalAmount,
    paymentIntentId: data?.paymentIntentId || "",
    paymentStatus: data?.paymentStatus || "",
    paymentMethod: data?.paymentMethod || "",
    date: data?.date || new Date(createdMs).toISOString(),
    estado,
    createdAt: createdMs,
    shippingCost,
    clientEmail: client.email,
  };
}

export async function fetchOrdersFromFirebase() {
  try {
    const ordersRef = collection(db, "orders");
    const snapshot = await getDocs(ordersRef);

    const orders = snapshot.docs.map((d) => mapOrderForAdmin(d.id, d.data()));
    return orders;
  } catch (error) {
    console.error("❌ Error al traer pedidos desde Firebase:", error);
    return [];
  }
}

export async function getOrdersByEmail(email: string): Promise<Order[]> {
  try {
    const q = query(
      collection(db, "orders"),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((docSnap) => mapOrderForAdmin(docSnap.id, docSnap.data()))
      .filter((order) => order.clientEmail?.toLowerCase() === email.toLowerCase());
  } catch (error) {
    console.error("❌ Error al obtener pedidos por email:", error);
    return [];
  }
}
