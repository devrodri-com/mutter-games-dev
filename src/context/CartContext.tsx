import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { listenToCartChanges, parseCartItems, saveCartToFirebase } from '../utils/cartFirebase';
import { enrichCartItems, isSameItem } from '../utils/cartUtils';
import type { CartItem } from '../data/types';
import { toast } from 'react-hot-toast';
import { useLiveCartInventory } from '../hooks/useLiveCartInventory';
import { useAuth } from './AuthContext';
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
const emptyShipping: ShippingData = { name: '', address: '', city: '', departamento: '', state: '', postalCode: '', phone: '', email: '', country: 'UY' };
type CartContextType = {
    items: CartItem[];
    cartItems: CartItem[];
    addToCart: (item: CartItem) => Promise<boolean>;
    updateItem: (item: CartItem, updates: Pick<CartItem, 'quantity'>) => Promise<void>;
    removeItem: (item: CartItem) => Promise<void>;
    clearCart: () => Promise<void>;
    shippingInfo: ShippingData;
    shippingData: ShippingData;
    setShippingInfo: React.Dispatch<React.SetStateAction<ShippingData>>;
    setShippingData: (data: ShippingData) => void;
    validateShippingData: (data: ShippingData) => boolean;
    total: number;
    cartError: string | null;
    cartReady: boolean;
    refreshCart: () => Promise<CartItem[]>;
};
export const CartContext = createContext<CartContextType | undefined>(undefined);
const cacheKey = (owner: string) => `mutter-cart:${owner}`;
const store = (owner: string, next: CartItem[], dirty: boolean) => localStorage.setItem(cacheKey(owner), JSON.stringify({ items: next, dirty }));
export function CartProvider({ children }: {
    children: ReactNode;
}) {
    const { credentialAccess } = useAuth();
    const accessState = useRef(credentialAccess);
    accessState.current = credentialAccess;
    const [uid, setUid] = useState<string | null>(null);
    const [items, setItems] = useState<CartItem[]>([]);
    const itemsRef = useRef<CartItem[]>([]);
    const [cartError, setCartError] = useState<string | null>(null);
    const [cartReady, setCartReady] = useState(false);
    const [shippingInfo, setShippingInfo] = useState<ShippingData>(() => {
        try {
            const raw: unknown = JSON.parse(localStorage.getItem('shippingData') ?? '{}');
            const restored = {...emptyShipping};
            if (raw && typeof raw === 'object') for (const [key,value] of Object.entries(raw)) {
                if (Object.hasOwn(emptyShipping,key) && typeof value === 'string') Object.assign(restored, {[key]:value});
            }
            return restored;
        } catch { return emptyShipping; }
    });
    useEffect(() => {
        // Retain the existing delivery form persistence; credentials are never cached.
        const {name,address,address2,city,state,postalCode,phone,email,country,departamento} = shippingInfo;
        try { localStorage.setItem('shippingData',JSON.stringify({name,address,address2,city,state,postalCode,phone,email,country,departamento})); }
        catch { setCartError('No pudimos guardar los datos de entrega en este dispositivo.'); }
    }, [shippingInfo]);
    const revision = useRef(0);
    const accessGeneration = useRef(0);
    const pending = useRef(0);
    const queue = useRef<Promise<void>>(Promise.resolve());
    const activeUid = useRef<string | null>(null);
    const unsynced = useRef(false);
    const fail = (error: unknown) => { const message = error instanceof Error ? error.message : 'No pudimos sincronizar el carrito.'; setCartError(message); toast.error(message); };
    const show = (next: CartItem[]) => { itemsRef.current = next; setItems(next); };
    const ownsAccess = (owner: string, generation: number) => activeUid.current === owner && accessState.current === 'active' && accessGeneration.current === generation;
    useEffect(() => onAuthStateChanged(auth, user => { activeUid.current = user?.uid ?? null; setUid(user?.uid ?? null); revision.current++; accessGeneration.current++; }), []);
    useEffect(() => {
        const generation = ++accessGeneration.current;
        revision.current++;
        if (!uid)
            return;
        let stopped = false;
        setCartReady(false);
        setCartError(null);
        show([]);
        let cached: CartItem[] = [];
        let dirty = false;
        try {
            const raw = localStorage.getItem(cacheKey(uid));
            if (raw) {
                const data: unknown = JSON.parse(raw);
                if (!data || typeof data !== 'object' || !('items' in data))
                    throw new Error('Carrito local inválido.');
                cached = parseCartItems(data.items);
                dirty = 'dirty' in data && data.dirty === true;
            }
            else if (!localStorage.getItem('mutter-cart-migrated')) {
                const legacy = localStorage.getItem('cartItems');
                if (legacy) {
                    cached = parseCartItems(JSON.parse(legacy));
                    dirty = cached.length > 0;
                }
                store(uid, cached, dirty);
                localStorage.setItem('mutter-cart-migrated', 'yes');
            }
            show(cached);
        }
        catch (error) {
            fail(error);
            return;
        }
        unsynced.current = dirty;
        if (credentialAccess !== 'active') {
            setCartError(credentialAccess === 'pending' ? 'Tu carrito se conserva. Recuperá el acceso para continuar.' : 'Estamos comprobando el acceso a tu carrito.');
            return;
        }
        const restore = async (next: CartItem[]) => {
            if (stopped || !ownsAccess(uid, generation))
                return;
            const version = ++revision.current;
            try {
                const current = await enrichCartItems(next);
                if (stopped || version !== revision.current || !ownsAccess(uid, generation))
                    return;
                show(current);
                store(uid, current, false);
                setCartReady(true);
                setCartError(null);
            }
            catch (error) {
                if (!stopped && version === revision.current && ownsAccess(uid, generation)) {
                    setCartReady(false);
                    fail(error);
                }
            }
        };
        let stop: undefined | (() => void);
        const initialize = async () => {
            try {
                if (dirty) {
                    const restoreRevision = revision.current;
                    const operation = queue.current.then(() => {
                        if (!ownsAccess(uid, generation)) throw new Error('Cambió el acceso antes de restaurar.');
                        return saveCartToFirebase(uid, cached);
                    });
                    queue.current = operation.catch(() => undefined);
                    await operation;
                    if (stopped || !ownsAccess(uid, generation))
                        return;
                    if (restoreRevision === revision.current) {
                        store(uid, cached, false);
                        unsynced.current = false;
                    }
                }
                if (stopped || !ownsAccess(uid, generation))
                    return;
                stop = listenToCartChanges(uid, (next, exists) => { if (!stopped && ownsAccess(uid, generation) && !pending.current && !unsynced.current)
                    void restore(exists ? next : []); }, error => { if (!stopped && ownsAccess(uid, generation)) fail(error); });
            }
            catch (error) {
                if (!stopped && ownsAccess(uid, generation))
                    fail(error);
            }
        };
        void initialize();
        return () => { stopped = true; stop?.(); };
    }, [uid, credentialAccess]);
    const persist = async (next: CartItem[]) => {
        if (!uid || activeUid.current !== uid || accessState.current !== 'active') {
            fail(new Error('Tu carrito se conserva. Comprobá o recuperá el acceso para continuar.'));
            return false;
        }
        const owner = uid;
        const generation = accessGeneration.current;
        revision.current++;
        pending.current++;
        unsynced.current = true;
        show(next);
        setCartReady(false);
        try {
            store(owner, next, true);
        }
        catch (error) {
            pending.current--;
            fail(error);
            return false;
        }
        const operation = queue.current.then(async () => {
            if (!ownsAccess(owner, generation))
                throw new Error('Cambió el acceso antes de guardar.');
            await saveCartToFirebase(owner, next);
        });
        queue.current = operation.catch(() => undefined);
        try {
            await operation;
            if (!ownsAccess(owner, generation))
                return false;
            if (activeUid.current === owner && pending.current === 1) {
                store(owner, next, false);
                unsynced.current = false;
                setCartError(null);
                try {
                    // Keep the write's acknowledgement from starting a competing restore.
                    await refreshCurrentCart(1);
                }
                catch {
                    return false;
                }
            }
        }
        catch (error) {
            if (ownsAccess(owner, generation))
                fail(error);
            return false;
        }
        finally {
            pending.current--;
        }
        return true;
    };
    const refreshCurrentCart = async (expectedPending: 0 | 1): Promise<CartItem[]> => {
        const owner = uid;
        const generation = accessGeneration.current;
        const version = ++revision.current;
        setCartReady(false);
        try {
            if (!owner || !ownsAccess(owner, generation)) throw new Error('Tu carrito se conserva. Recuperá el acceso para continuar.');
            if (pending.current !== expectedPending) throw new Error('El carrito cambió. Revisalo antes de continuar.');
            if (unsynced.current && !pending.current) {
                const next = itemsRef.current;
                const operation = queue.current.then(() => {
                    if (!ownsAccess(owner, generation) || version !== revision.current || pending.current) throw new Error('Cambió el carrito o el acceso antes de guardar.');
                    return saveCartToFirebase(owner, next);
                });
                queue.current = operation.catch(() => undefined);
                await operation;
                if (!ownsAccess(owner, generation)) throw new Error('Cambió el acceso mientras guardábamos el carrito.');
                if (version !== revision.current || pending.current) throw new Error('El carrito cambió. Revisalo antes de continuar.');
                unsynced.current = false;
                store(owner, next, false);
            }
            const current = await enrichCartItems(itemsRef.current);
            if (!ownsAccess(owner, generation)) throw new Error('Cambió el acceso mientras comprobábamos el carrito.');
            if (version !== revision.current || pending.current !== expectedPending)
                throw new Error('El carrito cambió. Revisalo antes de continuar.');
            show(current);
            store(owner, current, false);
            setCartReady(true);
            setCartError(null);
            return current;
        }
        catch (error) {
            if (owner && ownsAccess(owner, generation)) fail(error);
            throw error;
        }
    };
    const refreshCart = (): Promise<CartItem[]> => refreshCurrentCart(0);
    const addToCart = async (item: CartItem) => {
        try {
            const version = revision.current;
            const next = [...itemsRef.current];
            const index = next.findIndex(existing => isSameItem(existing, item));
            if (index >= 0)
                next[index] = { ...next[index], quantity: next[index].quantity + item.quantity };
            else
                next.push(item);
            const current = await enrichCartItems(next);
            if (version !== revision.current) throw new Error('El carrito cambió. Volvé a agregar el producto.');
            if (current.some(i => i.availability !== 'available'))
                throw new Error('La opción seleccionada ya no está disponible. Revisá tu carrito.');
            return await persist(current);
        }
        catch (error) {
            fail(error);
            return false;
        }
    };
    const removeItem = async (target: CartItem) => { await persist(itemsRef.current.filter(item => !isSameItem(item,target))); };
    const updateItem = async (target: CartItem, updates: Pick<CartItem, 'quantity'>) => { await persist(itemsRef.current.map(item => isSameItem(item,target) ? { ...item, ...updates } : item).filter(item => item.quantity > 0)); };
    const clearCart = async () => { await persist([]); };
    const visibleItems = useLiveCartInventory(uid, items);
    const total = visibleItems.reduce((sum, item) => sum + (Number.isFinite(item.priceUSD) ? item.priceUSD * item.quantity : 0), 0);
    return <CartContext.Provider value={{ items: visibleItems, cartItems: visibleItems, addToCart, removeItem, updateItem, clearCart, shippingInfo, shippingData: shippingInfo, setShippingInfo, setShippingData: setShippingInfo, validateShippingData: data => Boolean(data.name && data.address && data.city && data.state && data.phone && data.email), total, cartError, cartReady, refreshCart }}>{children}</CartContext.Provider>;
}
export function useCart() { const context = useContext(CartContext); if (!context)
    throw new Error('useCart debe usarse dentro de CartProvider'); return context; }
