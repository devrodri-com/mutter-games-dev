// src/hooks/useShopProducts.ts
// ============================================================================
// === HOOK PRINCIPAL PARA LA TIENDA (/shop) ==================================
// ============================================================================
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearchParams as useSearchParamsBase } from "react-router-dom";
import { fetchCategories } from "@/firebase/categories";
import { fetchProductsPage, fetchProducts, type FetchProductsPageOptions } from "@/firebase/products";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import { Product, Category, Subcategory } from "../data/types";

// ============================================================================
// === TIPOS LOCALES ==========================================================
// ============================================================================
// Define un tipo para productos locales
type LocalProduct = Product & {
  active?: boolean;
  category?: {
    id: string;
    name: string;
  };
  subcategory?: {
    id: string;
    name: string;
  };
  tipo?: string | string[];
  price?: number;
};

type SortOption = "" | "priceAsc" | "priceDesc" | "az" | "za";

// ============================================================================
// === WRAPPER PARA QUERYSTRING (IOS-SAFE) ====================================
// ============================================================================
// Wrapper para evitar escrituras redundantes en iOS y compararlas con la URL actual
const useSearchParamsSafe = () => {
  const [sp, setSP] = useSearchParamsBase();
  const isIOS = typeof navigator !== "undefined" && /iP(hone|ad|od)/i.test(navigator.userAgent);
  const location = useLocation();
  const safeSet = React.useCallback(
    (p: URLSearchParams | Record<string, string>, opts?: { replace?: boolean }) => {
      if (isIOS) return; // no escribir querystring en iOS
      const nextQS =
        p instanceof URLSearchParams ? p.toString() : new URLSearchParams(p).toString();
      const currentQS = (location.search || "").replace(/^\?/, "");
      if (nextQS === currentQS) return; // evitar no-ops redundantes
      setSP(p as any, opts);
    },
    [setSP, location.search, isIOS]
  );
  return [sp, safeSet] as const;
};

