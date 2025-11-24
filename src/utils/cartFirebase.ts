//src/utils/cartFirebase.ts
import { db } from "../firebase"; // Asegurate de tener esta exportación desde tu config
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { CartItem } from "../data/types";

const isIOS = typeof navigator !== "undefined" &&
  /iP(hone|od|ad)/.test(navigator.userAgent);

async function ensureUid(): Promise<string> {
  const auth = getAuth();
  // 1) Si ya hay usuario, devolver su UID
  if (auth.currentUser?.uid) {
    return auth.currentUser.uid;
  }
  // 2) Intentar login anónimo si no hay usuario
  try {
    await signInAnonymously(auth);
  } catch (e: any) {
    // Si Anónimo no está habilitado, log explícito para detectar el origen
    console.error("❌ No se pudo hacer signInAnonymously. ¿Habilitaste 'Anonymous' en Firebase Auth?", e?.code || e);
    throw e;
  }
  // 3) Esperar a que Auth propague el usuario
  const uid = await new Promise<string>((resolve, reject) => {
    const off = onAuthStateChanged(
      auth,
      (user) => {
        if (user?.uid) {
          off();
          resolve(user.uid);
        }
      },
      (err) => {
        reject(err);
      }
    );
  });
  return uid;
}

export async function saveCartToFirebase(
  uid: string,
  items: CartItem[],
  options?: { allowEmptyWrite?: boolean }
) {
  // Usamos siempre el UID autenticado para cumplir con las rules
  const safeUid = await ensureUid();
  console.log("🆔 [saveCart] usando uid:", safeUid);
  try {
    console.log("🔥 Data que se intenta guardar en Firebase:", items);

    // Filtrar items inválidos y limpiar undefined
    const validItems = (items || []).filter(
      (item) =>
        item &&
        item.slug &&
        item.title &&
        typeof item.price === "number" &&
        typeof item.quantity === "number"
    );

    if (validItems.length !== (items || []).length) {
      console.warn("⚠️ Se detectaron items inválidos que no serán guardados en Firebase.");
    }

    const sanitizedItems = validItems.map((item) => {
      const cleanItem: any = {};
      Object.entries(item).forEach(([key, value]) => {
        if (value !== undefined) cleanItem[key] = value;
      });
      return cleanItem as CartItem;
    });

    const cartRef = doc(db, "carts", safeUid);
    const remoteSnap = await getDoc(cartRef);
    const remoteItems: CartItem[] =
      remoteSnap.exists() && Array.isArray(remoteSnap.data().cartItems)
        ? remoteSnap.data().cartItems
        : [];

    // Helpers de comparación (solo lo relevante para la compra)
    const normalize = (arr: CartItem[]) =>
      (arr || [])
        .map((it) => ({ slug: it.slug, quantity: it.quantity, price: it.price }))
        .sort((a, b) => a.slug.localeCompare(b.slug));

    const arraysEqual = (a: CartItem[], b: CartItem[]) => {
      const A = normalize(a);
      const B = normalize(b);
      if (A.length !== B.length) return false;
      for (let i = 0; i < A.length; i++) {
        if (A[i].slug !== B[i].slug || A[i].quantity !== B[i].quantity || A[i].price !== B[i].price) {
          return false;
        }
      }
      return true;
    };

    // ✅ Evitar que un estado temporal vacío borre el remoto sin intención
    if (sanitizedItems.length === 0) {
      if (options?.allowEmptyWrite) {
        await setDoc(cartRef, { cartItems: [], updatedAt: serverTimestamp() }, { merge: true });
        console.log("🧹 Carrito vacío guardado en Firebase (allowEmptyWrite=true).");
      } else {
        if (remoteItems.length > 0) {
          console.log("⏭️ Skip empty write: remoto tiene items y no se pidió limpiar.");
        } else {
          console.log("⏭️ Skip empty write: ya estaba vacío en remoto.");
        }
      }
      return;
    }

    // ⏭️ Evitar escrituras idénticas (ruido y loops)
    if (arraysEqual(sanitizedItems as any, remoteItems as any)) {
      console.log("⏭️ Skip write: carrito sin cambios reales.");
      return;
    }

    await setDoc(cartRef, { cartItems: sanitizedItems, updatedAt: serverTimestamp() }, { merge: true });
    console.log("✅ Carrito guardado exitosamente en Firebase.");
  } catch (error) {
    console.error("Error saving cart to Firebase:", error);
  }
}

