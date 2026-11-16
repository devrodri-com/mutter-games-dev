import { Link } from 'react-router-dom';
import './Footer.css';

type FooterProps = { variant?: 'light' | 'dark' };

export default function Footer({ variant = 'light' }: FooterProps) {
  return <footer className={`mutter-footer mutter-footer--${variant}`}>
    <div className="mutter-footer-inner">
      <div className="mutter-footer-top">
        <div className="mutter-footer-brand">
          <Link to="/" aria-label="Mutter Games, inicio"><img src="/brand/login/mutter-compacto-color-positivo.svg" width="846" height="150" alt="Mutter Games" /></Link>
          <p>Consolas, videojuegos y coleccionables.</p>
        </div>
        <nav aria-label="Enlaces de Mutter">
          <Link to="/shop">Tienda</Link><Link to="/about">Nosotros</Link>
          <a href="https://wa.me/59899389140" target="_blank" rel="noopener noreferrer">WhatsApp</a>
          <a href="https://www.instagram.com/muttergames/" target="_blank" rel="noopener noreferrer">Instagram</a>
        </nav>
      </div>
      <div className="mutter-footer-bottom">
        <span>© {new Date().getFullYear()} Mutter Games &amp; Coleccionables</span>
        <span>Desarrollado por <a href="https://www.devrodri.com" target="_blank" rel="noopener noreferrer">Rodrigo Opalo</a></span>
      </div>
    </div>
  </footer>;
}

