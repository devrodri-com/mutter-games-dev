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
console.log("🔥 Firebase Project Info:", firebaseProjectInfo);
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

// ✅ Devuelve una referencia al doc del carrito del usuario actual (uid = doc id)
async function getCurrentCartRef() {
  const uid = await ensureAuthedUid();
  return { uid, ref: doc(db, "carts", uid) };
}

import { Product, Category, ClientWithId } from "./data/types";
import type { Order } from "./data/types";
import type { CartItem } from "./data/types";

// 🔥 Función para traer un producto específico por ID
export async function fetchProductById(id: string): Promise<Product | null> {
  try {
    const ref = doc(db, "products", id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return mapProductData(snap.id, data);
  } catch (error) {
    console.error("Error fetching product by ID:", error);
    return null;
  }
}

// 🔥 Función para traer todos los productos
export async function fetchProducts(): Promise<Product[]> {
  const productsCollection = collection(db, "products");
  const productsSnapshot = await getDocs(productsCollection);

  const productsList = productsSnapshot.docs.map((doc) => {
    const data = doc.data() as any;
    // Defensive handling of title as string or { es, en }
    const rawTitle = data.title;
    const title = {
      es:
        typeof rawTitle === "object" && typeof rawTitle?.es === "string"
          ? rawTitle.es
          : typeof rawTitle === "string"
          ? rawTitle
          : typeof data.titleEs === "string"
          ? data.titleEs
          : "Producto",
      en:
        typeof rawTitle === "object" && typeof rawTitle?.en === "string"
          ? rawTitle.en
          : typeof data.titleEn === "string"
          ? data.titleEn
          : "",
    };

    return {
      id: doc.id,
      slug:
        data.slug ||
        `${doc.id}-${title.es.toLowerCase().replace(/\s+/g, "-")}`,
      name: title.es || data.name || "Producto sin nombre",
      title,
      images: data.images || [],
      priceUSD: data.priceUSD || 0,
      category: data.category || { id: "", name: "" },
      subcategory: data.subcategory || { id: "", name: "" },
      tipo: data.tipo || "",
      subtitle: data.subtitle || "",
      description: data.description || "",
      defaultDescriptionType: data.defaultDescriptionType || "none",
      extraDescriptionTop: data.extraDescriptionTop || "",
      extraDescriptionBottom: data.extraDescriptionBottom || "",
      descriptionPosition: data.descriptionPosition || "bottom",
      active: data.active ?? true,
      customName: data.customName || "",
      customNumber: data.customNumber || "",
      allowCustomization: data.allowCustomization ?? false,
      stockTotal: data.stockTotal ?? 0,
      variants: Array.isArray(data.variants) ? data.variants : [],
      orden: typeof data.orden === "number" ? data.orden : 0,
    } as Product & { orden?: number };
  }) as (Product & { orden?: number })[];

  // ✅ Orden determinista: primero por 'orden' si existe, luego por título ES
  productsList.sort((a, b) => {
    const ao = typeof (a as any).orden === "number" ? (a as any).orden : 0;
    const bo = typeof (b as any).orden === "number" ? (b as any).orden : 0;
    if (ao !== bo) return ao - bo;
    const an = (a.title?.es || a.name || "").toString();
    const bn = (b.title?.es || b.name || "").toString();
    return an.localeCompare(bn, "es");
  });

  console.log("🔥 DEBUG desde firebaseUtils – productos cargados (ordenados):", productsList);
  // Quitar el campo auxiliar 'orden' en el tipo devuelto
  return productsList.map(({ orden, ...rest }) => rest);
}

// 🔥 Función para traer un producto específico por Slug
export async function fetchProductBySlug(productId: string): Promise<Product | null> {
  try {
    const productsCollection = collection(db, "products");
    const productsSnapshot = await getDocs(productsCollection);

    for (const productDoc of productsSnapshot.docs) {
      const data = productDoc.data() as any;
      const baseTitle =
        typeof data.title === "string"
          ? data.title
          : data?.title?.es || data?.name || "producto";
      const computedSlug = data.slug || `${productDoc.id}-${String(baseTitle).toLowerCase().replace(/\s+/g, "-")}`;
      if (computedSlug === productId) {
        return mapProductData(productDoc.id, data);
      }
    }

    return null;
  } catch (error) {
    console.error("Error al obtener producto por Slug:", error);
    return null;
  }
}

function mapProductData(id: string, data: any): Product {
  return {
    id,
    slug:
      data.slug ||
      `${id}-${(typeof data.title === "string" ? data.title : data.title?.es || "producto").toLowerCase().replace(/\s+/g, "-")}`,
    name: data.name || (typeof data.title === "string" ? data.title : data.title?.es) || "Producto sin nombre",
    title: {
      es:
        typeof data.title === "object" && typeof data.title?.es === "string"
          ? data.title.es
          : typeof data.title === "string"
          ? data.title
          : typeof data.titleEs === "string"
          ? data.titleEs
          : "Producto",
      en:
        typeof data.title === "object" && typeof data.title?.en === "string"
          ? data.title.en
          : typeof data.titleEn === "string"
          ? data.titleEn
          : "",
    },
    images: data.images || [],
    priceUSD: data.priceUSD || 0,
    category: data.category || { id: "", name: "" },
    subcategory: data.subcategory || { id: "", name: "" },
    tipo: data.tipo || "",
    subtitle: data.subtitle || "",
    description: data.description || "",
    defaultDescriptionType: data.defaultDescriptionType || "none",
    extraDescriptionTop: data.extraDescriptionTop || "",
    extraDescriptionBottom: data.extraDescriptionBottom || "",
    descriptionPosition: data.descriptionPosition || "bottom",
    active: data.active ?? true,
    // stock and sizes fields related to talles removed
    customName: data.customName || "",
    customNumber: data.customNumber || "",
    allowCustomization: data.allowCustomization ?? false,
    stockTotal: data.stockTotal ?? 0,
    variants: Array.isArray(data.variants) ? data.variants : [],
  };
}

// Las demás funciones (createProduct, updateProduct, etc.) se mantienen igual

export async function createProduct(product: Partial<Product>) {
  try {
    if (!product.slug || typeof product.slug !== "string" || product.slug.trim() === "") {
      const rawTitle =
        typeof product.title === "object"
          ? product.title?.es || product.title?.en
          : product.title;
      const fallback = (rawTitle || "producto-generico")
        .toLowerCase()
        .replace(/\s+/g, "-");
      const subcat =
        typeof product.subcategory?.name === "string"
          ? product.subcategory.name
          : ((product.subcategory?.name as unknown) as { es?: string })?.es || "";
      product.slug = `${fallback}-${subcat.toLowerCase().replace(/\s+/g, "-")}`;
    }

    const productsCollection = collection(db, "products");
    const docRef = await addDoc(productsCollection, product);
    console.log("✅ Producto creado con ID:", docRef.id, "| Slug:", product.slug);
    return docRef.id;
  } catch (error) {
    console.error("❌ Error creando producto:", error);
    throw error;
  }
}

export async function updateProduct(productId: string, updatedData: Partial<Product>) {
  try {
    const productRef = doc(db, "products", productId);
    if (updatedData.variants && Array.isArray(updatedData.variants)) {
      updatedData.variants = updatedData.variants.map((variant) => ({
        ...variant,
        options: variant.options.map((option) => ({
          ...option,
          priceUSD: parseFloat(String(option.priceUSD || 0)),
        })),
      }));
    }
    // Sanea el campo subcategory antes de guardar, asegurando estructura { id, name: string, categoryId: string }
    let updatedProduct = { ...updatedData };
    if (
      updatedData.subcategory &&
      typeof updatedData.subcategory === "object"
    ) {
      const selectedSubcategory = updatedData.subcategory as any;

      let subcategoryName = "";
      if (typeof selectedSubcategory.name === "string") {
        subcategoryName = selectedSubcategory.name;
      } else if (typeof selectedSubcategory.name === "object") {
        subcategoryName = selectedSubcategory.name.es || selectedSubcategory.name.en || "";
      }

      updatedProduct.subcategory = {
        id: selectedSubcategory.id,
        name: subcategoryName,
        categoryId: selectedSubcategory.categoryId || "",
      };
    }

    // 🔒 Eliminamos posibles restos de campos antiguos
    await updateDoc(productRef, updatedProduct);
    console.log("Producto actualizado:", productId);
  } catch (error) {
    console.error("Error actualizando producto:", error);
    throw error;
  }
}

export async function deleteProduct(productId: string) {
  try {
    const productRef = doc(db, "products", productId);
    await deleteDoc(productRef);
    console.log("Producto eliminado:", productId);
  } catch (error) {
    console.error("Error eliminando producto:", error);
    throw error;
  }
}


export async function fetchCategoriesWithSubcategories(): Promise<
  {
    id: string;
    name: string;
    subcategories: { id: string; name: string }[];
  }[]
> {
  const ref = collection(db, "categories");
  const snap = await getDocs(ref);

  const categories = await Promise.all(
    snap.docs.map(async (doc) => {
      const subRef = collection(db, `categories/${doc.id}/subcategories`);
      const subSnap = await getDocs(subRef);
      const subcategories = subSnap.docs.map((subDoc) => ({
        id: subDoc.id,
        name: subDoc.data().name,
      }));
      return {
        id: doc.id,
        name: doc.data().name || "",
        subcategories,
      };
    })
  );

  return categories;
}


export async function createCategory(name: { es: string; en: string }) {
  try {
    const ref = collection(db, "categories");
    await addDoc(ref, { name });
  } catch (error) {
    console.error("Error creando categoría:", error);
    throw error;
  }
}


export async function deleteCategory(id: string) {
  try {
    const ref = doc(db, "categories", id);
    await deleteDoc(ref);
  } catch (error) {
    console.error("Error eliminando categoría:", error);
    throw error;
  }
}

export async function createSubcategory(categoryId: string, subcategoryName: string) {
  try {
    const ref = collection(db, `categories/${categoryId}/subcategories`);
    await addDoc(ref, { name: subcategoryName });
  } catch (error) {
    console.error("Error creando subcategoría:", error);
    throw error;
  }
}

export async function deleteSubcategory(categoryId: string, subcategoryId: string) {
  try {
    const ref = doc(db, `categories/${categoryId}/subcategories/${subcategoryId}`);
    await deleteDoc(ref);
  } catch (error) {
    console.error("Error eliminando subcategoría:", error);
    throw error;
  }
}


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

export async function deleteClientFromFirebase(clientId: string) {
  try {
    const clientRef = doc(db, "clients", clientId);
    await deleteDoc(clientRef);
    console.log("Cliente eliminado:", clientId);
  } catch (error) {
    console.error("Error eliminando cliente:", error);
    throw error;
  }
}

// 🔥 Función para traer subcategorías de una categoría específica
export async function fetchSubcategories(categoryId: string): Promise<{ id: string; name: string; categoryId: string }[]> {
  const ref = collection(db, `categories/${categoryId}/subcategories`);
  const snap = await getDocs(ref);
  return snap.docs.map((doc) => {
    const rawName = doc.data().name;
    const name =
      typeof rawName === "string"
        ? rawName
        : typeof rawName?.es === "string"
        ? rawName.es
        : typeof rawName?.en === "string"
        ? rawName.en
        : "";

    return {
      id: doc.id,
      name,
      categoryId,
    };
  });
}
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
    console.log("Producto importado desde CJ con ID:", docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("Error importando producto desde CJ:", error);
    throw error;
  }
}

