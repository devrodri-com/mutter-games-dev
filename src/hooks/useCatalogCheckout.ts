import { useRef, useState } from 'react';
import { auth } from '../firebase';
import { upsertClientFromCheckout } from '../firebaseUtils';
import { useCart } from '../context/CartContext';
import { purchaseInput, requestQuote, startCheckout, CheckoutRequestError, type CheckoutQuote } from '../utils/createPreference';
import { toast } from 'react-hot-toast';
export function useCatalogCheckout(pickup: boolean) {
    const { items, shippingInfo, refreshCart, cartError } = useCart();
    const busy = useRef(false);
    const [loading, setLoading] = useState(false);
    const [review, setReview] = useState<{
        uid: string;
        content: string;
        quote: CheckoutQuote;
    } | null>(null);
    const [recoveryUid, setRecoveryUid] = useState<string | null>(null);
    const pay = async () => {
        if (busy.current)
            return;
        busy.current = true;
        setLoading(true);
        const uid = auth.currentUser?.uid;
        try {
            if (!uid)
                throw new Error('Sesión no disponible.');
            if (cartError)
                throw new Error('Reintentá la verificación del carrito antes de pagar.');
            const current = await refreshCart();
            if (current.some(i => i.availability !== 'available'))
                throw new Error('Quitá los productos no disponibles antes de continuar.');
            const purchase = purchaseInput(current, shippingInfo, pickup);
            const content = JSON.stringify(purchase);
            const quote = await requestQuote(purchase);
            if (auth.currentUser?.uid !== uid)
                throw new Error('Cambió la sesión. Revisá la compra antes de continuar.');
            if (!review || review.uid !== uid || review.content !== content || review.quote.hash !== quote.hash) {
                setReview({ uid, content, quote });
                return;
            }
            const storageKey = `mutter-checkout:${uid}`;
            let receiptRecorded = false;
            try {
                const stored = localStorage.getItem(storageKey);
                let pending: { key: string; content: string; quoteHash: string; receivedOrderId?: string } | null = null;
                if (stored !== null) {
                    const data: unknown = JSON.parse(stored);
                    if (!data || typeof data !== 'object' || !('key' in data) || typeof data.key !== 'string' || !('content' in data) || typeof data.content !== 'string' || !('quoteHash' in data) || typeof data.quoteHash !== 'string')
                        throw new Error('El intento guardado requiere verificación. No inicies otro pago.');
                    pending = { key: data.key, content: data.content, quoteHash: data.quoteHash };
                    if ('receivedOrderId' in data && typeof data.receivedOrderId === 'string' && data.receivedOrderId.trim())
                        pending.receivedOrderId = data.receivedOrderId;
                }
                receiptRecorded = Boolean(pending?.receivedOrderId);
                const matches = pending?.content === content && pending.quoteHash === quote.hash;
                if (pending && !matches && !pending.receivedOrderId)
                    throw new Error('Hay un intento anterior pendiente de verificación. No inicies otro pago.');
                const key = pending && matches ? pending.key : crypto.randomUUID();
                const attempt = { key, content, quoteHash: quote.hash };
                // Persist the key before sending. A failed write must never admit a start.
                if (!matches) {
                    localStorage.setItem(storageKey, JSON.stringify(attempt));
                    receiptRecorded = false;
                }
                const result = await startCheckout(purchase, quote.hash, key);
                if (!result.id.trim())
                    throw new Error('El intento requiere verificación.');
                // A received start is not a paid order. Keep its key for equivalent retries.
                // Failure here leaves the pre-request record uncertain and prevents navigation.
                localStorage.setItem(storageKey, JSON.stringify({ ...attempt, receivedOrderId: result.id }));
                receiptRecorded = true;
                setRecoveryUid(null);
                if (auth.currentUser?.uid !== uid)
                    throw new Error('Cambió la sesión. El inicio quedó guardado para el comprador anterior.');
                localStorage.setItem('lastOrderId', result.id);
                if (shippingInfo.wantsToRegister) {
                    try { await upsertClientFromCheckout({uid, name:shippingInfo.name, email:shippingInfo.email, phone:shippingInfo.phone, address:shippingInfo.address, address2:shippingInfo.address2, city:shippingInfo.city, department:shippingInfo.state, postalCode:shippingInfo.postalCode, country:'UY', source:'checkout'}); }
                    catch { toast.error('El pago está preparado, pero no pudimos guardar tu ficha de cliente.'); }
                }
                if (auth.currentUser?.uid !== uid)
                    throw new Error('Cambió la sesión. Volvé al carrito para continuar.');
                window.location.assign(result.url);
            }
            catch (error) {
                setRecoveryUid(receiptRecorded ? null : uid);
                if (error instanceof CheckoutRequestError && ['QUOTE_CHANGED', 'CATALOG_UNAVAILABLE', 'INVALID_INPUT', 'INVALID_SHIPPING', 'INVALID_QUANTITY'].includes(error.code)) {
                    localStorage.removeItem(storageKey);
                    setReview(null);
                    setRecoveryUid(null);
                }
                throw error;
            }
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : 'No se pudo verificar la compra.');
        }
        finally {
            busy.current = false;
            setLoading(false);
        }
    };
    const content = JSON.stringify(purchaseInput(items, shippingInfo, pickup));
    return { pay, loading, recovery: recoveryUid !== null && recoveryUid === auth.currentUser?.uid, quote: review?.uid === auth.currentUser?.uid && review?.content === content ? review.quote : null };
}
