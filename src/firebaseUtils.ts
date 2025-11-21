// src/firebaseUtils.ts

import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore, initializeFirestore, doc as firestoreDoc, setDoc, getDoc as firestoreGetDoc, collection, getDocs, addDoc, doc, updateDoc, deleteDoc, getDoc, query, orderBy, serverTimestamp, where } from "firebase/firestore";
import app from "./firebase";
// Firestore: inicialización segura (evita crash si ya fue inicializado en otro módulo)
export const db = (() => {
  try {
    return initializeFirestore(app, {
      experimentalForceLongPolling: true,
      experimentalAutoDetectLongPolling: true,
      ignoreUndefinedProperties: true,
    });
  } catch {
    // Si ya existe una instancia, obtenerla sin reconfigurar
    return getFirestore(app);
  }
})();
export const auth = getAuth(app);
// 🔎 Debug info del proyecto Firebase
import { getApp } from "firebase/app";
const firebaseProjectInfo = getApp().options;
if (import.meta?.env?.DEV) console.log("🔥 Firebase Project Info:", firebaseProjectInfo);
// Normaliza emails para usarlos como ID de documento
const normalizeEmail = (e: string) => e.trim().toLowerCase();

// 🔎 Helper para depurar: obtener el UID actual (anónimo o logueado)
export async function getCurrentUid(): Promise<string> {
  return ensureAuthedUid();
}

