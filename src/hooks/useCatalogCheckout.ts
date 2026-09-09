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
        content: string;
        quote: CheckoutQuote;
    } | null>(null);
    const [recovery, setRecovery] = useState(false);
    const pay = async () => {
        if (busy.current)
            return;
        busy.current = true;
        setLoading(true);
        try {
            if (cartError)
                throw new Error('Reintentá la verificación del carrito antes de pagar.');
            const current = await refreshCart();
            if (current.some(i => i.availability !== 'available'))
                throw new Error('Quitá los productos no disponibles antes de continuar.');
            const purchase = purchaseInput(current, shippingInfo, pickup);
            const content = JSON.stringify(purchase);
            const quote = await requestQuote(purchase);
            if (!review || review.content !== content || review.quote.hash !== quote.hash) {
                setReview({ content, quote });
                return;
            }
            if (!auth.currentUser)
                throw new Error('Sesión no disponible.');
            const storageKey = `mutter-checkout:${auth.currentUser.uid}`;
            const stored = localStorage.getItem(storageKey);
            let key: string;
            if (stored) {
                const pending: unknown = JSON.parse(stored);
                if (!pending || typeof pending !== 'object' || !('key' in pending) || typeof pending.key !== 'string' || !('content' in pending) || pending.content !== content || !('quoteHash' in pending) || pending.quoteHash !== quote.hash) {
                    setRecovery(true);
                    throw new Error('Hay un intento anterior pendiente de verificación. No inicies otro pago.');
                }
                key = pending.key;
            }
            else {
                key = crypto.randomUUID();
                localStorage.setItem(storageKey, JSON.stringify({ key, content, quoteHash: quote.hash }));
            }
            try {
                const result = await startCheckout(purchase, quote.hash, key);
                localStorage.setItem('lastOrderId', result.id);
                if (shippingInfo.wantsToRegister) {
                    try { await upsertClientFromCheckout({uid: auth.currentUser.uid, name:shippingInfo.name, email:shippingInfo.email, phone:shippingInfo.phone, address:shippingInfo.address, address2:shippingInfo.address2, city:shippingInfo.city, department:shippingInfo.state, postalCode:shippingInfo.postalCode, country:'UY', source:'checkout'}); }
                    catch { toast.error('El pago está preparado, pero no pudimos guardar tu ficha de cliente.'); }
                }
                window.location.assign(result.url);
            }
            catch (error) {
                if (error instanceof CheckoutRequestError && ['QUOTE_CHANGED', 'CATALOG_UNAVAILABLE', 'INVALID_INPUT', 'INVALID_SHIPPING', 'INVALID_QUANTITY'].includes(error.code)) {
                    localStorage.removeItem(storageKey);
                    setReview(null);
                }
                else
                    setRecovery(true);
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
    return { pay, loading, recovery, quote: review?.content === content ? review.quote : null };
}
