import { useEffect, useState } from 'react';
import type { Product } from '../data/types';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { refreshAvailability } from '../utils/createPreference';
import { isPublished, mapCatalogProduct } from '../domain/catalog';
import { fetchProductBySlug } from '../firebase/products';
export function usePublishedProduct(slug: string) {
    const [product, setProduct] = useState<Product | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [revision, setRevision] = useState(0);
    const [availabilityError, setAvailabilityError] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        let unsubscribe: (() => void) | undefined;
        setLoading(true);
        setProduct(null);
        setError(null);
        setAvailabilityError(null);
        if (!slug) {
            setLoading(false);
            return;
        }
        void fetchProductBySlug(slug).then(next => {
            if (cancelled) return;
            setProduct(next);
            if (next) unsubscribe = onSnapshot(doc(db,'products',next.id), {includeMetadataChanges:true}, snapshot => {
                if (cancelled || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
                try { setProduct(snapshot.exists() && isPublished(snapshot.data()) ? mapCatalogProduct(snapshot.id,snapshot.data()) : null); }
                catch { setProduct(null);setError('No pudimos verificar el producto. Intentá nuevamente.'); }
            }, () => { if (!cancelled) {setProduct(null);setError('No pudimos verificar el producto. Intentá nuevamente.');} });
        }).catch(() => { if (!cancelled)
            setError('No pudimos verificar el producto. Intentá nuevamente.'); }).finally(() => { if (!cancelled)
            setLoading(false); });
        return () => { cancelled = true; unsubscribe?.(); };
    }, [slug, revision]);
    const productId = product?.id;
    const hasReservations = product?.hasWebReservations === true;
    useEffect(() => {
        if (!productId) return;
        let stopped = false;
        let checking = false;
        const check = async () => {
            if (checking || !auth.currentUser) return;
            checking = true;
            try {
                await refreshAvailability([productId]);
                if (!stopped) setAvailabilityError(null);
            } catch {
                if (!stopped) setAvailabilityError('No pudimos verificar la disponibilidad. Intentá nuevamente.');
            } finally { checking = false; }
        };
        const unsubscribe = onAuthStateChanged(auth, user => { if (user) void check(); });
        const focus = () => { void check(); };
        window.addEventListener('focus', focus);
        // Only the server can remove an expired hold after checking the provider.
        const interval = hasReservations ? window.setInterval(focus, 30_000) : undefined;
        return () => { stopped = true; unsubscribe(); window.removeEventListener('focus', focus); if (interval !== undefined) window.clearInterval(interval); };
    }, [productId, hasReservations, revision]);
    return { product, loading, error: error ?? availabilityError, retry: () => { setAvailabilityError(null); setRevision(v => v + 1); } };
}
