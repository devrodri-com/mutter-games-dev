import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import { toast } from 'react-hot-toast';
import 'react-toastify/dist/ReactToastify.css';
import CartNavbar from '../components/CartNavbar';
import Footer from '../components/Footer';
import EmptyCart from '../components/cart/EmptyCart';
import CartCheckoutFields from '../components/cart/CartCheckoutFields';
import CartItems from '../components/cart/CartItems';
import CartOrderSummary from '../components/cart/CartOrderSummary';
import LegacyGuestNewPurchase from '../components/LegacyGuestNewPurchase';
import RelatedProducts from '../components/RelatedProducts';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useCatalogCheckout } from '../hooks/useCatalogCheckout';
import { useLanguage } from '../hooks/useLanguage';
import { calculateCartBreakdown, getShippingInfoByDepartment } from '../utils/cartUtils';
import type { CartItem } from '../data/types';
import './CartPage.css';

export default function CartPage() {
  const { items, shippingInfo, setShippingInfo, removeItem, cartReady, cartError, refreshCart } = useCart();
  const { credentialScope, credentialAccess, credentialError } = useAuth();
  const { language } = useLanguage();
  const [pickup, setPickup] = useState(false);
  const checkout = useCatalogCheckout(pickup);
  const checkoutInFlight = useRef(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const isCheckoutBusy = useCallback(() => checkoutInFlight.current, []);
  const accountGuard = useRef({ busy: false, blocked: false });
  const [accountState, setAccountState] = useState(accountGuard.current);
  const handleAccountBusyChange = useCallback((busy: boolean) => {
    accountGuard.current = { ...accountGuard.current, busy };
    setAccountState(accountGuard.current);
  }, []);
  const handleAccountBlockedChange = useCallback((blocked: boolean) => {
    accountGuard.current = { ...accountGuard.current, blocked };
    setAccountState(accountGuard.current);
  }, []);
  const accountBlocked = accountState.busy || accountState.blocked;
  const handleReview = () => {
    if (checkoutInFlight.current || checkout.loading || accountGuard.current.busy || accountGuard.current.blocked) return;
    checkoutInFlight.current = true;
    setCheckoutBusy(true);
    void checkout.pay().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'No pudimos preparar tu compra. Intentá nuevamente.');
    }).finally(() => {
      checkoutInFlight.current = false;
      setCheckoutBusy(false);
    });
  };
  const adminOnly = credentialScope === 'JOHN_ADMIN_CLOSED_V1';
  const { label: shippingText, cost: shippingCost } = getShippingInfoByDepartment(shippingInfo.state || '');
  const breakdown = calculateCartBreakdown(items);
  const total = breakdown.subtotal + (pickup ? 0 : shippingCost);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const showOperationError = (error: unknown) => toast.error(error instanceof Error ? error.message : 'No pudimos sincronizar el carrito.');
  const handleRemove = (item: CartItem) => { void removeItem(item).catch(showOperationError); };
  const handleRefresh = () => { void refreshCart().catch(showOperationError); };

  return <div className="mutter-cart">
    <CartNavbar />
    <main className="cart-page">
      <div className="cart-page-heading">
        <div><p className="cart-eyebrow">Mutter Games</p><h1>Tu carrito {!adminOnly && count > 0 && <span className="cart-count">{count} {count === 1 ? 'producto' : 'productos'}</span>}</h1>
          {!adminOnly && <p className="cart-page-intro">Completá tus datos y revisá tu pedido.</p>}
        </div>
      </div>
      {adminOnly ? <section className="cart-access-notice" aria-labelledby="cart-admin-heading">
        <h2 id="cart-admin-heading">Sesión de administración</h2>
        <p>Este acceso es sólo para gestionar publicaciones. El carrito y las compras no están habilitados para esta sesión.</p>
        <Link to="/admin/productList">Volver a Publicaciones</Link>
      </section> : <>
        <LegacyGuestNewPurchase />
        {items.length === 0 ? <div className="cart-empty">
          {cartError ? <div role="alert" className="cart-checkout-notice">{cartError}<button type="button" className="cart-retry" onClick={handleRefresh}>Reintentar</button></div>
            : credentialAccess === 'unavailable' ? <p role="status">{credentialError || 'No pudimos comprobar el acceso a tu carrito.'}</p>
              : credentialAccess === 'loading' ? <p role="status">Comprobando el acceso a tu carrito…</p>
                : <EmptyCart />}
          <p>Productos originales de gaming y coleccionables</p>
          <p>Pago protegido con Mercado Pago · Envío a todo el país</p>
        </div> : <>
          <div className="cart-checkout-layout">
            <CartCheckoutFields shippingInfo={shippingInfo} setShippingInfo={setShippingInfo} pickup={pickup} setPickup={setPickup} onReview={handleReview} accountBlocked={accountBlocked || checkoutBusy}
              checkoutBusy={checkoutBusy || checkout.loading} isCheckoutBusy={isCheckoutBusy}
              onAccountBusyChange={handleAccountBusyChange} onAccountBlockedChange={handleAccountBlockedChange} />
            <aside className="cart-order" aria-label="Tu pedido">
              <div className="cart-order-products"><h2>Resumen de tu pedido</h2><CartItems items={items} language={language === 'en' ? 'en' : 'es'} onRemove={handleRemove} /></div>
              <CartOrderSummary subtotal={breakdown.subtotal} total={total} pickup={pickup} shippingText={shippingText} shippingInfo={shippingInfo}
                checkout={checkout} cartReady={cartReady} cartError={cartError} onRefresh={handleRefresh} accountBlocked={accountBlocked} />
            </aside>
          </div>
          <section className="cart-related">
            <RelatedProducts excludeSlugs={items.map(item => item.slug)} title="También te podría interesar" cardPresentation="catalog" />
          </section>
        </>}
      </>}
    </main>
    <Footer variant="light" />
    <ToastContainer position="top-center" autoClose={3000} hideProgressBar />
  </div>;
}