export async function clearCartInFirebase(): Promise<void> {
  const safeUid = await ensureUid();
  const cartRef = doc(db, "carts", safeUid);
  await setDoc(cartRef, { cartItems: [], updatedAt: serverTimestamp() }, { merge: true });
  console.log("🧹 clearCartInFirebase(): carrito limpiado explícitamente en Firebase.");
}

export async function loadCartFromFirebase(uid: string): Promise<CartItem[]> {
  // Nota: ignoramos el uid provisto y usamos el UID autenticado para cumplir con rules (carts/{uid}).
  const safeUid = await ensureUid();
  console.log("🆔 [loadCart] usando uid:", safeUid);
  try {
    const docSnap = await getDoc(doc(db, "carts", safeUid));
    console.log("📄 Snapshot completo:", docSnap);
    console.log("🧪 data() sin procesar:", docSnap.data());
    if (docSnap.exists()) {
      const data = docSnap.data();
      console.log("🧪 Datos crudos cargados desde Firebase:", data);

      if (!data || !Array.isArray(data.cartItems)) {
        console.warn("⚠️ Documento en Firebase no contiene 'cartItems' válidos. Se omite la carga.");
        return [];
      }

      const validItems = data.cartItems.filter(
        (item: CartItem) =>
          item &&
          item.slug &&
          item.title &&
          typeof item.price === "number" &&
          typeof item.quantity === "number"
      );

      if (validItems.length !== data.cartItems.length) {
        console.warn("⚠️ Se detectaron items inválidos al cargar desde Firebase.");
      }

      console.log("✅ Carrito cargado exitosamente desde Firebase.");
      return validItems;
    }
  } catch (error) {
    console.error("Error loading cart from Firebase:", error);
  }
  return [];
}

export async function listenToCartChanges(
  uid: string,
  callback: (items: CartItem[]) => void
): Promise<(() => void) | undefined> {
  // Nota: ignoramos el uid provisto y usamos el UID autenticado para cumplir con rules (carts/{uid}).
  // Siempre usamos el UID autenticado (anónimo o logueado)
  const safeUid = await ensureUid();
  if (isIOS) {
    console.warn("[Cart] Escucha en tiempo real desactivada en iOS (modo experimental).");
    return undefined;
  }
  return onSnapshot(doc(db, "carts", safeUid), (docSnap) => {
    if (docSnap.exists()) {
      const raw = docSnap.data();
      const incoming: any[] = Array.isArray(raw?.cartItems) ? raw.cartItems : [];

      console.log("🧩 Data cruda recibida desde Firebase:", incoming);

      const validItems = (incoming || []).map((item: any) => ({
        ...item,
        price: typeof item.price === "number" ? item.price : parseFloat(item.price) || 0,
        quantity: typeof item.quantity === "number" ? item.quantity : parseInt(item.quantity) || 1,
      }));

      const filteredItems = validItems.filter(
        (item: CartItem) => item && item.slug && item.title && item.price > 0 && item.quantity > 0
      );

      if (filteredItems.length !== (incoming || []).length) {
        console.warn("⚠️ Se detectaron items inválidos en tiempo real al escuchar cambios.");
      }

      callback(filteredItems);
      console.log("✅ Cambios en el carrito detectados y enviados al callback.");
    } else {
      // Si no existe el doc, enviar array vacío explícitamente
      callback([]);
    }
  });
}
// 🔁 Sincroniza carrito: escucha cambios y devuelve el snapshot inicial
export async function loadCartFromFirebaseAndSync(
  uid: string,
  callback: (items: CartItem[]) => void
): Promise<CartItem[]> {
  // Nota: ignoramos el uid provisto y usamos el UID autenticado para cumplir con rules (carts/{uid}).
  const safeUid = await ensureUid();
  const initialItems = await loadCartFromFirebase(safeUid);
  listenToCartChanges(safeUid, callback); // mantener escucha activa
  return initialItems;
}