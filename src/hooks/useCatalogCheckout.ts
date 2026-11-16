import { useRef, useState } from 'react';
import { auth } from '../firebase';
import { upsertClientFromCheckout } from '../firebaseUtils';
import { useCart } from '../context/CartContext';
import { purchaseInput, requestQuote, startCheckout, requestCheckoutStatus, refreshAvailability, CheckoutRequestError, CheckoutNotSentError, type CheckoutQuote } from '../utils/createPreference';
import { toast } from 'react-hot-toast';
import { calculateCartBreakdown, getShippingInfoByDepartment } from '../utils/cartUtils';
import { matchesDisplayedCheckout } from '../domain/checkoutReview';
import { CheckoutAttemptOwner, withCheckoutLock } from '../utils/checkoutAttempt';

export function useCatalogCheckout(pickup: boolean) {
    const { items, shippingInfo, refreshCart, cartError } = useCart();
    const busy = useRef(false);
    const [loading, setLoading] = useState(false);
    const [review, setReview] = useState<{ uid: string; content: string; quote: CheckoutQuote } | null>(null);
    const [recoveryUid, setRecoveryUid] = useState<string | null>(null);
    const currentContent = JSON.stringify(purchaseInput(items, shippingInfo, pickup));
    const latestContent = useRef(currentContent);
    latestContent.current = currentContent;
    const pay = async () => {
        if (busy.current) return;
        busy.current = true;
        setLoading(true);
        const uid = auth.currentUser?.uid;
        const initialContent = currentContent;
        const assertCurrentConsent = () => {
            if (auth.currentUser?.uid !== uid) throw new Error('Cambió la sesión. Revisá la compra antes de continuar.');
            if (latestContent.current !== initialContent) throw new Error('El carrito o la entrega cambiaron. Revisá los datos antes de continuar.');
        };
        let receiptRecorded = false;
        let recoveryNeeded = false;
        try {
            await withCheckoutLock(async () => {
                if (!uid) throw new Error('Sesión no disponible.');
                assertCurrentConsent();
                recoveryNeeded = true;
                const owner = new CheckoutAttemptOwner(`mutter-checkout:${uid}`);
                const pending = owner.recoverPending();
                recoveryNeeded = pending !== null;
                receiptRecorded = Boolean(pending?.receivedOrderId);
                let releasedAttempt = false;
                const assertCurrentPurchase = () => {
                    assertCurrentConsent();
                    owner.assertCurrent();
                };
                // A legacy known receipt must survive takeover during any later request.
                if (pending?.receivedOrderId) owner.recordReceipt(pending, pending.receivedOrderId);
                const displayedItems = items.map(item => ({ ...item }));
                const displayedShipping = pickup ? 0 : getShippingInfoByDepartment(shippingInfo.state || '').cost;
                const displayedTotal = calculateCartBreakdown(displayedItems).subtotal + displayedShipping;
                const otherPending = owner.hasOtherPending();
                // Recover before refresh/quote: our own last-unit hold makes public stock zero.
                if (pending && (pending.content === initialContent || !pending.receivedOrderId || otherPending || owner.restoredPending)) {
                    owner.ensurePending(pending);
                    const status = await requestCheckoutStatus({ key: pending.key }, assertCurrentPurchase);
                    if (pending.receivedOrderId && pending.receivedOrderId !== status.id)
                        throw new Error('La compra requiere verificación. Conservamos su comprobante anterior.');
                    // Retain a legacy receipt before any release; not_started alone is no receipt.
                    if (pending.receivedOrderId) {
                        owner.recordReceipt(pending, pending.receivedOrderId);
                        receiptRecorded = true;
                    } else if (status.inventoryState === 'reserved' && status.url || status.inventoryState === 'committed') {
                        owner.recordReceipt(pending, status.id);
                        receiptRecorded = true;
                    }
                    assertCurrentPurchase();
                    if (status.canRetry) {
                        owner.finish(pending);
                        owner.remove();
                        setReview(null);
                        setRecoveryUid(null);
                        releasedAttempt = true;
                        recoveryNeeded = false;
                        if (otherPending) {
                            setRecoveryUid(uid);
                            return;
                        }
                    } else {
                        if (status.inventoryState === 'reserved' && status.url) {
                            owner.replace({ ...pending, receivedOrderId: status.id });
                            setRecoveryUid(null);
                            if (pending.content !== initialContent) throw new Error('Recuperamos tu compra anterior. Revisá el carrito antes de iniciar otra compra.');
                            owner.setLastOrder(status.id);
                            assertCurrentPurchase();
                            window.location.assign(status.url);
                            return;
                        }
                        if (status.inventoryState === 'committed') {
                            owner.finish(pending);
                            owner.remove();
                            setReview(null);
                            setRecoveryUid(otherPending ? uid : null);
                            toast.success('El pago de esta compra ya está confirmado.');
                            return;
                        }
                        throw new Error('Tu compra sigue en verificación. Conservamos la reserva; no inicies otro pago.');
                    }
                }
                if (cartError) throw new Error('Reintentá la verificación del carrito antes de pagar.');
                await refreshAvailability([...new Set(items.map(item => item.id))]);
                assertCurrentPurchase();
                const current = await refreshCart();
                assertCurrentPurchase();
                if (current.some(i => i.availability !== 'available')) throw new Error('Quitá los productos no disponibles antes de continuar.');
                const purchase = purchaseInput(current, shippingInfo, pickup);
                const content = JSON.stringify(purchase);
                const quote = await requestQuote(purchase);
                assertCurrentPurchase();
                if (content !== initialContent) throw new Error('El carrito o la entrega cambiaron. Revisá los datos antes de continuar.');
                const confirmedReview = review?.uid === uid && review.content === content && review.quote.hash === quote.hash;
                if (releasedAttempt || !confirmedReview && (review?.uid === uid && review.content === content
                    || !matchesDisplayedCheckout(displayedItems, displayedTotal, displayedShipping, quote))) {
                    setReview({ uid, content, quote });
                    return;
                }
                const predecessor = owner.snapshot();
                if (predecessor.attempt?.receivedOrderId) {
                    owner.recordReceipt(predecessor.attempt, predecessor.attempt.receivedOrderId);
                }
                const attempt = { key: crypto.randomUUID(), content, quoteHash: quote.hash };
                receiptRecorded = false;
                recoveryNeeded = true;
                // Exact predecessor bytes are retained only for proven never-sent rollback.
                owner.replace(attempt);
                owner.begin(attempt);
                try {
                    const result = await startCheckout(purchase, quote.hash, attempt.key, () => {
                        assertCurrentPurchase();
                        // Retire the archived known predecessor only at the actual send boundary.
                        if (predecessor.attempt?.receivedOrderId) owner.finish(predecessor.attempt);
                        assertCurrentPurchase();
                    });
                    owner.recordReceipt(attempt, result.id);
                    receiptRecorded = true;
                    owner.assertCurrent();
                    owner.replace({ ...attempt, receivedOrderId: result.id });
                    assertCurrentPurchase();
                    setRecoveryUid(null);
                    owner.setLastOrder(result.id);
                    if (shippingInfo.wantsToRegister) {
                        try { await upsertClientFromCheckout({uid, name:shippingInfo.name, email:shippingInfo.email, phone:shippingInfo.phone, address:shippingInfo.address, address2:shippingInfo.address2, city:shippingInfo.city, department:shippingInfo.state, postalCode:shippingInfo.postalCode, country:'UY', source:'checkout'}); }
                        catch { toast.error('El pago está preparado, pero no pudimos guardar tu ficha de cliente.'); }
                    }
                    assertCurrentPurchase();
                    window.location.assign(result.url);
                } catch (error) {
                    if (error instanceof CheckoutNotSentError) {
                        if (predecessor.attempt?.receivedOrderId)
                            owner.recordReceipt(predecessor.attempt, predecessor.attempt.receivedOrderId);
                        owner.finish(attempt, true);
                        owner.restore(predecessor);
                        recoveryNeeded = false;
                        receiptRecorded = Boolean(predecessor.attempt?.receivedOrderId);
                        setReview(null);
                        setRecoveryUid(null);
                        throw error;
                    }
                    if (auth.currentUser?.uid === uid && error instanceof CheckoutRequestError && ['QUOTE_CHANGED', 'CATALOG_UNAVAILABLE', 'INVALID_INPUT', 'INVALID_SHIPPING', 'INVALID_QUANTITY'].includes(error.code)) {
                        assertCurrentPurchase();
                        const status = await requestCheckoutStatus({ key: attempt.key }, assertCurrentPurchase);
                        assertCurrentPurchase();
                        if (status.canRetry) {
                            owner.finish(attempt);
                            owner.remove();
                            setReview(null);
                            setRecoveryUid(null);
                            recoveryNeeded = false;
                        }
                    }
                    throw error;
                }
            });
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