// Nueva implementación de fetchCategories que devuelve subcategorías embebidas
export async function fetchCategories(): Promise<Category[]> {
  const ref = collection(db, "categories");
  const snap = await getDocs(ref);

  const categories = await Promise.all(
    snap.docs.map(async (doc) => {
      const rawName = doc.data().name;
      const name =
        typeof rawName === "string"
          ? rawName
          : typeof rawName?.es === "string"
          ? rawName.es
          : typeof rawName?.en === "string"
          ? rawName.en
          : "";

      const subRef = collection(db, `categories/${doc.id}/subcategories`);
      const subSnap = await getDocs(subRef);
      const subcategories = subSnap.docs.map((subDoc) => {
        const raw = subDoc.data().name;
        const subName =
          typeof raw === "string"
            ? raw
            : typeof raw?.es === "string"
            ? raw.es
            : typeof raw?.en === "string"
            ? raw.en
            : "";
        return {
          id: subDoc.id,
          name: subName,
          categoryId: doc.id,
          orden: subDoc.data().orden ?? 0,
        };
      });

      return {
        id: doc.id,
        name,
        categoryId: doc.id,
        subcategories,
        orden: doc.data().orden ?? 0,
      };
    })
  );

  // Ordenar por 'orden' ascendente
  return categories.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

// 🔥 Función para guardar un pedido completo en Firebase
// 🔥 Función para guardar un pedido completo en Firebase (compatible con reglas)
export async function saveOrderToFirebase(order: {
  cartItems: any[];
  client: {
    name: string;
    email: string;
    phone?: string;
    address?: string;
    country?: string;
  };
  totalAmount: number;
  shippingCost?: number;
  paymentIntentId: string;
  paymentStatus: string;
  paymentMethod: string;
  date: string;
  estado: "En proceso" | "Confirmado" | "Cancelado" | "Entregado";
}) {
  try {
    const uid = await ensureAuthedUid();
    const ordersRef = collection(db, "orders");
    // Campos mínimos exigidos por reglas + el resto de tu payload
    const payload = {
      uid,
      createdAt: Date.now(), // las reglas aceptan timestamp o number
      items: order.cartItems || [],
      shipping: {
        cost: Number(order.shippingCost ?? 0),
        address: order.client?.address ?? "",
        country: order.client?.country ?? "",
      },
      total: Number(order.totalAmount ?? 0),

      // Extras de tu app (se conservan)
      client: order.client,
      paymentIntentId: order.paymentIntentId,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      date: order.date,
      estado: order.estado,
    };

    await addDoc(ordersRef, payload);
    console.log("✅ Pedido guardado en Firebase:", payload);
    console.log("🧾 Detalles de la orden:", JSON.stringify(payload, null, 2));

    // Actualizar stock
    await updateStockAfterOrder(order.cartItems);
  } catch (error) {
    console.error("❌ Error al guardar el pedido:", error);
    throw error;
  }
}


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

// 🔎 Mapper robusto: traduce cualquier forma de orden guardada en Firestore
function mapOrderForAdmin(id: string, data: any) {
  // createdAt puede ser Timestamp (toMillis), number o string (date ISO)
  const createdMs =
    (data?.createdAt && typeof data.createdAt?.toMillis === "function"
      ? data.createdAt.toMillis()
      : typeof data?.createdAt === "number"
      ? data.createdAt
      : data?.date
      ? Date.parse(data.date)
      : Date.now());

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
// 🔥 Función para obtener los pedidos reales desde Firebase
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

// 🔥 Función para guardar el carrito en Firebase
export async function saveCartToFirebase(uid: string, items: CartItem[]): Promise<void> {
  try {
    // always ensure auth and force the real uid for security-rules compatibility
    const realUid = await ensureAuthedUid();
    const cartRef = doc(db, "carts", realUid);
    await setDoc(cartRef, { items });
    console.log("🛒 Carrito guardado en Firebase (uid):", realUid, items);
  } catch (error) {
    console.error("❌ Error al guardar carrito:", error);
    throw error;
  }
}

// 🔥 Función para obtener el carrito de Firebase por email
export async function getCartFromFirebase(uid: string): Promise<CartItem[]> {
  const realUid = await ensureAuthedUid();
  const docRef = doc(db, "carts", realUid);
  const docSnap = await getDoc(docRef);
  return docSnap.exists() ? docSnap.data().items || [] : [];
}


// 🆕 Versión AUTO: usa el uid del usuario actual (anónimo o logueado)
export async function saveCartAuto(items: CartItem[]): Promise<void> {
  const { uid, ref } = await getCurrentCartRef();
  await setDoc(ref, { items });
  console.log("🛒 [AUTO] Carrito guardado en Firebase (uid):", uid, items);
}

// 🆕 Versión AUTO: lee el carrito del usuario actual (anónimo o logueado)
export async function loadCartAuto(): Promise<CartItem[]> {
  const { uid, ref } = await getCurrentCartRef();
  const snap = await getDoc(ref);
  const items = snap.exists() ? snap.data().items || [] : [];
  console.log("🛒 [AUTO] Carrito cargado desde Firebase (uid):", uid, items);
  return items;
}


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

    console.log("✅ Cliente guardado/actualizado en Firebase:", id);
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


// 🔥 Actualiza el stock de productos después de un pedido
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
// 🔥 Función para obtener todas las subcategorías embebidas en categorías
export const fetchAllSubcategories = async (): Promise<
  { id: string; name: string; categoryId: string }[]
> => {
  try {
    const categoriesSnapshot = await getDocs(collection(db, "categories"));
    const allSubcategories: { id: string; name: string; categoryId: string }[] = [];

    for (const catDoc of categoriesSnapshot.docs) {
      const categoryId = catDoc.id;
      const subRef = collection(db, "categories", categoryId, "subcategories");
      const subSnap = await getDocs(subRef);

      subSnap.forEach((subDoc) => {
        const rawName = subDoc.data().name;
        const name =
          typeof rawName === "string"
            ? rawName
            : typeof rawName?.es === "string"
            ? rawName.es
            : typeof rawName?.en === "string"
            ? rawName.en
            : "";

        allSubcategories.push({
          id: subDoc.id,
          name,
          categoryId,
        });
      });
    }

    console.log("🧩 Subcategorías embebidas obtenidas:", allSubcategories);
    return allSubcategories;
  } catch (error) {
    console.error("❌ Error al obtener subcategorías embebidas:", error);
    return [];
  }
};
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
    const auth = getAuth();
    const dbFirestore = db;

    // Crear en Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    // Guardar en Firestore
    const userDocRef = firestoreDoc(dbFirestore, "usuarios", email);
    await setDoc(userDocRef, {
      name,
      email,
      uid,
      isSuperAdmin,
      createdAt: new Date().toISOString(),
    });

    console.log("✅ Usuario administrador creado:", email);
  } catch (error: any) {
    console.error("❌ Error al registrar usuario administrador:", error.message || error);
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
// 🔐 Obtener todos los usuarios administradores
export async function fetchAdminUsers(): Promise<
  { id: string; nombre: string; email: string; rol: string; activo: boolean }[]
> {
  const ref = collection(db, "adminUsers");
  const snap = await getDocs(ref);

  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      nombre: data.nombre || "",
      email: data.email || "",
      rol: data.rol || "admin",
      activo: data.activo ?? true,
    };
  });
}

