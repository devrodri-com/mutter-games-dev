// src/main.tsx

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "react-hot-toast"; // ✅ importamos Toaster
import { ConfirmProvider } from "./components/ui/confirm";
import { LanguageProvider } from "./context/LanguageContext";

import "./index.css";
import App from "./App";
import { CartProvider } from "./context/CartContext";
import { AuthProvider } from "./context/AuthContext";

import './i18n-config';

// TEMP: invalidar Service Worker y caches en clientes móviles (iOS/Chrome iOS) para evitar loops/crashes.
// Quitar este bloque tras verificar que /shop carga estable en iPhone.
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  try {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
    // limpiar caches si existen (guardas de tipo sin suprimir errores)
    if ('caches' in window && typeof caches.keys === 'function') {
      caches.keys().then((keys: string[]) => {
        keys.forEach((k) => caches.delete(k));
      });
    }
  } catch {
    // no-op
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <HelmetProvider>
        <AuthProvider>
          <CartProvider>
            <BrowserRouter>
              <ConfirmProvider>
                <App />
                <Toaster position="top-center" reverseOrder={false} /> {/* ✅ activamos Toaster */}
              </ConfirmProvider>
            </BrowserRouter>
          </CartProvider>
        </AuthProvider>
      </HelmetProvider>
    </LanguageProvider>
  </React.StrictMode>
);