import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import { fetchCategories } from '../firebase/categories';
import type { Category } from '../data/types';
import { useCatalogSnapshot } from './useCatalogSnapshot';
import { readShopCriteria, selectShopProducts, shopCriteriaParams, SHOP_PAGE_SIZE } from '../domain/shopSelection';
import type { ShopCriteria, ShopSort } from '../domain/shopSelection';

export function useShopProducts() {
  const { i18n } = useTranslation();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [params, setParams] = useSearchParams();
  const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/i.test(navigator.userAgent);
  const [view, setView] = useState(() => ({ criteria: readShopCriteria(location.search), size: SHOP_PAGE_SIZE }));
  const criteria = view.criteria;
  const setCriteria: Dispatch<SetStateAction<ShopCriteria>> = value => setView(old => ({ criteria: typeof value === 'function' ? value(old.criteria) : value, size: SHOP_PAGE_SIZE }));
  const currentLocation = useRef(location.search);
  const pendingLocations = useRef<string[]>([]);
  const explicitLocation = useRef<string | null>(null);
  const legacyFilter = params.get('filter') ?? '';
  const language = i18n.language.startsWith('en') ? 'en' : 'es';
  const snapshot = useCatalogSnapshot();
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryRevision, setCategoryRevision] = useState(0);
  const [showOrderMenuMobile, setShowOrderMenuMobile] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [showMobileFilter, setShowMobileFilter] = useState(false);

  function selectionSetter<K extends keyof ShopCriteria>(key: K): Dispatch<SetStateAction<ShopCriteria[K]>> {
    return value => setCriteria(old => ({ ...old, [key]: typeof value === 'function' ? value(old[key]) : value }));
  }
  const setSearchTerm = useCallback<Dispatch<SetStateAction<string>>>(value => setView(old => ({ criteria: { ...old.criteria, search: typeof value === 'function' ? value(old.criteria.search) : value }, size: SHOP_PAGE_SIZE })), []);
  function idSelectionSetter(key: 'category' | 'subcategory'): Dispatch<SetStateAction<string>> {
    return value => setCriteria(old => {
      const selection = old[key];
      const current = typeof selection === 'string' ? selection : '';
      return { ...old, [key]: typeof value === 'function' ? value(current) : value };
    });
  }
  const setSelectedCategory = idSelectionSetter('category');
  const setSelectedSubcategory = idSelectionSetter('subcategory');
  const setSelectedType = selectionSetter('type');
  const setSortOption = selectionSetter('sort');

  useEffect(() => {
    let alive = true;
    setCategoryError(null);
    fetchCategories().then(data => { if (alive) setCategories(data); }).catch(() => {
      if (alive) setCategoryError('No se pudieron cargar las categorías. Reintentá la carga.');
    });
    return () => { alive = false; };
  }, [categoryRevision]);

  useEffect(() => {
    const resize = () => setIsMobileView(window.innerWidth < 768);
    const scroll = () => setShowScrollTop(window.scrollY > 300);
    resize(); scroll();
    window.addEventListener('resize', resize); window.addEventListener('scroll', scroll, { passive: true });
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('scroll', scroll); };
  }, []);
  useEffect(() => {
    const search = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === 'string') setSearchTerm(event.detail);
    };
    window.addEventListener('mobileSearch', search);
    return () => window.removeEventListener('mobileSearch', search);
  }, [setSearchTerm]);

  useEffect(() => {
    // Observe Router acknowledgements without treating an older local render as navigation.
    if (location.search !== currentLocation.current) {
      currentLocation.current = location.search;
      const acknowledged = navigationType === 'POP' ? -1 : pendingLocations.current.indexOf(location.search);
      if (acknowledged < 0) {
        pendingLocations.current = [];
        explicitLocation.current = null;
        setCriteria(readShopCriteria(location.search));
        return;
      }
      pendingLocations.current.splice(0, acknowledged + 1);
    }
    if (explicitLocation.current === location.search) explicitLocation.current = null;
    if (isIOS || explicitLocation.current !== null) return;
    const next = shopCriteriaParams(criteria, legacyFilter).toString();
    const nextLocation = next ? '?' + next : '';
    if (nextLocation !== location.search && pendingLocations.current[pendingLocations.current.length - 1] !== nextLocation) {
      pendingLocations.current.push(nextLocation);
      setParams(new URLSearchParams(next), { replace: true });
    }
  }, [criteria, legacyFilter, location.search, navigationType, isIOS, setParams]);

  const setSearchParams = (value: URLSearchParams | Record<string, string>, options?: { replace?: boolean }) => {
    if (isIOS) return;
    const next = new URLSearchParams(value);
    const nextLocation = next.size ? '?' + next.toString() : '';
    if (nextLocation !== location.search) {
      pendingLocations.current.push(nextLocation);
      explicitLocation.current = nextLocation;
    }
    setParams(next, options);
  };
  const filteredProducts = useMemo(() => selectShopProducts(snapshot.products, criteria, language), [snapshot.products, criteria, language]);
  const pageSize = view.size;
  const hasCriteria = Boolean(criteria.search.trim() || criteria.category || criteria.subcategory || (criteria.type && criteria.type !== 'Todos') || (criteria.sort && criteria.sort !== 'az'));
  // A partial first page is a preview, never a complete search/filter result.
  const awaitingGlobalResults = !snapshot.complete && hasCriteria;
  const sortedProducts = awaitingGlobalResults ? [] : filteredProducts.slice(0, pageSize);
  const availableTypes = useMemo(() => [...new Set(snapshot.products.filter(p => p.active === true).map(p => p.tipo).filter((type): type is string => Boolean(type)))].sort((a, b) => a.localeCompare(b, 'es')), [snapshot.products]);
  const countDescription = snapshot.complete ? `${filteredProducts.length} productos encontrados` : snapshot.error ? 'Catálogo sin completar' : 'Cargando catálogo completo...';
  const selectedOrderMobile = criteria.sort === 'priceAsc' ? 'asc' : criteria.sort === 'priceDesc' ? 'desc' : criteria.sort;
  const handleOrderChangeMobile = (order: string) => {
    const sort: ShopSort = order === 'asc' ? 'priceAsc' : order === 'desc' ? 'priceDesc' : order === 'za' ? 'za' : 'az';
    setSortOption(sort); setShowOrderMenuMobile(false);
  };
  const handleCategoryClick = (name: string) => {
    const category = categories.find(c => c.name === name);
    setCriteria(old => ({ ...old, category: category?.id ?? '', subcategory: '' }));
  };
  const handleSubcategoryClick = (name: string) => {
    if (!name) { setSelectedSubcategory(''); return; }
    for (const category of categories) {
      const subcategory = category.subcategories.find(s => s.name === name);
      if (subcategory) { setCriteria(old => ({ ...old, category: category.id, subcategory: subcategory.id })); return; }
    }
  };
  const retryCatalog = () => { snapshot.retry(); setCategoryRevision(value => value + 1); };
  return {
    paginatedProducts: snapshot.products, hasMore: snapshot.complete && filteredProducts.length > pageSize,
    isInitialLoad: snapshot.pending && snapshot.products.length === 0, isLoadingPage: false, loading: snapshot.pending && snapshot.products.length === 0,
    isSearchMode: Boolean(criteria.search.trim()), isLoadingAllProducts: snapshot.pending,
    catalogPending: snapshot.pending, catalogComplete: snapshot.complete, catalogError: snapshot.error ?? categoryError,
    countDescription, retryCatalog,
    searchTerm: criteria.search, setSearchTerm, selectedCategory: typeof criteria.category === 'string' ? criteria.category : '', setSelectedCategory,
    selectedSubcategory: typeof criteria.subcategory === 'string' ? criteria.subcategory : '', setSelectedSubcategory, selectedType: criteria.type, setSelectedType,
    sortOption: criteria.sort, setSortOption, selectedOrderMobile, showOrderMenuMobile, setShowOrderMenuMobile, handleOrderChangeMobile,
    filteredProducts, sortedProducts, sortedProductsMobile: sortedProducts, productsToDisplay: filteredProducts, availableTypes,
    categories, subcategories: categories.flatMap(c => c.subcategories), handleCategoryClick, handleSubcategoryClick,
    loadMore: () => setView(old => ({ ...old, size: old.size + SHOP_PAGE_SIZE })),
    isMobileView, showScrollTop, setShowScrollTop, isFilterOpen, setIsFilterOpen, showMobileFilter, setShowMobileFilter,
    filterParam: legacyFilter.toUpperCase(), isIOS, scrollToTop: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    handleFilterByType: setSelectedType, setSearchParams,
  };
}