// 🔐 Obtener un usuario administrador por email (para login)
export async function getAdminUserByEmail(email: string): Promise<{
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
} | null> {
  const key = normalizeEmail(email);
  const ref = doc(db, "adminUsers", key);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() as any;
  return {
    id: snap.id,
    nombre: data.nombre || "",
    email: data.email || key,
    rol: data.rol || "admin",
    activo: data.activo ?? true,
  };
}
// 🔐 Login de administrador: autentica con Auth y garantiza que exista su doc en adminUsers
export async function signInAdmin(email: string, password: string): Promise<{
  uid: string;
  adminDocCreated: boolean;
}> {
  const authInst = getAuth(app);
  const cred = await signInWithEmailAndPassword(authInst, email, password);
  const uid = cred.user.uid;

  const dbFs = db;
  const key = normalizeEmail(email);
  const adminRef = firestoreDoc(dbFs, "adminUsers", key);
  const adminSnap = await firestoreGetDoc(adminRef);

  let adminDocCreated = false;
  if (!adminSnap.exists()) {
    await setDoc(adminRef, {
      nombre: "",
      email: key,
      rol: "admin",
      activo: true,
      uid,
      createdAt: new Date().toISOString(),
    });
    adminDocCreated = true;
  }

  return { uid, adminDocCreated };
}

// 🔐 Enviar email de reseteo de contraseña para admins
export async function sendAdminPasswordReset(email: string): Promise<void> {
  const authInst = getAuth(app);
  await sendPasswordResetEmail(authInst, email);
}
// 🔥 Obtener pedidos por email (usado en perfil de cliente) - versión robusta
export async function getOrdersByEmail(email: string): Promise<Order[]> {
  try {
    const q = query(
      collection(db, "orders"),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((doc) => mapOrderForAdmin(doc.id, doc.data()))
      .filter((order) => order.clientEmail?.toLowerCase() === email.toLowerCase());
  } catch (error) {
    console.error("❌ Error al obtener pedidos por email:", error);
    return [];
  }
}
// Utilidad: devuelve true si el usuario actual está autenticado
export function isAuthed(): boolean {
  return !!auth.currentUser;
}