// src/App.tsx

import { Routes, Route, Navigate, useParams, useNavigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { CartProvider } from "./context/CartContext";
import LayoutRoutes from "./components/LayoutRoutes";
import Hero from "./components/Hero";
import { Helmet } from "react-helmet-async";
import CategorySection from "./components/CategorySection";
import Footer from "./components/Footer";
import AboutPreview from "./components/AboutPreview";
import ProductPage from "./pages/ProductPage";
// import FootballPage from "./pages/FootballPage";
import CartPage from "./pages/CartPage";
import SuccessPage from "./pages/SuccessPage";
import AdminPanel from "./pages/AdminPanel";
import AboutPage from "./pages/AboutPage";
import LoginForm from "./components/LoginForm";
import RequireAuth from "./components/RequireAuth";
import AdminCategoryManager from "./components/admin/AdminCategoryManager"; // ✅ NUEVO componente oficial
import OrderAdmin from "./components/admin/OrderAdmin";
import ClientDetail from "./components/admin/ClientDetail";
import Shop from "./pages/Shop";


function ClientDetailWrapper() {
  const { id } = useParams();
  const navigate = useNavigate();

  const clientId = id || "";

  return <ClientDetail clientId={clientId} onBack={() => navigate("/admin")} />;
}

function Home() {
  return (
    <>
      <Helmet>
        <title>Mutter Games — Consolas, videojuegos y coleccionables</title>
        <meta name="description" content="Tienda de consolas, videojuegos y coleccionables. Pago protegido con Mercado Pago y envíos a todo el país." />
        <meta property="og:title" content="Mutter Games — Consolas, videojuegos y coleccionables" />
        <meta property="og:description" content="Explorá juegos, consolas, accesorios y figuras. Stock real y atención personalizada." />
        <meta property="og:image" content="/seo-image.jpg" />
        <meta property="og:url" content="https://mutter-games.vercel.app/" />
        <meta property="og:type" content="website" />
        <link rel="canonical" href="https://mutter-games.vercel.app/" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Mutter Games — Consolas, videojuegos y coleccionables" />
        <meta name="twitter:description" content="Tienda de consolas, videojuegos y coleccionables." />
        <meta name="twitter:image" content="/seo-image.jpg" />
      </Helmet>
      <Hero />
      <CategorySection />
      <AboutPreview />
      <Footer />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <div className="bg-[#0F0F0F] min-h-screen flex flex-col">
          <Helmet>
            <title>Mutter Games — Consolas, videojuegos y coleccionables</title>
            <meta name="description" content="Mutter Games es tu tienda online de confianza para consolas, videojuegos, accesorios y artículos coleccionables en Uruguay." />
            <meta property="og:site_name" content="Mutter Games" />
            <meta property="og:type" content="website" />
            <meta property="og:title" content="Mutter Games — Consolas, videojuegos y coleccionables" />
            <meta property="og:description" content="Explorá juegos, consolas, accesorios y figuras. Stock real y atención personalizada." />
            <meta property="og:image" content="/seo-image.jpg" />
            <meta property="og:url" content="https://muttergames.com/" />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content="Mutter Games — Consolas, videojuegos y coleccionables" />
            <meta name="twitter:description" content="Mutter Games es tu tienda online de confianza para consolas, videojuegos, accesorios y artículos coleccionables en Uruguay." />
            <meta name="twitter:image" content="/seo-image.jpg" />
            <link rel="canonical" href="https://muttergames.com/" />
          </Helmet>
          <Routes>
            {/* ✅ Login público */}
            <Route path="/login" element={<LoginForm />} />

            {/* ✅ Ruta protegida directa al administrador de categorías */}
            <Route
              path="/admin/categorias"
              element={
                <RequireAuth>
                  <AdminCategoryManager />
                </RequireAuth>
              }
            />

            {/* ✅ Detalle de cliente en administración */}
            <Route
              path="/admin/clientes/:id"
              element={
                <RequireAuth>
                  <ClientDetailWrapper />
                </RequireAuth>
              }
            />

            {/* ✅ Panel completo de administración */}
            <Route path="/admin/*" element={<RequireAuth><AdminPanel /></RequireAuth>} />

            {/* ✅ Ruta pública sin layout */}
            <Route path="/carrito" element={<CartPage />} />
            <Route path="/success" element={<SuccessPage />} />

            {/* ✅ Ruta pública sin layout */}
            <Route path="/producto/:slug" element={<ProductPage />} />

            {/* ✅ Layout general para todas las rutas públicas */}
            <Route element={<LayoutRoutes />}>
              <Route path="/" element={<Home />} />
              <Route path="/explore" element={<CategorySection />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/shop" element={<Shop />} />
            </Route>

            {/* ✅ Fallback 404 */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </CartProvider>
    </AuthProvider>
  );
}