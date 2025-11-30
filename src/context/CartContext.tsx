// src/context/CartContext.tsx

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, ensureAuthReady } from "../firebase";
// import { useAuth } from "./AuthContext";
import { loadCartFromFirebase as loadCartFromFirebaseUtils, saveCartToFirebase, loadCartFromFirebaseAndSync } from "../utils/cartFirebase";
import { enrichCartItems } from "../utils/cartUtils";
import { CartItem } from "../data/types";
import { isSameItem, mergeCartItems } from "../utils/cartUtils";
import { safeParse, setItem, getItem } from "../utils/safeStorage";

// --- ShippingInfo type for createPreference and other uses ---
export interface ShippingInfo {
  nombreCompleto: string;
  direccion: string;
  departamento: string;
  ciudad: string;
  codigoPostal: string;
  telefono: string;
  email: string;
  shippingCost?: number;
}

export type ShippingData = {
  name: string;
  address: string;
  address2?: string;
  city: string;
  departamento: string;
  state: string;
  postalCode: string;
  phone: string;
  email: string;
  country?: string;
  password?: string;
  confirmPassword?: string;
  wantsToRegister?: boolean;
  coordinates?: {
    lat: number;
    lng: number;
  };
  zip?: string;
};

type CartContextType = {
  items: CartItem[];
  cartItems: CartItem[]; // agregado para compatibilidad con componentes que usan cartItems
  addToCart: (item: CartItem) => void;
  updateItem: (id: string | number, variantLabel: string, updates: Partial<CartItem>) => void;
  removeItem: (id: string | number, variantLabel: string) => void;
  clearCart: () => void;
  shippingInfo: ShippingData;
  setShippingInfo: React.Dispatch<React.SetStateAction<ShippingData>>;
  shippingData: ShippingData;
  setShippingData: (data: ShippingData) => void;
  validateShippingData: (data: ShippingData) => boolean;
  total: number;
};

