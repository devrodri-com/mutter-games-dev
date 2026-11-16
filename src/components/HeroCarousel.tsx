import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay } from "swiper/modules";
import type { Swiper as SwiperInstance } from "swiper";
import "swiper/css";
import "./hero-carousel.css";

const slides = [
  {
    key: "consolas",
    image: "/images/Slide1.jpg",
    mobileImage: undefined,
    eyebrow: "Videojuegos",
    title: "Juegos y consolas de ayer y de hoy",
    description: "PlayStation, Xbox, Nintendo, portátiles y accesorios.",
    cta: "Ver tienda",
  },
  {
    key: "coleccionables",
    image: "/images/hero/coleccionables-a.webp",
    mobileImage: undefined,
    eyebrow: "Coleccionables",
    title: "Encontrá tu próxima pieza",
    description: "Películas, música, figuras y libros para sumar a tu colección.",
    cta: "Explorar colección",
  },
  {
    key: "envios",
    image: "/images/Slide3.jpg",
    mobileImage: "/images/Slide3-mobile.jpg",
    eyebrow: "Mutter online",
    title: "De Mutter a tu casa",
    description: "Comprá online y recibí tu pedido en cualquier punto de Uruguay.",
    cta: "Comprar ahora",
  },
] as const;

export default function HeroCarousel() {
  const carouselId = useId();
  const [swiper, setSwiper] = useState<SwiperInstance | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isPointerOver, setIsPointerOver] = useState(false);
  const [isPageHidden, setIsPageHidden] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(true);
  const pauseBeforePointerFocus = useRef<boolean | null>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(preference.matches);
    const updateVisibility = () => setIsPageHidden(document.hidden);

    updatePreference();
    updateVisibility();
    preference.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updateVisibility);

    return () => {
      preference.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!swiper || swiper.destroyed) return;

    if (isPaused || prefersReducedMotion || isPointerOver || isPageHidden) {
      swiper.autoplay.stop();
    } else {
      swiper.autoplay.start();
    }
  }, [swiper, isPaused, prefersReducedMotion, isPointerOver, isPageHidden]);

  const rotationLabel = prefersReducedMotion
    ? "Reproducción automática desactivada por movimiento reducido"
    : isPaused
      ? "Reanudar presentación automática"
      : "Pausar presentación automática";

  return (
    <div
      className="hero-a__carousel"
      role="region"
      aria-roledescription="carrusel"
      aria-label="Destacados de Mutter"
      onFocusCapture={() => setIsPaused(true)}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setIsPointerOver(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setIsPointerOver(false);
      }}
    >
      <Swiper
        id={carouselId}
        className="hero-a__swiper"
        modules={[Autoplay]}
        autoplay={{ delay: 7000, disableOnInteraction: false }}
        loop
        speed={prefersReducedMotion ? 0 : 500}
        threshold={8}
        onSwiper={(instance) => {
          instance.autoplay.stop();
          setSwiper(instance);
        }}
        onSlideChange={(instance) => setActiveIndex(instance.realIndex)}
        onTouchStart={() => setIsPaused(true)}
      >
        {slides.map((slide, index) => {
          const isActive = activeIndex === index;

          return (
            <SwiperSlide
              key={slide.key}
              role="group"
              aria-roledescription="diapositiva"
              aria-label={`${index + 1} de ${slides.length}`}
              aria-hidden={!isActive}
            >
              <div className={`hero-a__slide hero-a__slide--${slide.key}`}>
                <picture className="hero-a__picture">
                  {slide.mobileImage && (
                    <source media="(max-width: 767px)" srcSet={slide.mobileImage} />
                  )}
                  <img
                    src={slide.image}
                    alt=""
                    className="hero-a__image"
                    loading={index === 0 ? "eager" : "lazy"}
                    fetchPriority={index === 0 ? "high" : "auto"}
                    decoding="async"
                  />
                </picture>
                <div className="hero-a__shade" aria-hidden="true" />
                <div className="hero-a__inner">
                  <div className="hero-a__copy">
                    <p className="hero-a__eyebrow">{slide.eyebrow}</p>
                    <h1 className="hero-a__title">{slide.title}</h1>
                    <p className="hero-a__description">{slide.description}</p>
                    <a href="/shop" className="hero-a__cta" tabIndex={isActive ? 0 : -1}>
                      {slide.cta}
                      <ArrowRight size={18} aria-hidden="true" />
                    </a>
                  </div>
                </div>
              </div>
            </SwiperSlide>
          );
        })}
      </Swiper>

      <div className="hero-a__controls" role="group" aria-label="Controles de la presentación">
        <button
          className="hero-a__control"
          type="button"
          aria-label="Diapositiva anterior"
          aria-controls={carouselId}
          onClick={() => swiper?.slidePrev()}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <div className="hero-a__dots" role="group" aria-label="Elegir diapositiva">
          {slides.map((slide, index) => (
            <button
              key={slide.key}
              className="hero-a__dot"
              type="button"
              aria-label={`Mostrar: ${slide.title}`}
              aria-controls={carouselId}
              aria-current={activeIndex === index ? "true" : undefined}
              onClick={() => swiper?.slideToLoop(index)}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
        <button
          className="hero-a__control"
          type="button"
          aria-label="Diapositiva siguiente"
          aria-controls={carouselId}
          onClick={() => swiper?.slideNext()}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
        <button
          className="hero-a__control hero-a__rotation"
          type="button"
          aria-label={rotationLabel}
          title={rotationLabel}
          aria-controls={carouselId}
          disabled={prefersReducedMotion}
          onPointerDown={() => {
            pauseBeforePointerFocus.current = isPaused;
          }}
          onPointerCancel={() => {
            pauseBeforePointerFocus.current = null;
          }}
          onClick={(event) => {
            const wasPaused = event.detail === 0
              ? isPaused
              : pauseBeforePointerFocus.current ?? isPaused;
            setIsPaused(!wasPaused);
            pauseBeforePointerFocus.current = null;
          }}
        >
          {isPaused || prefersReducedMotion ? (
            <Play size={17} aria-hidden="true" pointerEvents="none" />
          ) : (
            <Pause size={17} aria-hidden="true" pointerEvents="none" />
          )}
        </button>
      </div>
      <p
        className="hero-a__sr-only"
        aria-live={isPaused || prefersReducedMotion ? "polite" : "off"}
        aria-atomic="true"
      >
        Diapositiva {activeIndex + 1} de {slides.length}: {slides[activeIndex]?.title}
      </p>
    </div>
  );
}
