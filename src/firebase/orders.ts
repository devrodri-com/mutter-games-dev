// src/firebase/orders.ts

import { collection, addDoc, getDocs, doc, getDoc, updateDoc, orderBy, query } from "firebase/firestore";
import type { CartItem, Order, Product } from "../data/types";
import { db, ensureAuthedUid } from "../firebaseUtils";
import { auth } from "../firebase";

export async function saveOrderToFirebase(order: {
  cartItems?: any[];
  client?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    country?: string;
  };
  totalAmount?: number;
  shippingCost?: number;
  paymentIntentId?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  date?: string;
  estado?: "En proceso" | "Confirmado" | "Cancelado" | "Entregado";
  items?: any[];
  shipping?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    country?: string;
    cost?: number;
  };
  createdAt?: any;
  total?: number;
}) {
  try {
    const uid = await ensureAuthedUid();

    const cartItems = Array.isArray(order.cartItems)
      ? order.cartItems
      : (order.items ?? []);

    const client = order.client ?? {
      name: order.shipping?.name ?? "",
      email: order.shipping?.email ?? "",
      phone: order.shipping?.phone ?? "",
      address: order.shipping?.address ?? "",
      country: order.shipping?.country ?? "UY",
    };

    const total = Number(order.totalAmount ?? order.total ?? 0);
    const shippingCost = Number(order.shippingCost ?? order.shipping?.cost ?? 0);

    const payload = {
      uid,
      createdAt: order.createdAt ?? Date.now(),
      items: cartItems,
      shipping: {
        cost: shippingCost,
        address: order.shipping?.address ?? client.address ?? "",
        country: order.shipping?.country ?? client.country ?? "",
      },
      total,
      client,
      paymentIntentId: order.paymentIntentId ?? null,
      paymentStatus: order.paymentStatus ?? "pendiente",
      paymentMethod: order.paymentMethod ?? "mercadopago",
      date: order.date ?? new Date().toISOString(),
      estado: order.estado ?? "En proceso",
    };

    let orderId: string | null = null;

    try {
      const currentUser = auth.currentUser;

      if (!currentUser) {
        throw new Error("No hay usuario autenticado para crear la orden");
      }

      const token = await currentUser.getIdToken();

      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({} as any));
        console.error("❌ Error al crear la orden en el backend:", errorBody);
        throw new Error(errorBody.error || "No se pudo crear la orden en el backend");
      }

      const data = await response.json();
      orderId = data.id as string;

      if (import.meta?.env?.DEV) {
        console.log("✅ Pedido creado vía backend:", payload, data);
      }
    } catch (err) {
      console.warn("⚠️ Falló la creación de la orden vía /api/orders, usando Firestore directo:", err);

      // Fallback al flujo original en Firestore
      const ordersRef = collection(db, "orders");
      const ref = await addDoc(ordersRef, payload);

      if (import.meta?.env?.DEV) {
        console.log("✅ Pedido guardado directamente en Firestore (fallback):", payload);
      }

      orderId = ref.id;
    }

    // Mantener la actualización de stock igual
    if (Array.isArray(cartItems) && cartItems.length > 0) {
      await updateStockAfterOrder(cartItems);
    }

    return orderId;
  } catch (error) {
    console.error("❌ Error al guardar el pedido:", error);
    throw error;
  }
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

async function updateStockAfterOrder(cartItems: CartItem[]) {
  const dbFs = db;
  const productUpdates = new Map<string, { variantId: string; quantity: number }[]>();

  for (const item of cartItems) {
    if (!item.id || !item.variantId || !item.quantity) continue;

    if (!productUpdates.has(item.id)) {
      productUpdates.set(item.id, []);
    }

    productUpdates.get(item.id)?.push({
      variantId: item.variantId,
      quantity: item.quantity,
    });
  }

  for (const [productId, updates] of productUpdates.entries()) {
    const productRef = doc(dbFs, "products", productId);
    const productSnap = await getDoc(productRef);

    if (!productSnap.exists()) continue;

    const productData = productSnap.data() as Product;

    let stockTotal = 0;
    const updatedVariants = productData.variants?.map((variant) => {
      const updatedOptions = variant.options.map((option) => {
        const update = updates.find(
          (u) => `${variant.label?.es || variant.label?.en}-${option.value}` === u.variantId
        );
        if (update && option.stock !== undefined) {
          option.stock = Math.max(0, option.stock - update.quantity);
        }
        stockTotal += option.stock || 0;
        return option;
      });

      return {
        ...variant,
        options: updatedOptions,
      };
    });

    await updateDoc(productRef, {
      variants: updatedVariants,
      stockTotal,
    });
  }
}
