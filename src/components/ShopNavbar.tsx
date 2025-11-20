//src/components/ShopNavbar.tsx
import { Link } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import { FaSearch, FaWhatsapp, FaInstagram } from "react-icons/fa";
import { useCart } from "../context/CartContext";
import i18n from "..";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useRef } from "react";
import logo from "/logo2.png";

export default function ShopNavbar() {
  const { items } = useCart();
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const { t } = useTranslation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // iOS detection to mitigate WebKit quirks
  const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/i.test(navigator.userAgent);
  // debounce for mobileSearch to avoid rapid event storms
  const searchDebounceRef = useRef<number | null>(null);
  const lastEmittedRef = useRef<string>("");

  const emitMobileSearch = (value: string) => {
    // avoid redundant emits
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    try {
      window.dispatchEvent(new CustomEvent("mobileSearch", { detail: value }));
    } catch {
      /* no-op */
    }
  };

  // cleanup any pending timers on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    };
  }, []);

  return (
    <header className="bg-white/95 backdrop-blur-md text-black fixed top-0 w-full z-50 shadow-md border-b border-gray-200 py-0.5">
      {/* Mobile */}
      <div className="flex sm:hidden items-center justify-between px-4 py-0.5">
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSearch(!showSearch)}>
            <FaSearch className="text-[#FF2D55] w-5 h-5" />
          </button>
          <Link to="/" className="flex items-center">
            <img
              src={logo}
              alt="Mutter Games"
              className="max-h-[2.25rem] w-auto object-contain"
            />
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://wa.me/59899389140"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#FF2D55]"
          >
            <FaWhatsapp className="w-5 h-5" />
          </a>
          <a
            href="https://www.instagram.com/muttergames/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#FF2D55]"
            aria-label="Instagram Mutter Games"
          >
            <FaInstagram className="w-5 h-5" />
          </a>
          <Link to="/carrito" className="relative text-[#FF2D55]">
            <ShoppingCart className="w-5 h-5" />
            {totalItems > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                {totalItems}
              </span>
            )}
          </Link>
          <button
            className="text-[#FF2D55]"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search Input in Mobile */}
      {showSearch && (
        <div className="sm:hidden px-4 pb-1">
          <input
            type="text"
            placeholder="Buscar productos..."
            className="w-full border border-[#FF2D55] rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF2D55]"
            autoFocus
            value={searchTerm}
            onChange={(e) => {
              const value = e.target.value;
              setSearchTerm(value);
              // debounce dispatch to reduce churn on iOS WebKit
              if (searchDebounceRef.current) {
                clearTimeout(searchDebounceRef.current);
              }
              searchDebounceRef.current = window.setTimeout(() => {
                // On iOS, keep dispatch but throttled to avoid loops
                emitMobileSearch(value);
              }, 250);
            }}
          />
        </div>
      )}

      {/* Mobile Dropdown Menu */}
      {isMenuOpen && (
        <div className="sm:hidden px-4 pb-2">
          <nav className="flex flex-col gap-2 text-sm items-center text-center">
            <Link to="/" onClick={() => setIsMenuOpen(false)} className="text-[#FF2D55] font-semibold">
              {t("nav.home", "Inicio")}
            </Link>
            <Link to="/about" onClick={() => setIsMenuOpen(false)} className="text-[#FF2D55] font-semibold">
              {t("nav.about", "Nosotros")}
            </Link>
          </nav>
        </div>
      )}

      {/* Desktop */}
      <div className="hidden sm:flex max-w-7xl mx-auto px-4 py-1 items-center justify-between">
        <Link to="/" className="flex items-center">
          <img
            src={logo}
            alt="Mutter Games"
            className="h-12 w-auto object-contain"
          />
        </Link>
        <nav className="flex items-center gap-6 text-base">
          <Link to="/" className="text-[#FF2D55] hover:text-[#CC1E44] font-semibold">{t("nav.home", "Inicio")}</Link>
          <Link to="/about" className="text-[#FF2D55] hover:text-[#CC1E44] font-semibold">{t("nav.about", "Nosotros")}</Link>
        </nav>
        <div className="flex items-center gap-4">
          <a
            href="https://wa.me/59899389140"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#FF2D55]"
          >
            <FaWhatsapp className="w-5 h-5" />
          </a>
          <a
            href="https://www.instagram.com/muttergames/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#FF2D55]"
            aria-label="Instagram Mutter Games"
          >
            <FaInstagram className="w-5 h-5" />
          </a>
          <Link to="/carrito" className="relative text-[#FF2D55]">
            <ShoppingCart className="w-5 h-5" />
            {totalItems > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                {totalItems}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}