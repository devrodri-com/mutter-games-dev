// src/components/RelatedProducts.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import ProductCard from "./ProductCard";
import { fetchProductsByCategory } from "@/firebase/products";

interface Props {
  excludeSlugs?: string[];
  categoryName?: string;
  title?: string;
  ctaHref?: string; // opcional: para "Ver más {categoria}"
}

export default function RelatedProducts({
  excludeSlugs = [],
  categoryName,
  title,
  ctaHref,
}: Props) {
  // Carril accesible
  const listId = "related-products-carril";
  const scrollRef = useRef<HTMLUListElement>(null);

  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Carga
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchProductsByCategory(categoryName || "", 8)
      .then((res: any[] | undefined) => {
        if (!mounted) return;
        // aplicar excludeSlugs antes de setear
        const filtered = (res || []).filter((p: any) => !excludeSlugs.includes(p.slug ?? ""));
        setProducts(filtered);
      })
      .catch((err: unknown) => {
        // mantener silencioso en UI
        console.error("Error loading products in RelatedProducts:", err);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [categoryName, excludeSlugs]);

  // Detectar overflow para mostrar flechas y fades
  const recomputeOverflow = () => {
    const el = scrollRef.current;
    if (!el) return;
    const has = el.scrollWidth > el.clientWidth + 4; // pequeño margen
    setHasOverflow(has);

    // Calcular si se puede seguir desplazando a izquierda/derecha
    const maxScrollLeft = el.scrollWidth - el.clientWidth - 2; // tolerancia
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < maxScrollLeft);
  };

  useEffect(() => {
    recomputeOverflow();
  }, [products.length, loading]);

  useEffect(() => {
    const onResize = () => recomputeOverflow();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Scroll programático
  const scroll = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const step = Math.max(320, Math.floor(el.clientWidth * 0.9));
    el.scrollBy({
      left: direction === "left" ? -step : step,
      behavior: "smooth",
    });
  };

  // Soporte teclado en el carril
  const onKeyDown: React.KeyboardEventHandler<HTMLUListElement> = (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      scroll("left");
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      scroll("right");
    }
  };

  // Skeletons (percepción de velocidad)
  const skeletons = Array.from({ length: 6 }).map((_, i) => (
    <li
      key={`skeleton-${i}`}
      className="flex-shrink-0 snap-start scroll-ml-4 w-[220px] sm:w-[270px]"
      aria-hidden="true"
    >
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="aspect-square animate-pulse bg-gray-200" />
        <div className="p-4 space-y-3">
          <div className="h-4 bg-gray-200 rounded w-5/6 animate-pulse" />
          <div className="h-4 bg-gray-200 rounded w-2/3 animate-pulse" />
          <div className="h-6 bg-gray-200 rounded w-1/3 animate-pulse" />
        </div>
      </div>
    </li>
  ));

  return (
    <section className="relative">
      {(title || ctaHref) && (
        <div className="container px-4 mx-auto mt-6 md:mt-10 mb-4 md:mb-6">
          <div className="flex items-center justify-between">
            {title ? (
              <h2 className="text-2xl md:text-3xl font-semibold leading-tight tracking-[-0.01em] text-neutral-900">
                {title}
              </h2>
            ) : (
              <span />
            )}

            {ctaHref && (
              <a
                href={ctaHref}
                className="hidden sm:inline-block text-sm font-medium text-neutral-700 hover:text-black underline decoration-transparent hover:decoration-black transition"
              >
                Ver más
              </a>
            )}
          </div>
        </div>
      )}

      {/* Contenedor relativo para flechas overlay y fades */}
      <div className="relative">
        {/* Fades laterales */}
        {hasOverflow && (
          <>
            {canScrollLeft && (
              <div className="pointer-events-none absolute inset-y-0 left-0 w-8 sm:w-10 md:w-12 bg-gradient-to-r from-white to-transparent z-10" />
            )}
            {canScrollRight && (
              <div className="pointer-events-none absolute inset-y-0 right-0 w-8 sm:w-10 md:w-12 bg-gradient-to-l from-white to-transparent z-10" />
            )}
          </>
        )}

        {/* Carril */}
        <ul
          id={listId}
          ref={scrollRef}
          role="list"
          tabIndex={0}
          aria-label="Productos relacionados"
          className="flex gap-4 lg:gap-5 overflow-x-auto pl-4 pr-4 sm:pl-6 sm:pr-6 md:pl-8 md:pr-8 pb-2 pt-2 scroll-smooth hide-scrollbar snap-x snap-mandatory"
          onKeyDown={onKeyDown}
          onScroll={recomputeOverflow}
        >
          {loading
            ? skeletons
            : products.map((product) => {
                const priceUSD = product.priceUSD || 0;
                const slug = product.slug;

                return (
                  <li
                    key={product.id}
                    className="flex-shrink-0 snap-start scroll-ml-4 w-[220px] sm:w-[270px] min-h-[360px]"
                  >
                    <ProductCard
                      product={{
                        ...product,
                        priceUSD,
                        slug,
                      }}
                    />
                  </li>
                );
              })}
        </ul>

        {/* Flechas overlay (solo si hay overflow y en pantallas >= sm) */}
        {hasOverflow && (
          <>
            <button
              onClick={() => scroll("left")}
              aria-controls={listId}
              aria-label="Anterior"
              disabled={!canScrollLeft}
              className={`hidden sm:flex items-center justify-center
                          absolute left-3 top-1/2 -translate-y-1/2 z-30
                          p-3 bg-white rounded-full shadow-md border border-gray-300
                          hover:bg-black hover:text-white
                          focus:outline-none focus:ring-2 focus:ring-[#FF2D55]
                          transition ${!canScrollLeft ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              <ArrowLeft className="w-6 h-6" />
            </button>

            <button
              onClick={() => scroll("right")}
              aria-controls={listId}
              aria-label="Siguiente"
              disabled={!canScrollRight}
              className={`hidden sm:flex items-center justify-center
                          absolute right-3 top-1/2 -translate-y-1/2 z-30
                          p-3 bg-white rounded-full shadow-md border border-gray-300
                          hover:bg-black hover:text-white
                          focus:outline-none focus:ring-2 focus:ring-[#FF2D55]
                          transition ${!canScrollRight ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              <ArrowRight className="w-6 h-6" />
            </button>
          </>
        )}
      </div>
    </section>
  );
}