// src/utils/createPreference.ts
import { CartItem, ShippingInfo } from "@/data/types";

/**
 * Crea una preferencia de Mercado Pago a través del backend.
 * Devuelve la URL (init_point) o null si no pudo crearla.
 * 
 * Esta función ahora llama al endpoint del backend que maneja
 * las credenciales de forma segura en el servidor.
 */
export const createPreference = async (
  cartItems: CartItem[],
  shippingData: ShippingInfo & { shippingCost?: number }
): Promise<string | null> => {
  try {
    // Validación básica
    if (!cartItems || cartItems.length === 0) {
      console.warn("⚠️ No hay items en el carrito.");
      return null;
    }

    if (!shippingData) {
      console.error("❌ shippingData es requerido");
      return null;
    }

    // Llamar al endpoint del backend
    const response = await fetch("/api/create-mp-preference", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: cartItems,
        shippingData,
      }),
    });

    const data = await response.json().catch(() => ({} as any));

    if (!response.ok) {
      console.error("❌ Error del backend al crear preferencia:", {
        status: response.status,
        error: data.error,
        details: data.details,
      });
      return null;
    }

    const initPoint: string | undefined = data?.init_point;
    
    if (!initPoint) {
      console.error("❌ No se recibió init_point en la respuesta del backend", data);
      return null;
    }

    return initPoint;
  } catch (error) {
    console.error("❌ Error al crear preferencia:", error);
    return null;
  }
};