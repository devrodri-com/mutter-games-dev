// src/utils/orderUtils.ts
// ✅ orderUtils.ts abierto correctamente
import { db, ensureAuthReady } from "../firebase";
import { collection, addDoc, Timestamp } from "firebase/firestore";
import { Order, CartItem } from "@/data/types";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { calculateCartBreakdown } from "./cartUtils";

// Define el tipo de la información de envío
interface ShippingInfo {
  nombre: string;
  direccion: string;
  ciudad: string;
  estado: string;
  codigoPostal: string;
  pais: string;
  telefono: string;
}


// Función para crear la orden
export async function createOrder(orderData: Order): Promise<string> {
  try {
    // Obtener el UID del usuario (anónimo o logueado) usando la función centralizada
    const uid = await ensureAuthReady();

    // Armar payload compatible con las reglas de Firestore
    const payload = {
      uid: uid as string,                          // requerido por reglas
      createdAt: Timestamp.now(),                  // timestamp aceptado por reglas
      items: (orderData.cartItems || []).map((it) => ({
        id: it.id || "",
        slug: (it as any).slug || "",
        // Tomamos un título legible; si viene objeto multi-idioma usamos es/en
        title: typeof (it as any).title === "object"
          ? ((it as any).title.es || (it as any).title.en || it.name || "")
          : ((it as any).title || it.name || ""),
        price: Number(it.price ?? (it as any).priceUSD ?? 0),
        quantity: Number(it.quantity ?? 1),
        // Campos opcionales que guardamos por trazabilidad
        variantLabel: (it as any).variantLabel || "",
        customName: (it as any).customName || "",
        customNumber: (it as any).customNumber || "",
      })),
      shipping: {
        method: orderData.paymentMethod || "A coordinar",
        cost: Number(orderData.breakdown?.shipping || 0),
        address: {
          name: orderData.client?.name || "",
          phone: orderData.client?.phone || "",
          line1: orderData.client?.address || "",
          city: orderData.client?.city || "",
          state: orderData.client?.state || "",
          zip: orderData.client?.zip || "",
          country: orderData.client?.country || "UY",
        },
      },
      total: Number(orderData.totalAmount || 0),

      // Campos extra útiles para backoffice (no afectan a las reglas)
      clientEmail: orderData.clientEmail || "",
      status: orderData.paymentStatus || "pending",
    };

    console.log("🧾 Payload que se guardará en orders:", payload);

    const docRef = await addDoc(collection(db, "orders"), payload);
    console.log("✅ Orden creada con ID:", docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("❌ Error al crear la orden:", error);
    throw error;
  }
}

// ✅ Función para preparar la orden antes de guardarla en Firebase
export function prepareInitialOrderData(
  cartItems: {
    id: string;
    name: string;
    price: number;
    quantity: number;
    customName?: string;
    customNumber?: string;
    variantLabel?: string;
  }[],
  client: {
    name: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  }
): Order {
  const enrichedItems: CartItem[] = cartItems.map((item) => ({
    id: item.id,
    slug: '',
    title: { en: item.name, es: item.name },
    image: '',
    priceUSD: item.price,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    customName: item.customName || '',
    customNumber: item.customNumber || '',
    variantLabel: item.variantLabel || '',
  }));

  const breakdown = calculateCartBreakdown(enrichedItems);
  return {
    id: '',
    cartItems: enrichedItems,
    client: {
      name: client.name,
      email: client.email,
      phone: client.phone || '',
      address: client.address || '',
      city: client.city || '',
      state: client.state || '',
      zip: client.zip || '',
      country: client.country || '',
    },
    clientEmail: client.email,
    totalAmount: breakdown.total,
    breakdown,
    paymentIntentId: '',
    paymentStatus: 'pending',
    paymentMethod: 'Por definir',
    date: new Date().toISOString(),
    estado: 'En proceso',
  };
}

/**
 * 🔧 adjustStockAfterOrder
 * Recorre cada cartItem del pedido y, si el producto tiene stock definido,
 * descuenta la cantidad comprada del stock de la variante correspondiente.
 * Actualmente no se ejecuta automáticamente; debe llamarse desde el backend
 * tras confirmar el pago. Validado contra Firebase.
 *
 * TODO: Integrar esta función en el flujo de finalización de compra real.
 */
export async function adjustStockAfterOrder(cartItems: CartItem[]) {
  for (const item of cartItems) {
    try {
      const productRef = doc(db, "products", item.id);
      const productSnap = await getDoc(productRef);

      if (productSnap.exists()) {
        const productData = productSnap.data();

        // Validar que exista stock y que la variante tenga stock definido
        if (productData.stock && item.variantId && Object.prototype.hasOwnProperty.call(productData.stock, item.variantId)) {
          const currentStock = productData.stock[item.variantId];
          const newStock = Math.max(0, currentStock - item.quantity);

          await updateDoc(productRef, {
            [`stock.${item.variantId}`]: newStock
          });

          console.log(`✅ Stock actualizado para producto ${item.id}, variante ${item.variantId}: de ${currentStock} a ${newStock}`);
        } else {
          console.warn(`⚠️ Variante sin stock definido para producto ${item.id}, variante ${item.variantId}`);
        }
      } else {
        console.warn(`⚠️ Producto no encontrado en Firebase: ${item.id}`);
      }
    } catch (error) {
      console.error("❌ Error ajustando stock:", error);
    }
  }
  // 📝 Esta función está lista pero aún no se ejecuta automáticamente.
  // Integrarla desde el backend una vez completado el flujo de pago real (Stripe o PayPal).
}