// src/pages/AdminPanel.tsx
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import Sidebar from "../components/admin/Sidebar";
import ClientList from "../components/admin/ClientList";
import ProductList from "../components/admin/ProductList";
import ProductForm from "../components/admin/ProductForm";
import UserList from "../components/admin/UserList";
import AdminCategoryManager from "../components/admin/AdminCategoryManager"; // ✅ archivo nuevo
import OrderAdmin from "../components/admin/OrderAdmin";
import { ClientDetailWrapper } from "../components/admin/ClientDetail";

import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext"; // ✅ importar hook de autenticación

export default function AdminPanel() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeView, setActiveView] = useState("clients");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const { user, isLoading, credentialScope } = useAuth();
  const catalogOnly = credentialScope === 'JOHN_ADMIN_CLOSED_V1';
  const defaultView = catalogOnly ? '/admin/productList' : '/admin/clients';

  useEffect(() => {
    const path = location.pathname.split('/').pop() || "clients";
    setActiveView(path);
  }, [location]);

  const handleViewChange = (view: string) => {
    setActiveView(view);
    navigate(`/admin/${view}`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 md:flex-row">
      {/* Sidebar dinámico */}
      <Sidebar activeView={activeView} onChangeView={handleViewChange} />

      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mb-4 text-sm text-gray-600">
          {isLoading ? (
            <><strong>Usuario logueado:</strong> <span className="text-gray-400">Cargando usuario...</span></>
          ) : user ? (
            <><strong>Usuario logueado:</strong> {user.email}</>
          ) : (
            <><strong>Usuario logueado:</strong> <span className="text-red-500">No logueado</span></>
          )}
        </div>
        {catalogOnly && <p role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Las compras siguen cerradas. Podés abrir, editar y crear publicaciones; guardar cambios conserva el estado de las publicaciones existentes.</p>}
        <Routes>
          <Route index element={<Navigate to={defaultView} replace />} />
          {!catalogOnly && <Route
            path="clients"
            element={
              <ClientList onSelectClient={(id) => setSelectedClientId(id)} />
            }
          />}
          <Route path="productList" element={<ProductList />} />
          {!catalogOnly && <Route path="productForm" element={<ProductForm />} />}
          {!catalogOnly && <>
            <Route path="orders" element={<OrderAdmin />} />
            <Route path="users" element={<UserList />} />
            <Route path="categories" element={<AdminCategoryManager />} />
            <Route path="editar/:id" element={<ProductForm />} />
          </>}

          {/* Ruta de fallback */}
          <Route path="*" element={<Navigate to={defaultView} replace />} />
        </Routes>
        {!catalogOnly && selectedClientId && (
          <ClientDetailWrapper
            clientId={selectedClientId || ""}
            onBack={() => setSelectedClientId(null)}
          />
        )}
      </main>
    </div>
  );
}
