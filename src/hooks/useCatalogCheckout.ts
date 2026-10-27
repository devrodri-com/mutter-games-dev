import { useRef, useState } from 'react';
import { auth } from '../firebase';
import { upsertClientFromCheckout } from '../firebaseUtils';
import { useCart } from '../context/CartContext';
import { purchaseInput, requestQuote, startCheckout, requestCheckoutStatus, refreshAvailability, CheckoutRequestError, type CheckoutQuote } from '../utils/createPreference';
import { toast } from 'react-hot-toast';
type PendingAttempt = { key: string; content: string; quoteHash: string; receivedOrderId?: string };
function readAttempt(storageKey: string): PendingAttempt | null {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) return null;
    const data: unknown = JSON.parse(stored);
    if (!data || typeof data !== 'object' || !('key' in data) || typeof data.key !== 'string' || !data.key.trim() ||
        !('content' in data) || typeof data.content !== 'string' || !('quoteHash' in data) || typeof data.quoteHash !== 'string')
        throw new Error('El intento guardado requiere verificación. No inicies otro pago.');
    return { key: data.key, content: data.content, quoteHash: data.quoteHash,
        ...('receivedOrderId' in data && typeof data.receivedOrderId === 'string' && data.receivedOrderId.trim() ? { receivedOrderId: data.receivedOrderId } : {}) };
}
function removeAttempt(storageKey: string, key: string): void {
    if (readAttempt(storageKey)?.key !== key) throw new Error('El intento guardado cambió. Revisá la compra antes de continuar.');
    localStorage.removeItem(storageKey);
}
export function useCatalogCheckout(pickup: boolean) {
    const { items, shippingInfo, refreshCart, cartError } = useCart();
    const busy = useRef(false);
    const [loading, setLoading] = useState(false);
    const [review, setReview] = useState<{ uid: string; content: string; quote: CheckoutQuote } | null>(null);
    const [recoveryUid, setRecoveryUid] = useState<string | null>(null);
    const pay = async () => {
        if (busy.current) return;
        busy.current = true;
        setLoading(true);
        const uid = auth.currentUser?.uid;
        let receiptRecorded = false;
        let recoveryNeeded = false;
        let releasedAttempt = false;
        try {
            if (!uid) throw new Error('Sesión no disponible.');
            const storageKey = `mutter-checkout:${uid}`;
            recoveryNeeded = true;
            const pending = readAttempt(storageKey);
            recoveryNeeded = pending !== null;
            receiptRecorded = Boolean(pending?.receivedOrderId);
            const initialContent = JSON.stringify(purchaseInput(items, shippingInfo, pickup));
            // Recover before refresh/quote: our own last-unit hold makes the public stock zero.
            if (pending && (pending.content === initialContent || !pending.receivedOrderId)) {
                const status = await requestCheckoutStatus({ key: pending.key });
                if (auth.currentUser?.uid !== uid) throw new Error('Cambió la sesión. Revisá la compra antes de continuar.');
                if (status.canRetry) {
                    removeAttempt(storageKey, pending.key);
                    setReview(null);
                    setRecoveryUid(null);
                    releasedAttempt = true;
                    recoveryNeeded = false;
                } else {
                    if (status.inventoryState === 'reserved' && status.url) {
                        localStorage.setItem(storageKey, JSON.stringify({ ...pending, receivedOrderId: status.id }));
                        receiptRecorded = true;
                        setRecoveryUid(null);
                        if (pending.content !== initialContent) throw new Error('Recuperamos tu compra anterior. Revisá el carrito antes de iniciar otra compra.');
                        localStorage.setItem('lastOrderId', status.id);
                        window.location.assign(status.url);
                        return;
                    }
                    if (status.inventoryState === 'committed') {
                        if (pending.receivedOrderId && pending.receivedOrderId !== status.id) throw new Error('La compra requiere verificación.');
                        removeAttempt(storageKey, pending.key);
                        setReview(null);
                        setRecoveryUid(null);
                        toast.success('El pago de esta compra ya está confirmado.');
                        return;
                    }
                    throw new Error('Tu compra sigue en verificación. Conservamos la reserva; no inicies otro pago.');
                }
            }
            if (cartError) throw new Error('Reintentá la verificación del carrito antes de pagar.');
            await refreshAvailability([...new Set(items.map(item => item.id))]);
            if (auth.currentUser?.uid !== uid) throw new Error('Cambió la sesión. Revisá la compra antes de continuar.');
            const current = await refreshCart();
            if (auth.currentUser?.uid !== uid) throw new Error('Cambió la sesión. Revisá la compra antes de continuar.');
            if (current.some(i => i.availability !== 'available')) throw new Error('Quitá los productos no disponibles antes de continuar.');
            const purchase = purchaseInput(current, shippingInfo, pickup);
            const content = JSON.stringify(purchase);
            const quote = await requestQuote(purchase);
            if (auth.currentUser?.uid !== uid) throw new Error('Cambió la sesión. Revisá la compra antes de continuar.');
            if (releasedAttempt || !review || review.uid !== uid || review.content !== content || review.quote.hash !== quote.hash) {
                setReview({ uid, content, quote });
                return;
            }
            const attempt = { key: crypto.randomUUID(), content, quoteHash: quote.hash };
            // Persist the key before sending. Failed storage must never admit a start.
            receiptRecorded = false;
            recoveryNeeded = true;
            localStorage.setItem(storageKey, JSON.stringify(attempt));
            try {
                const result = await startCheckout(purchase, quote.hash, attempt.key);
                if (!result.id.trim()) throw new Error('El intento requiere verificación.');
                localStorage.setItem(storageKey, JSON.stringify({ ...attempt, receivedOrderId: result.id }));
                receiptRecorded = true;
                setRecoveryUid(null);
                if (auth.currentUser?.uid !== uid) throw new Error('Cambió la sesión. El inicio quedó guardado para el comprador anterior.');
                localStorage.setItem('lastOrderId', result.id);
                if (shippingInfo.wantsToRegister) {
                    try { await upsertClientFromCheckout({uid, name:shippingInfo.name, email:shippingInfo.email, phone:shippingInfo.phone, address:shippingInfo.address, address2:shippingInfo.address2, city:shippingInfo.city, department:shippingInfo.state, postalCode:shippingInfo.postalCode, country:'UY', source:'checkout'}); }
                    catch { toast.error('El pago está preparado, pero no pudimos guardar tu ficha de cliente.'); }
                }
                if (auth.currentUser?.uid !== uid) throw new Error('Cambió la sesión. Volvé al carrito para continuar.');
                window.location.assign(result.url);
            } catch (error) {
                if (auth.currentUser?.uid === uid && error instanceof CheckoutRequestError && ['QUOTE_CHANGED', 'CATALOG_UNAVAILABLE', 'INVALID_INPUT', 'INVALID_SHIPPING', 'INVALID_QUANTITY'].includes(error.code)) {
                    const status = await requestCheckoutStatus({ key: attempt.key });
                    if (auth.currentUser?.uid !== uid) throw new Error('Cambió la sesión. El intento quedó guardado para el comprador anterior.');
                    if (status.canRetry) {
                        removeAttempt(storageKey, attempt.key);
                        setReview(null);
                        setRecoveryUid(null);
                        recoveryNeeded = false;
                    }
                }
                throw error;
            }
        } catch (error) {
            setRecoveryUid(recoveryNeeded && !receiptRecorded ? uid ?? null : null);
            toast.error(error instanceof Error ? error.message : 'No se pudo verificar la compra.');
        } finally {
            busy.current = false;
            setLoading(false);
        }
    };
    const content = JSON.stringify(purchaseInput(items, shippingInfo, pickup));
    return { pay, loading, recovery: recoveryUid !== null && recoveryUid === auth.currentUser?.uid, quote: review?.uid === auth.currentUser?.uid && review?.content === content ? review.quote : null };
}