// ✅ Garantiza que haya un usuario autenticado (anónimo si es necesario)
export async function ensureAuthedUid(): Promise<string> {
  const a = auth || getAuth(app);
  if (a.currentUser) return a.currentUser.uid;

  await signInAnonymously(a);

  // Esperar a que onAuthStateChanged nos devuelva el usuario
  const uid = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout esperando uid anónimo")), 5000);
    const unsub = onAuthStateChanged(a, (user) => {
      if (user) {
        clearTimeout(timeout);
        unsub();
        resolve(user.uid);
      }
    }, (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  return uid;
}

import { Product, ClientWithId } from "./data/types";
import type { CartItem } from "./data/types";

// ============================================================================
// === LECTURAS PÚBLICAS / CLIENTE === (continuación)
// ============================================================================

export async function fetchClientsFromFirebase(): Promise<ClientWithId[]> {
  const clientsRef = collection(db, "clients");
  const q = query(clientsRef, orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => {
    const x = docSnap.data() as any;
    return {
      id: docSnap.id,
      name: x.name || x.fullName || "-",
      email: (x.email || "").toLowerCase(),
      phone: x.phone || x.phoneNumber || "",
      address: x.address || x.addressLine1 || "",
      city: x.city || "",
      state: x.state || x.department || "",
      zip: x.zip || x.postalCode || "",
      country: x.country || "",
      // opcionales (no rompen si el tipo no los define)
      createdAt: x.createdAt,
      updatedAt: x.updatedAt,
    } as any;
  });
}

// ============================================================================
// === OPERACIONES ADMIN (CLIENTES / ADMIN USERS) ===
// ============================================================================
// Funciones administrativas que gestionan clientes y usuarios administradores.
// ⚠️ CRÍTICO: Estas operaciones deberían estar protegidas por validación de roles en el backend.

export async function deleteClientFromFirebase(clientId: string) {
  try {
    throw new Error(
      "deleteClientFromFirebase está deshabilitada en el frontend. Usa el backend /api/admin/clients para eliminar clientes."
    );
  } catch (error) {
    console.error("❌ Intento de uso de deleteClientFromFirebase en frontend:", error);
    throw error;
  }
}

// ============================================================================
// === LECTURAS PÚBLICAS / CLIENTE === (continuación)
// ============================================================================

// ============================================================================
// === INTEGRACIONES EXTERNAS (CJ, ETC.) ===
// ============================================================================
// Funciones que interactúan con servicios externos para importar o sincronizar datos.

// 🔥 Función para importar un producto desde CJ Dropshipping por su ID
export async function importProductFromCJ(cjProductId: string) {
  try {
    const response = await fetch(`https://developers.cjdropshipping.com/api2.0/v1/product/getProductInfo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CJ-ACCESS-TOKEN": "AQUI_TU_TOKEN_CJ" // Reemplazar por tu token real
      },
      body: JSON.stringify({
        productSkuId: cjProductId
      })
    });

    const result = await response.json();
    if (!result || !result.data) throw new Error("Producto no encontrado en CJ");

    const data = result.data;

    const newProduct = {
      title: data.name,
      name: data.name,
      images: data.productImageInfoList?.map((img: any) => img.imageUrl) || [],
      priceUSD: parseFloat(data.productInfo?.sellPrice || "0"),
      slug: `${cjProductId}-${data.name.toLowerCase().replace(/\s+/g, "-")}`,
      description: data.productInfo?.description || "",
      category: { id: "", name: "Dropshipping" },
      subcategory: { id: "", name: "CJ" },
      active: true,
      variants: data.productVariantInfoList?.map((variant: any) => ({
        id: variant.variantSku,
        name: variant.variantKey, // ejemplo: "Red / XL"
        image: variant.imageUrl,
        price: parseFloat(variant.sellPrice),
      })) || [],
    };

    const productsCollection = collection(db, "products");
    const docRef = await addDoc(productsCollection, newProduct);
    if (import.meta?.env?.DEV) {
      console.log("Producto importado desde CJ con ID:", docRef.id);
    }
    return docRef.id;
  } catch (error) {
    console.error("Error importando producto desde CJ:", error);
    throw error;
  }
}

// ============================================================================
// === LECTURAS PÚBLICAS / CLIENTE === (continuación)
// ============================================================================

// 🔥 Función para guardar un pedido completo en Firebase
// 🔥 Función para guardar un pedido completo en Firebase (compatible con reglas)

// Función para registrar cliente (con o sin usuario Firebase Auth)
import type { Client } from "./data/types";
interface RegisterClientOptions {
  client: Client;
  password?: string;
  shouldRegister: boolean;
}

export const registerClient = async ({
  client,
  password,
  shouldRegister,
}: RegisterClientOptions): Promise<void> => {
  const auth = getAuth();
  const dbFirestore = db;

  try {
    let uid = "";
    const clientDocRef = firestoreDoc(dbFirestore, "clients", client.email);

    if (shouldRegister && password) {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        client.email,
        password
      );
      uid = userCredential.user.uid;
    }

    const existingDoc = await firestoreGetDoc(clientDocRef);

    await setDoc(clientDocRef, {
      ...client,
      updatedAt: new Date().toISOString(),
      uid: uid || (existingDoc.exists() ? existingDoc.data()?.uid || "" : ""),
    });
  } catch (error: any) {
    console.error("Error al registrar cliente:", error);
    throw error;
  }
};


// 🔥 Función para guardar un cliente en Firebase (sin registrar Auth)
export async function saveClientToFirebase(client: Client): Promise<void> {
  try {
    const dbFirestore = db;
    const id = (client as any)?.uid ? String((client as any).uid) : client.email.toLowerCase();
    const clientDocRef = firestoreDoc(dbFirestore, "clients", id);

    const existingDoc = await firestoreGetDoc(clientDocRef);

    await setDoc(
      clientDocRef,
      {
        ...client,
        email: (client.email || "").toLowerCase(),
        updatedAt: serverTimestamp(),
        // si ya existe, preserva el createdAt original
        ...(existingDoc.exists() ? {} : { createdAt: serverTimestamp() }),
        uid: (client as any)?.uid || (existingDoc.exists() ? existingDoc.data()?.uid || "" : ""),
        active: true,
        source: (client as any)?.source || "manual",
      },
      { merge: true }
    );

    if (import.meta?.env?.DEV) console.log("✅ Cliente guardado/actualizado en Firebase:", id);
  } catch (error) {
    console.error("❌ Error al guardar cliente en Firebase:", error);
    throw error;
  }
}

export async function upsertClientFromCheckout(input: {
  uid?: string | null;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  address2?: string;
  city?: string;
  department?: string;
  postalCode?: string;
  country?: string;
  source?: "checkout";
}) {
  const dbFirestore = db;
  const emailKey = (input.email ?? "").trim().toLowerCase();
  const id = (input.uid && String(input.uid)) || emailKey;
  if (!id) return;

  const ref = firestoreDoc(dbFirestore, "clients", id);
  const prev = await firestoreGetDoc(ref);

  await setDoc(
    ref,
    {
      name: input.name ?? "",
      email: emailKey,
      phone: input.phone ?? "",
      address: input.address ?? "",
      address2: input.address2 ?? "",
      city: input.city ?? "",
      state: input.department ?? "",
      postalCode: input.postalCode ?? "",
      country: input.country ?? "",
      source: input.source ?? "checkout",
      active: true,
      updatedAt: serverTimestamp(),
      ...(prev.exists() ? {} : { createdAt: serverTimestamp() }),
      uid: input.uid ?? (prev.exists() ? prev.data()?.uid || "" : ""),
    },
    { merge: true }
  );
}




// 🔥 Función para descontar stock de una variante específica de un producto
export async function decrementVariantStock(productId: string, variantId: string, quantity: number) {
  try {
    const productRef = doc(db, "products", productId);
    const productSnap = await getDoc(productRef);

    if (!productSnap.exists()) {
      console.warn(`Producto con ID ${productId} no encontrado.`);
      return;
    }

    const productData = productSnap.data() as Product;

    if (!productData.variants) {
      console.warn(`Producto con ID ${productId} no tiene variantes.`);
      return;
    }

    const updatedVariants = productData.variants.map((variant) => {
      const updatedOptions = variant.options.map((option) => {
        if (option.variantId === variantId) {
          const newStock = (option.stock || 0) - quantity;
          return {
            ...option,
            stock: newStock < 0 ? 0 : newStock,
          };
        }
        return option;
      });

      return {
        ...variant,
        options: updatedOptions,
      };
    });

    await updateDoc(productRef, {
      variants: updatedVariants,
    });
  } catch (error) {
    console.error("Error al descontar stock:", error);
  }
}


// ============================================================================
// === OPERACIONES ADMIN (CLIENTES / ADMIN USERS) === (continuación)
// ============================================================================

// 🔥 Función para registrar un usuario administrador tanto en Auth como en Firestore
export async function registerAdminUser({
  name,
  email,
  password,
  isSuperAdmin = false,
}: {
  name: string;
  email: string;
  password: string;
  isSuperAdmin?: boolean;
}): Promise<void> {
  try {
    throw new Error(
      "registerAdminUser está deshabilitada en el frontend. Usa el backend /api/admin/users para gestionar administradores."
    );
  } catch (error) {
    console.error("❌ Intento de uso de registerAdminUser en frontend:", error);
    throw error;
  }
}
// ✅ Descuenta stock por cada item en la orden confirmada (usando variantLabel)
export const discountStockByOrder = async (order: {
  cartItems: CartItem[];
}): Promise<void> => {
  if (!Array.isArray(order.cartItems)) return;

  for (const item of order.cartItems) {
    const { id: productId, variantId, quantity, variantLabel } = item;
    if (!productId || !variantLabel || !quantity) continue;

    const productRef = doc(db, "products", productId);
    const productSnap = await getDoc(productRef);

    if (!productSnap.exists()) continue;

    const productData = productSnap.data() as Product;
    const variants = productData.variants || [];

    let stockTotal = 0;

    const updatedVariants = variants.map((variant) => {
      if (
        (variant.label?.es || variant.label?.en) === variantLabel &&
        Array.isArray(variant.options)
      ) {
        const updatedOptions = variant.options.map((option) => {
          if (typeof option.stock === "number") {
            const newStock = Math.max(0, option.stock - quantity);
            stockTotal += newStock;
            return {
              ...option,
              stock: newStock,
            };
          }
          stockTotal += option.stock || 0;
          return option;
        });

        return {
          ...variant,
          options: updatedOptions,
        };
      }

      // Sumar stock de variantes que no fueron tocadas
      if (Array.isArray(variant.options)) {
        variant.options.forEach((opt) => {
          stockTotal += opt.stock || 0;
        });
      }

      return variant;
    });

    await updateDoc(productRef, {
      variants: updatedVariants,
      stockTotal,
    });
  }
};

// ============================================================================
// === OPERACIONES ADMIN (CLIENTES / ADMIN USERS) === (continuación)
// ============================================================================

// 🔐 Obtener todos los usuarios administradores
export async function fetchAdminUsers(): Promise<
  { id: string; nombre: string; email: string; rol: string; activo: boolean }[]
> {
  throw new Error(
    "fetchAdminUsers está deshabilitada en el frontend. Usa el backend /api/admin/users para obtener la lista de administradores."
  );
}

// 🔐 Obtener un usuario administrador por email (para login)
export async function getAdminUserByEmail(email: string): Promise<{
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
} | null> {
  throw new Error(
    "getAdminUserByEmail está deshabilitada en el frontend. Usa el backend /api/admin/users para resolver administradores por email."
  );
}
// 🔐 Login de administrador: autentica con Auth y garantiza que exista su doc en adminUsers
export async function signInAdmin(email: string, password: string): Promise<{
  uid: string;
  adminDocCreated: boolean;
}> {
  throw new Error(
    "signInAdmin está deshabilitada en el frontend. Usa el flujo de autenticación estándar de Firebase Auth y el backend /api/admin/users para login de administradores."
  );
}

// 🔐 Enviar email de reseteo de contraseña para admins
export async function sendAdminPasswordReset(email: string): Promise<void> {
  throw new Error(
    "sendAdminPasswordReset está deshabilitada en el frontend. Usa el backend para enviar reseteos de contraseña de administradores."
  );
}
// Utilidad: devuelve true si el usuario actual está autenticado
export function isAuthed(): boolean {
  return !!auth.currentUser;
}