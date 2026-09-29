import { useEffect, useState } from 'react';
import type { Product } from '../data/types';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { isPublished, mapCatalogProduct } from '../domain/catalog';
import { fetchProductBySlug } from '../firebase/products';
export function usePublishedProduct(slug: string) {
    const [product, setProduct] = useState<Product | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        let cancelled = false;
        let unsubscribe: (() => void) | undefined;
        setLoading(true);
        setProduct(null);
        setError(null);
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
    // Trusted Firestore reads already exclude all held units. Provider progress belongs to the server queue.
    return { product, loading, error, retry: () => setRevision(v => v + 1) };
}
