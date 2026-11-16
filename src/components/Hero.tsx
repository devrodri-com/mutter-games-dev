import { CreditCard, Truck, Store, MessageSquare, Lock } from "lucide-react";
import HeroCarousel from "./HeroCarousel";

export default function HeroSection() {
  return (
    <section className="hero-a">
      <HeroCarousel />

      {/* Trust Row debajo del hero (beneficios clave) */}
      <div className="w-full bg-white/95 backdrop-blur border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-4 md:py-5 flex flex-wrap items-center justify-center gap-3 md:gap-6 text-sm text-gray-900">
          <div className="inline-flex items-center gap-2">
            <CreditCard className="w-4 h-4 opacity-80" />
            <span className="font-medium">Cuotas con Mercado Pago</span>
          </div>
          <span className="hidden md:block h-4 w-px bg-gray-300/80" />
          <div className="inline-flex items-center gap-2">
            <Truck className="w-4 h-4 opacity-80" />
            <span className="font-medium">Envío 24–48 h</span>
          </div>
          <span className="hidden md:block h-4 w-px bg-gray-300/80" />
          <div className="inline-flex items-center gap-2">
            <Store className="w-4 h-4 opacity-80" />
            <span className="font-medium">Retiro hoy</span>
          </div>
          <span className="hidden md:block h-4 w-px bg-gray-300/80" />
          <div className="inline-flex items-center gap-2">
            <MessageSquare className="w-4 h-4 opacity-80" />
            <span className="font-medium">WhatsApp 1–3 min</span>
          </div>
        </div>
      </div>

      {/* Sello MercadoLibre (reputación) */}
      <div className="w-full">
        <div className="max-w-6xl mx-auto px-4 py-5 md:py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 backdrop-blur px-4 py-4 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-7 h-7 text-[11px] font-extrabold rounded bg-white text-[#323271] border border-[#323271]">ML</span>
              <div className="text-white">
                <p className="text-sm md:text-base font-semibold leading-snug">
                  Somos los de MercadoLibre
                </p>
                <div className="flex flex-col md:flex-row md:items-center md:gap-2">
                  <p className="text-xs md:text-sm text-gray-200/80 leading-snug">
                    4.9⭐ +3.000 ventas
                  </p>
                  <p className="text-xs md:text-sm text-gray-200/80 leading-snug flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5" />
                    Compra protegida con Mercado Pago
                  </p>
                </div>
              </div>
            </div>
            <a
              href="https://www.mercadolibre.com.uy/pagina/lilipres?utm_source=web_mutter&utm_medium=referral&utm_campaign=badge_ml_home"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold underline underline-offset-2 hover:opacity-80 text-white"
            >
              Ver perfil ↗
            </a>
          </div>
        </div>
      </div>

    </section>
  );
}