// ============================================================================
// === IMPLEMENTACIÓN DEL HOOK useShopProducts ================================
// ============================================================================
export function useShopProducts() {
  const { i18n } = useTranslation();
  const location = useLocation();
  const [urlSearchParams, setSearchParams] = useSearchParamsSafe();
  const isIOS = typeof navigator !== "undefined" && /iP(hone|ad|od)/i.test(navigator.userAgent);

  // ------------------------------------------------------------------------
  // ESTADO LOCAL: PAGINACIÓN, BÚSQUEDA, FILTROS, ORDEN Y UI
  // ------------------------------------------------------------------------
  // Estado de paginación
  const [paginatedProducts, setPaginatedProducts] = useState<LocalProduct[]>([]);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [loading, setLoading] = useState(true); // legacy

  // Estado para modo búsqueda global
  const [allProducts, setAllProducts] = useState<LocalProduct[]>([]);
  const [isLoadingAllProducts, setIsLoadingAllProducts] = useState(false);
  const prevSearchTermRef = useRef<string>("");

  // Filtros
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>("");
  const [selectedType, setSelectedType] = useState("Todos");

  // Orden
  const [sortOption, setSortOption] = useState<SortOption>("az");
  const [selectedOrderMobile, setSelectedOrderMobile] = useState("");
  const [showOrderMenuMobile, setShowOrderMenuMobile] = useState(false);

  // UI state
  const [isMobileView, setIsMobileView] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [showMobileFilter, setShowMobileFilter] = useState(false);

  // Categorías
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  // Legacy filter param para banner
  const filterParamRaw = urlSearchParams.get("filter") || "";
  const filterParam = filterParamRaw ? filterParamRaw.toUpperCase() : "";

  // ------------------------------------------------------------------------
  // EFECTOS DE LAYOUT / UI (mobile, scroll, eventos custom)
  // ------------------------------------------------------------------------
  // Determinar si es Mobile View
  useEffect(() => {
    const checkMobile = () => setIsMobileView(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Scroll to top handler
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Escuchar evento mobileSearch para actualizar searchTerm
  useEffect(() => {
    const handleMobileSearch = (e: Event) => {
      const value = (e as CustomEvent).detail.toLowerCase();
      setSearchTerm(value);
    };
    window.addEventListener("mobileSearch", handleMobileSearch);
    return () => window.removeEventListener("mobileSearch", handleMobileSearch);
  }, []);

  // ------------------------------------------------------------------------
  // EFECTO: CARGA DE CATEGORÍAS Y SUBCATEGORÍAS DESDE FIREBASE
  // ------------------------------------------------------------------------
  // Cargar categorías y subcategorías
  useEffect(() => {
    const loadData = async () => {
      try {
        const rawCategories: any[] = await fetchCategories();
        const lang = ["es", "en"].includes(i18n.language) ? i18n.language : "es";

        const normalized = rawCategories.map((cat: any) => {
          const catName =
            typeof cat.name === "string"
              ? cat.name
              : cat?.name?.[lang] ?? cat?.name?.es ?? cat?.name?.en ?? "";

          const subs = (cat.subcategories || []).map((s: any) => ({
            ...s,
            name:
              typeof s.name === "string"
                ? s.name
                : s?.name?.[lang] ?? s?.name?.es ?? s?.name?.en ?? "",
          }));

          return {
            id: cat.id,
            name: catName,
            subcategories: subs,
            order: cat.order ?? 0,
          };
        });

        normalized.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

        setCategories(normalized);
        setSubcategories(normalized.flatMap((c: any) => c.subcategories));

        if (import.meta.env.DEV) {
          console.log("[useShopProducts] Categorías cargadas:", normalized);
        }
      } catch (error) {
        console.error("[useShopProducts] Error al cargar categorías:", error);
        setCategories([]);
      }
    };

    loadData();
  }, [i18n.language]);

  // ------------------------------------------------------------------------
  // FUNCIÓN: CARGAR PRIMERA PÁGINA DE PRODUCTOS (PAGINACIÓN)
  // ------------------------------------------------------------------------
  // Cargar primera página de productos paginados
  const loadFirstPage = async () => {
    setIsInitialLoad(true);
    setIsLoadingPage(true);
    try {
      const options: FetchProductsPageOptions = {
        limit: 24,
        filters: {
          categoryId: selectedCategory || undefined,
          subcategoryId: selectedSubcategory || undefined,
        },
      };

      const result = await fetchProductsPage(options);

      const mappedProducts = result.products.map((product: Product) => ({
        ...product,
        tipo: (product as any).tipo || "",
        priceUSD: Number((product as any).priceUSD) || 0,
      }));

      setPaginatedProducts(mappedProducts);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);

      // Mantener compatibilidad con código existente
      setLoading(false);
      setIsInitialLoad(false);

      if (import.meta.env.DEV) {
        console.log(`[useShopProducts] Primera página cargada: ${mappedProducts.length} productos, hasMore: ${result.hasMore}`);
      }
    } catch (error) {
      console.error("[useShopProducts] Error al cargar primera página:", error);
      setPaginatedProducts([]);
      setLoading(false);
      setIsInitialLoad(false);
    } finally {
      setIsLoadingPage(false);
    }
  };

  // ------------------------------------------------------------------------
  // FUNCIÓN: CARGAR SIGUIENTES PÁGINAS (LOAD MORE)
  // ------------------------------------------------------------------------
  // Cargar más productos (siguiente página)
  const loadMore = async () => {
    if (!hasMore || isLoadingPage || !lastDoc) return;

    setIsLoadingPage(true);
    try {
      const options: FetchProductsPageOptions = {
        limit: 24,
        cursor: lastDoc,
        filters: {
          categoryId: selectedCategory || undefined,
          subcategoryId: selectedSubcategory || undefined,
        },
      };

      const result = await fetchProductsPage(options);

      const mappedProducts = result.products.map((product: Product) => ({
        ...product,
        tipo: (product as any).tipo || "",
        priceUSD: Number((product as any).priceUSD) || 0,
      }));

      setPaginatedProducts((prev) => [...prev, ...mappedProducts]);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);

      if (import.meta.env.DEV) {
        console.log(`[useShopProducts] Página adicional cargada: ${mappedProducts.length} productos, hasMore: ${result.hasMore}`);
      }
    } catch (error) {
      console.error("[useShopProducts] Error al cargar más productos:", error);
    } finally {
      setIsLoadingPage(false);
    }
  };

  // ------------------------------------------------------------------------
  // EFECTO: MODO BÚSQUEDA GLOBAL (CARGA TODOS LOS PRODUCTOS UNA VEZ)
  // ------------------------------------------------------------------------
  // Cargar todos los productos cuando searchTerm pasa de vacío a no vacío (modo búsqueda global)
  useEffect(() => {
    const wasEmpty = prevSearchTermRef.current === "";
    const isEmpty = searchTerm === "";
    const justBecameNonEmpty = wasEmpty && !isEmpty;

    // Si searchTerm pasa de vacío a no vacío, cargar todos los productos
    if (justBecameNonEmpty) {
      setIsLoadingAllProducts(true);
      fetchProducts()
        .then((products) => {
          const mappedProducts = products.map((product: Product) => ({
            ...product,
            tipo: (product as any).tipo || "",
            priceUSD: Number((product as any).priceUSD) || 0,
          }));
          setAllProducts(mappedProducts);
          setIsLoadingAllProducts(false);

          if (import.meta.env.DEV) {
            console.log(`[useShopProducts] Modo búsqueda: cargados ${mappedProducts.length} productos globales`);
          }
        })
        .catch((error) => {
          console.error("[useShopProducts] Error al cargar productos globales:", error);
          setAllProducts([]);
          setIsLoadingAllProducts(false);
        });
    }

    // Si searchTerm vuelve a vacío, limpiar productos globales
    if (isEmpty && !wasEmpty) {
      setAllProducts([]);
    }

    prevSearchTermRef.current = searchTerm;
  }, [searchTerm]);

  // ------------------------------------------------------------------------
  // EFECTO: CARGA PÁGINA INICIAL CUANDO CAMBIAN FILTROS / ORDEN
  // ------------------------------------------------------------------------
  // Cargar primera página al montar o cuando cambian filtros/orden (solo si no hay búsqueda)
  useEffect(() => {
    // Si hay búsqueda activa, no cargar páginas paginadas
    if (searchTerm) return;

    // Resetear paginación cuando cambian filtros o orden
    setPaginatedProducts([]);
    setLastDoc(null);
    setHasMore(true);
    setLoading(true);

    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, selectedSubcategory, sortOption, searchTerm]);

  // ------------------------------------------------------------------------
  // EFECTO: LECTURA INICIAL DE PARÁMETROS DE URL (QUERYSTRING)
  // ------------------------------------------------------------------------
  // Lectura inicial desde la URL (al montar)
  useEffect(() => {
    const q = urlSearchParams.get("q") || "";
    const cat = urlSearchParams.get("cat") || "";
    const sub = urlSearchParams.get("sub") || "";
    const type = urlSearchParams.get("type") || "";
    const sort = urlSearchParams.get("sort") || "az"; // Default a "az" para consistencia con UI

    setSearchTerm(q);
    setSelectedCategory(cat);
    setSelectedSubcategory(sub);
    setSelectedType(type || "Todos");
    setSortOption(sort as SortOption);

    // Sincroniza el selector mobile de orden
    if (sort === "priceAsc") setSelectedOrderMobile("asc");
    else if (sort === "priceDesc") setSelectedOrderMobile("desc");
    else if (sort === "az" || sort === "za") setSelectedOrderMobile(sort);
    else setSelectedOrderMobile("");

    // Si hay searchTerm en la URL, inicializar prevSearchTermRef para que el efecto de búsqueda se dispare
    prevSearchTermRef.current = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------------
  // EFECTO: ESCRITURA DE PARÁMETROS EN LA URL (SYNC QUERYSTRING)
  // ------------------------------------------------------------------------
  // Escritura a la URL al cambiar búsqueda/filtros/orden (evitar loop en iOS/WebKit)
  const lastQSRef = useRef<string>("");
  useEffect(() => {
    // En iOS no modificamos la URL para evitar recargas/loops
    if (isIOS) return;

    const params = new URLSearchParams();
    // Conserva "filter" legado sólo si ya estaba presente
    if (filterParamRaw) params.set("filter", filterParamRaw);
    if (searchTerm) params.set("q", searchTerm);
    if (selectedCategory) params.set("cat", selectedCategory);
    if (selectedSubcategory) params.set("sub", selectedSubcategory);
    if (selectedType && selectedType !== "Todos") params.set("type", selectedType);
    if (sortOption) params.set("sort", sortOption);

    const next = params.toString();
    const current = (location.search || "").replace(/^\?/, "");

    // Evitar reemplazos redundantes
    if (next !== current && next !== lastQSRef.current) {
      setSearchParams(params, { replace: true });
      lastQSRef.current = next;
    }
  }, [
    isIOS,
    searchTerm,
    selectedCategory,
    selectedSubcategory,
    selectedType,
    sortOption,
    filterParamRaw,
    location.search,
    setSearchParams,
  ]);

  // ------------------------------------------------------------------------
  // HANDLERS DE FILTROS Y ORDEN (DESKTOP / MOBILE)
  // ------------------------------------------------------------------------
  // Handlers
  const handleOrderChangeMobile = (order: string) => {
    setSelectedOrderMobile(order);
    // Sincroniza con sortOption para persistir en URL
    if (order === "asc") setSortOption("priceAsc");
    else if (order === "desc") setSortOption("priceDesc");
    else if (order === "az" || order === "za") setSortOption(order);
    else setSortOption("");
    setShowOrderMenuMobile(false);
  };

  const handleCategoryClick = (categoryName: string) => {
    if (categoryName === "") {
      setSelectedCategory("");
      setSelectedSubcategory("");
      return;
    }
    const category = categories.find((cat) => cat.name === categoryName);
    if (category) {
      setSelectedCategory(category.id);
      setSelectedSubcategory("");
    }
  };

  const handleSubcategoryClick = (subcategoryName: string) => {
    if (subcategoryName === "") {
      setSelectedSubcategory("");
      return;
    }
    for (const category of categories) {
      const sub = category.subcategories?.find((s: any) => s.name === subcategoryName);
      if (sub) {
        setSelectedCategory(category.id);
        setSelectedSubcategory(sub.id);
        break;
      }
    }
  };

  const handleFilterByType = (tipo: string) => {
    setSelectedType(tipo);
  };

  // Determinar si estamos en modo búsqueda global
  const isSearchMode = searchTerm.trim() !== "";

  // ------------------------------------------------------------------------
  // FILTRADO EN MEMORIA (SEGÚN MODO PAGINADO O BÚSQUEDA GLOBAL)
  // ------------------------------------------------------------------------
  // Filtrado en memoria: aplicar todos los filtros según el modo
  const filteredProducts = useMemo(() => {
    const selectedTipo = selectedType;
    // Normalizador para tildes/mayúsculas
    const normalizeTexto = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    // Seleccionar fuente de productos según el modo
    const sourceProducts = isSearchMode ? allProducts : paginatedProducts;

    // Filtrar productos
    const filtered = sourceProducts.filter((product) => {
      // En modo búsqueda, aplicar TODOS los filtros en memoria
      // En modo paginado, category y subcategory ya están filtrados en Firestore
      if (isSearchMode) {
        // Filtro por categoría (en memoria)
        const categoryMatch = selectedCategory
          ? product.category?.id === selectedCategory
          : true;

        // Filtro por subcategoría (en memoria)
        const subcategoryMatch = selectedSubcategory
          ? product.subcategory?.id === selectedSubcategory
          : true;

        if (!categoryMatch || !subcategoryMatch) return false;
      }

      // Filtro por tipo (en memoria)
      const tipoMatch =
        selectedTipo === "Todos"
          ? true
          : selectedTipo
          ? Array.isArray(product.tipo)
            ? (product.tipo as string[]).some((t) => normalizeTexto(t) === normalizeTexto(selectedTipo))
            : normalizeTexto((product.tipo as string) || "") === normalizeTexto(selectedTipo)
          : true;

      // Filtro por búsqueda (en memoria)
      const searchMatch = searchTerm
        ? product.title?.[i18n.language as "en" | "es"]?.toLowerCase().includes(searchTerm.toLowerCase())
        : true;

      return tipoMatch && searchMatch;
    });

    return filtered;
  }, [
    isSearchMode,
    allProducts,
    paginatedProducts,
    selectedCategory,
    selectedSubcategory,
    selectedType,
    searchTerm,
    i18n.language,
  ]);

  // Helper para obtener el precio mínimo del producto (alineado con la card)
  const getPrice = (p: LocalProduct) => {
    const prices: number[] = [];
  
    // Precio principal en el producto (si existe)
    if (typeof (p as any).priceUSD === "number") {
      prices.push(Number((p as any).priceUSD));
    } else if (typeof p.price === "number") {
      prices.push(Number(p.price));
    }
  
    // Precios de todas las variantes/opciones
    if (Array.isArray((p as any).variants)) {
      for (const variant of (p as any).variants as any[]) {
        if (Array.isArray(variant.options)) {
          for (const opt of variant.options) {
            const vPrice = Number(opt?.priceUSD ?? opt?.price);
            if (!Number.isNaN(vPrice)) {
              prices.push(vPrice);
            }
          }
        }
      }
    }
  
    if (prices.length === 0) return 0;
    return Math.min(...prices);
  };

  // ------------------------------------------------------------------------
  // ORDENAMIENTO EN MEMORIA (DESKTOP)
  // ------------------------------------------------------------------------
  // Ordenamiento completo en memoria (todo se ordena aquí, sin orderBy en Firestore)
  type Language = "en" | "es";
  const lang = i18n.language as Language;

  const sortedProducts = useMemo(() => {
    const sorted = [...filteredProducts].sort((a, b) => {
      // Orden por precio
      if (sortOption === "priceAsc") {
        return getPrice(a) - getPrice(b);
      }
      if (sortOption === "priceDesc") {
        return getPrice(b) - getPrice(a);
      }

      // Orden por nombre
      if (sortOption === "az") {
        return (a.title?.[lang] || "").localeCompare(b.title?.[lang] || "");
      }
      if (sortOption === "za") {
        return (b.title?.[lang] || "").localeCompare(a.title?.[lang] || "");
      }

      // Default: ordenar por campo 'orden' si existe, luego por nombre
      const aOrden = typeof (a as any).orden === "number" ? (a as any).orden : 0;
      const bOrden = typeof (b as any).orden === "number" ? (b as any).orden : 0;
      if (aOrden !== bOrden) {
        return aOrden - bOrden;
      }
      // Si orden es igual, ordenar por nombre
      const an = (a.title?.[lang] || a.name || "").toString();
      const bn = (b.title?.[lang] || b.name || "").toString();
      return an.localeCompare(bn, "es");
    });

    if (import.meta.env.DEV) {
      console.log("🔍 Orden en memoria:", sortOption || "default (orden + nombre)", sorted.length, "productos");
    }
    return sorted;
  }, [filteredProducts, sortOption, lang]);

  // ------------------------------------------------------------------------
  // ORDENAMIENTO EN MEMORIA (MOBILE)
  // ------------------------------------------------------------------------
  // Ordenamiento MOBILE por selectedOrderMobile (todo en memoria)
  const sortedProductsMobile = useMemo(() => {
    let sorted = [...filteredProducts];
    switch (selectedOrderMobile) {
      case "az":
        sorted.sort((a, b) => a.title?.[lang]?.localeCompare(b.title?.[lang] ?? "") ?? 0);
        break;
      case "za":
        sorted.sort((a, b) => b.title?.[lang]?.localeCompare(a.title?.[lang] ?? "") ?? 0);
        break;
      case "asc":
        sorted.sort((a, b) => getPrice(a) - getPrice(b));
        break;
      case "desc":
        sorted.sort((a, b) => getPrice(b) - getPrice(a));
        break;
      default:
        // Default: ordenar por campo 'orden' si existe, luego por nombre
        sorted.sort((a, b) => {
          const aOrden = typeof (a as any).orden === "number" ? (a as any).orden : 0;
          const bOrden = typeof (b as any).orden === "number" ? (b as any).orden : 0;
          if (aOrden !== bOrden) {
            return aOrden - bOrden;
          }
          const an = (a.title?.[lang] || a.name || "").toString();
          const bn = (b.title?.[lang] || b.name || "").toString();
          return an.localeCompare(bn, "es");
        });
        break;
    }
    return sorted;
  }, [filteredProducts, selectedOrderMobile, lang]);

  // Products a renderizar (para compatibilidad con código existente)
  const productsToDisplay = sortedProducts;

  // Tipos disponibles (según modo actual)
  const availableTypes = Array.from(
    new Set((isSearchMode ? allProducts : paginatedProducts).map((p) => p.tipo).filter(Boolean))
  ) as string[];

  return {
    // Estado de paginación
    paginatedProducts,
    hasMore,
    isInitialLoad,
    isLoadingPage,
    loading,
    isSearchMode, // Flag para saber si estamos en modo búsqueda global
    isLoadingAllProducts, // Estado de carga de productos globales

    // Filtros
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    selectedSubcategory,
    setSelectedSubcategory,
    selectedType,
    setSelectedType,

    // Orden
    sortOption,
    setSortOption,
    selectedOrderMobile,
    setSelectedOrderMobile,
    showOrderMenuMobile,
    setShowOrderMenuMobile,
    handleOrderChangeMobile,

    // Productos procesados
    filteredProducts,
    sortedProducts,
    sortedProductsMobile,
    productsToDisplay,
    availableTypes,

    // Categorías
    categories,
    subcategories,
    handleCategoryClick,
    handleSubcategoryClick,

    // Funciones
    loadMore,

    // UI state
    isMobileView,
    showScrollTop,
    setShowScrollTop,
    isFilterOpen,
    setIsFilterOpen,
    showMobileFilter,
    setShowMobileFilter,

    // Legacy/helpers
    filterParam,
    isIOS,
    scrollToTop,
    handleFilterByType,
    setSearchParams, // Para limpiar filtros desde Shop.tsx
  };
}

