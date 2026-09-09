import { auth, db } from '../firebase';
import { doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import type { CartItem } from '../data/types';
export function parseCartItems(value: unknown): CartItem[] {
    if (!Array.isArray(value))
        throw new Error('El carrito guardado tiene datos inválidos.');
    return value.map((input: unknown): CartItem => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('El carrito guardado tiene datos inválidos.');
        const raw = input as Record<string, unknown>;
        const title = raw.title;
        if (typeof raw.id !== 'string' || typeof raw.slug !== 'string' || typeof raw.quantity !== 'number' || !Number.isSafeInteger(raw.quantity) || raw.quantity < 1 || typeof raw.priceUSD !== 'number' || !Number.isFinite(raw.priceUSD) || !title || typeof title !== 'object' || !('es' in title) || typeof title.es !== 'string' || !('en' in title) || typeof title.en !== 'string')
            throw new Error('El carrito guardado tiene datos inválidos.');
        const optional: Partial<CartItem> = {};
        for (const key of ['variantId','variantLabel','customName','customNumber','options','subtitle'] as const) {
            if (raw[key] !== undefined && raw[key] !== null) {
                if (typeof raw[key] !== 'string') throw new Error('La opción guardada tiene datos inválidos.');
                optional[key] = raw[key];
            }
        }
        return {id:raw.id,slug:raw.slug,quantity:raw.quantity,priceUSD:raw.priceUSD,price:raw.priceUSD,title:{es:title.es,en:title.en},name:typeof raw.name==='string'?raw.name:title.es,image:typeof raw.image==='string'?raw.image:'',...optional,availability:'unverified'};
    });
}
function owner(uid: string) { if (auth.currentUser?.uid !== uid)
    throw new Error('Cambió la sesión. Volvé a abrir el carrito.'); return doc(db, 'carts', uid); }
export async function saveCartToFirebase(uid: string, items: CartItem[]): Promise<void> {
    parseCartItems(items);
    const clean = JSON.parse(JSON.stringify(items));
    await setDoc(owner(uid), { cartItems: clean, updatedAt: serverTimestamp() }, { merge: true });
}
export function listenToCartChanges(uid: string, callback: (items: CartItem[], exists: boolean) => void, onError: (error: Error) => void): () => void {
    return onSnapshot(owner(uid), { includeMetadataChanges: true }, snapshot => {
        // A cache snapshot cannot authoritatively undo an explicit clear or rehydrate stale data.
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)
            return;
        try {
            callback(snapshot.exists() ? parseCartItems(snapshot.data().cartItems) : [], snapshot.exists());
        }
        catch (error) {
            onError(error instanceof Error ? error : new Error('Carrito inválido.'));
        }
    }, onError);
}
