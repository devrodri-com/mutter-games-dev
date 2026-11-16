import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

/** Used only by the cart. Other storefront headers keep their existing layout. */
export default function CartNavbar() {
  return <header className="cart-topbar"><div className="cart-topbar-inner">
    <Link to="/" className="cart-logo" aria-label="Mutter Games, inicio"><img src="/brand/login/mutter-compacto-color-positivo.svg" alt="Mutter Games" width="846" height="150" /></Link>
    <Link to="/shop" className="cart-continue"><ArrowLeft size={18} aria-hidden="true" /><span className="cart-continue-long">Seguir comprando</span><span className="cart-continue-short">Tienda</span></Link>
  </div></header>;
}