export const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  // const { user } = useAuth();

  const [currentUid, setCurrentUid] = useState<string | null>(null);

  // Escucha cambios de autenticación y actualiza currentUid
  // La autenticación anónima se maneja centralmente en firebase.ts
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        if (import.meta.env.DEV) console.log("[CartContext] UID actualizado:", fbUser.uid);
        setCurrentUid(fbUser.uid);
      } else {
        // Si no hay usuario, delegar en ensureAuthReady() sin crear listeners adicionales
        // firebase.ts manejará el signInAnonymously automáticamente
        ensureAuthReady()
          .then((uid) => {
            if (import.meta.env.DEV) console.log("[CartContext] UID obtenido vía ensureAuthReady:", uid);
            setCurrentUid(uid);
          })
          .catch((e) => {
            console.error("[CartContext] No se pudo obtener UID:", e);
          });
      }
    });
    return () => unsub();
  }, []);

  const hasInitialized = useRef(false);

  const [cartItems, setCartItems] = useState<CartItem[]>(() =>
    safeParse<CartItem[]>("cartItems", [])
  );

  const [loading, setLoading] = useState(true);
  const [cartLoaded, setCartLoaded] = useState(false);

  const [shippingInfo, setShippingInfo] = useState<ShippingData>({
    name: "",
    address: "",
    address2: "",
    city: "",
    state: "",
    postalCode: "",
    phone: "",
    email: "",
    country: "",
    password: "",
    confirmPassword: "",
    wantsToRegister: false,
    coordinates: {
      lat: 0,
      lng: 0,
    },
    zip: "",
    departamento: "Montevideo",
  });

  const [shippingData, setShippingData] = useState<ShippingData>(() =>
    safeParse<ShippingData>("shippingData", {
      name: "",
      address: "",
      city: "",
      state: "",
      postalCode: "",
      country: "",
      phone: "",
      email: "",
      coordinates: {
        lat: 0,
        lng: 0,
      },
    } as ShippingData)
  );

  const validateShippingData = (data: ShippingData): boolean => {
    const requiredFields = ["name", "address", "city", "state", "postalCode", "phone", "email"];
    for (const field of requiredFields) {
      const value = (data as any)[field];
      if (!value || typeof value !== "string" || value.trim() === "") {
        if (import.meta.env.DEV) console.warn(`Campo inválido o vacío: ${field}`);
        return false;
      }
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      if (import.meta.env.DEV) console.warn("Email inválido");
      return false;
    }

    const phoneRegex = /^\d{8,15}$/;
    if (!phoneRegex.test(data.phone)) {
      if (import.meta.env.DEV) console.warn("Teléfono inválido");
      return false;
    }

    return true;
  };

  useEffect(() => {
    if (import.meta.env.DEV) console.log("🟨 useEffect: guardando shippingData en localStorage");
    setItem("shippingData", JSON.stringify(shippingData));
  }, [shippingData]);

  useEffect(() => {
    if (import.meta.env.DEV) console.log("🟨 useEffect: carga carrito desde Firebase según usuario/UID actual");
    if (!currentUid) return;

    const stopAny: unknown = loadCartFromFirebaseAndSync(currentUid, async (itemsFromRealtime) => {
      const incoming = Array.isArray(itemsFromRealtime) ? itemsFromRealtime : [];
      // 🚧 Guardar: si lo que llega de Firebase está vacío pero tengo carrito local, NO piso el local
      if (!incoming || incoming.length === 0) {
        try {
          const local = safeParse<CartItem[]>("cartItems", []);
          if (Array.isArray(local) && local.length > 0) {
          if (import.meta.env.DEV) console.warn("⏭️ Ignorando carrito remoto vacío para no pisar el local existente");
            return; // salimos del callback sin tocar state/localStorage
          }
        } catch {}
      }
      const resolvedItems = await enrichCartItems(incoming || []);
      const safeItems = Array.isArray(resolvedItems) ? resolvedItems : [];
      if (import.meta.env.DEV) console.log("🟩 Items recibidos desde Firebase:", safeItems);
      setCartItems(safeItems);
      setItem("cartItems", JSON.stringify(safeItems));
    });

    return () => {
      if (stopAny && typeof stopAny === "function") {
        stopAny();
      }
    };
  }, [currentUid]);

  const addToCart = (newItem: CartItem) => {
    if (!newItem || !newItem.id) {
      if (import.meta.env.DEV) console.warn("Intento de agregar item inválido al carrito:", newItem);
      return;
    }

    const title =
      typeof newItem.title === "object"
        ? newItem.title
        : {
            es: newItem.title || "",
            en: newItem.title || "",
          };

    const variant =
      newItem.variant && typeof newItem.variant.label === "object"
        ? {
            label: {
              es: newItem.variant.label.es || "Tamaño",
              en: newItem.variant.label.en || "Size"
            }
          }
        : typeof newItem.variantTitle === "object"
        ? {
            label: {
              es: newItem.variantTitle.es || "Tamaño",
              en: newItem.variantTitle.en || "Size"
            }
          }
        : typeof newItem.variantTitle === "string"
        ? {
            label: {
              es: newItem.variantTitle,
              en: newItem.variantTitle
            }
          }
        : undefined;

    const itemToAdd: CartItem = {
      ...newItem,
      title,
      variant: variant as CartItem["variant"],
      quantity: newItem.quantity || 1,
    };

    if (import.meta.env.DEV) console.log("✅ Agregando al carrito:", itemToAdd);

    setCartItems((prevItems) => {
      const existingIndex = prevItems.findIndex(
        (item) =>
          item.id === itemToAdd.id &&
          item.variantLabel === itemToAdd.variantLabel &&
          item.variantId === itemToAdd.variantId
      );

      if (existingIndex !== -1) {
        const updated = [...prevItems];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + itemToAdd.quantity,
        };
        return updated;
      } else {
        return [...prevItems, itemToAdd as CartItem];
      }
    });
  };

  const updateItem = (id: string | number, variantLabel: string, updates: Partial<CartItem>) => {
    setCartItems((prevItems) =>
      prevItems
        .map((item) =>
          item.id?.toString() === id.toString() && item.variantLabel === variantLabel
            ? { ...item, ...updates }
            : item
        )
        .filter((item) => item.quantity > 0) // 🔥 Esto elimina del carrito los de cantidad 0
    );
  };

  const removeItem = (id: string | number, variantLabel: string) => {
    setCartItems((prevItems) => {
      const next = prevItems.filter(
        (item) => !(item.id?.toString() === id.toString() && item.variantLabel === variantLabel)
      );
      // Persistimos inmediatamente para evitar que reaparezca al recargar
      if (currentUid) { try { saveCartToFirebase(currentUid, next); } catch {} }
      setItem("cartItems", JSON.stringify(next));
      return next;
    });
  };

  const clearCart = () => {
    if (import.meta.env.DEV) console.warn("⚠️ setCartItems([]) ejecutado, posible limpieza del carrito");
    setCartItems([]);
    setItem("cartItems", JSON.stringify([]));
    // también vaciamos el carrito remoto para que no reaparezca al recargar
    if (currentUid) {
      try { saveCartToFirebase(currentUid, []); } catch (e) { console.warn("No se pudo vaciar carrito remoto:", e); }
    }
  };

  // Wrapper to sync shippingInfo and shippingData
  const setShippingInfoWrapper = (data: ShippingData) => {
    setShippingInfo(data);
    setShippingData(data); // Sync both states
  };

  // Nueva función calculateCartTotal que suma envío si corresponde a Montevideo
  const calculateCartTotal = () => {
    let total = 0;

    cartItems.forEach((item) => {
      const price = item.price || 0;
      const quantity = item.quantity || 1;
      total += price * quantity;
    });

    if (shippingInfo?.departamento === "Montevideo") {
      total += 169;
    }

    return total;
  };

  // Si existieran funciones con impuestos, las comentamos:
  // const totalWithTax = items.reduce((acc, item) => acc + (item.priceUSD * item.quantity), 0) * 1.075;
  // const finalTotal = items.reduce((acc, item) => acc + (item.priceUSD * item.quantity), 0) * 1.1;

  // Sincronización optimizada y escalable con localStorage para cartItems
  useEffect(() => {
    setItem("cartItems", JSON.stringify(cartItems));
  }, [cartItems]);

  /*
  // Nueva función loadCartFromFirebase con validación y retorno
  const loadCartFromFirebase = async (uid: string): Promise<CartItem[]> => {
    if (!uid) return [];
    try {
      const { doc, getDoc } = await import("firebase/firestore");
      const { db } = await import("../firebaseUtils");
      const docRef = doc(db, "carts", uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const items: CartItem[] = (docSnap.data() as any).items || [];
        // no forzamos setCartItems aquí; dejamos que el caller decida
        return items;
      }
      return [];
    } catch (error) {
      console.error("Error loading cart from Firebase:", error);
      return [];
    }
  };
  */

  // Efecto para recalcular total cuando cambian cartItems o shippingInfo
  const [total, setTotal] = useState<number>(() => calculateCartTotal());
  useEffect(() => {
    setTotal(calculateCartTotal());
  }, [cartItems, shippingInfo]);

  return (
    <CartContext.Provider
      value={{
        items: cartItems,
        cartItems,
        addToCart,
        updateItem,
        clearCart,
        removeItem,
        shippingInfo,
        setShippingInfo: setShippingInfoWrapper as React.Dispatch<React.SetStateAction<ShippingData>>,
        shippingData,
        setShippingData,
        validateShippingData,
        total,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart debe usarse dentro de <CartProvider>");
  }
  return context;
}