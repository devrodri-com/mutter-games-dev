// src/firebase/cart.ts

import { doc, setDoc, getDoc } from "firebase/firestore";
import type { CartItem } from "../data/types";
import { db, ensureAuthedUid } from "../firebaseUtils";

async function getCurrentCartRef() {
  const uid = await ensureAuthedUid();
  return { uid, ref: doc(db, "carts", uid) };
}

export async function saveCartToFirebase(uid: string, items: CartItem[]): Promise<void> {
  try {
    const realUid = await ensureAuthedUid();
    const cartRef = doc(db, "carts", realUid);
    await setDoc(cartRef, { items });
    if (import.meta?.env?.DEV) console.log("🛒 Carrito guardado en Firebase (uid):", realUid, items);
  } catch (error) {
    console.error("❌ Error al guardar carrito:", error);
    throw error;
  }
}

export async function getCartFromFirebase(uid: string): Promise<CartItem[]> {
  const realUid = await ensureAuthedUid();
  const docRef = doc(db, "carts", realUid);
  const docSnap = await getDoc(docRef);
  return docSnap.exists() ? docSnap.data().items || [] : [];
}

export async function saveCartAuto(items: CartItem[]): Promise<void> {
  const { uid, ref } = await getCurrentCartRef();
  await setDoc(ref, { items });
  if (import.meta?.env?.DEV) console.log("🛒 [AUTO] Carrito guardado en Firebase (uid):", uid, items);
}

export async function loadCartAuto(): Promise<CartItem[]> {
  const { uid, ref } = await getCurrentCartRef();
  const snap = await getDoc(ref);
  const items = snap.exists() ? (snap.data().items || []) : [];
  if (import.meta?.env?.DEV) {
    if (import.meta?.env?.DEV) console.log("🛒 [AUTO] Carrito cargado desde Firebase (uid):", uid, items);
  }
  return items;
}

