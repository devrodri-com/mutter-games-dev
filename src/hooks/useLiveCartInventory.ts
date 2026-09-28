import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { CartItem, Product } from '../data/types';
import { currentCartItem, isPublished, mapCatalogProduct } from '../domain/catalog';
type ObservedProduct = Product | null | 'unverified';
export function useLiveCartInventory(uid: string | null, items: CartItem[]): CartItem[] {
    const ids = [...new Set(items.map(item => item.id))].sort();
    const idsKey = JSON.stringify(ids);
    const currentIds = useRef(ids);
    currentIds.current = ids;
    const [observed, setObserved] = useState<{ uid: string; idsKey: string; products: Map<string, ObservedProduct> } | null>(null);
    useEffect(() => {
        if (!uid) return;
        let stopped = false;
        const update = (id: string, product: ObservedProduct) => {
            if (stopped || auth.currentUser?.uid !== uid) return;
            setObserved(previous => {
                const products = previous?.uid === uid && previous.idsKey === idsKey ? new Map(previous.products) : new Map<string, ObservedProduct>();
                products.set(id, product);
                return { uid, idsKey, products };
            });
        };
        const stops = currentIds.current.map(id => onSnapshot(doc(db, 'products', id), { includeMetadataChanges: true }, snapshot => {
            if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
            try {
                update(id, snapshot.exists() && isPublished(snapshot.data()) ? mapCatalogProduct(id, snapshot.data()) : null);
            } catch { update(id, 'unverified'); }
        }, () => update(id, 'unverified')));
        return () => { stopped = true; stops.forEach(stop => stop()); };
    }, [uid, idsKey]);
    // This is a projection of current selections only. Never persist snapshots or alter the edit queue.
    return items.map(item => {
        const product = observed?.uid === uid && observed.idsKey === idsKey ? observed.products.get(item.id) : undefined;
        if (product === 'unverified') return { ...item, availability: 'unverified' };
        return product === undefined ? item : currentCartItem(item, product);
    });
}
