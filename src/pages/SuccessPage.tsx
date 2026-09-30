import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { requestCheckoutStatus, verifyCheckoutPayment, type CheckoutStatus } from '../utils/createPreference';

const SuccessPage = () => {
  const { search } = useLocation();
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<CheckoutStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let requestVersion = 0;
    setStatus(null); setError(null); setLoading(true);
    // Return URL fields are hints. Only the authenticated server can confirm a sale.
    const params = new URLSearchParams(search);
    const orderId = params.get('orderId') || params.get('external_reference');
    const paymentId = params.get('payment_id');
    if (!orderId) {
      setError('No pudimos identificar la compra. Volvé al carrito para verificar tu intento.');
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, user => {
      const version = ++requestVersion;
      setStatus(null); setError(null); setLoading(true);
      if (!user) return;
      const check = paymentId ? verifyCheckoutPayment(orderId, paymentId) : requestCheckoutStatus({ orderId });
      void check.then(next => {
        if (!cancelled && version === requestVersion && auth.currentUser?.uid === user.uid) setStatus(next);
      }).catch(() => {
        if (!cancelled && version === requestVersion) setError('No pudimos confirmar el pago. Tu compra requiere verificación; no vuelvas a pagar.');
      }).finally(() => {
        if (!cancelled && version === requestVersion) setLoading(false);
      });
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [search, revision]);
  const committed = status?.inventoryState === 'committed';
  const released = status?.inventoryState === 'released' && status.canRetry;
  const title = loading ? 'Verificando tu pago…' : committed ? '¡Pago confirmado!' : released ? 'La compra no se completó' : 'Tu pago aún no está confirmado';
  const message = error ?? (committed ? 'Confirmamos el pago y las unidades de tu pedido.' : released ? 'La reserva fue liberada. Podés volver al carrito para iniciar otra compra.' : 'La compra sigue en verificación. Conservamos su estado; no vuelvas a pagar.');
  // Do not clear a cart here: this return may belong to an earlier/different purchase.
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <h1 className={`text-3xl md:text-5xl font-bold mb-4 ${committed ? 'text-green-600' : 'text-gray-100'}`}>{title}</h1>
      {!loading && <p role={error ? 'alert' : 'status'} className="text-lg md:text-xl mb-6 text-gray-200">{message}</p>}
      {!loading && committed && status.verificationPending && <p role="status" className="text-gray-200 mb-6">El pago sigue confirmado. Una comprobación adicional está pendiente; no vuelvas a pagar.</p>}
      {!loading && !committed && !released && <button type="button" onClick={() => setRevision(value => value + 1)} className="underline mb-6">Volver a verificar</button>}
      <Link to="/shop" className="px-6 py-2 bg-[#FF2D55] text-white rounded hover:bg-[#e0264c] transition">Volver a la tienda</Link>
    </div>
  );
};
export default SuccessPage;
