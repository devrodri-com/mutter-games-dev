// src/components/admin/Sidebar.tsx
import { useAuth } from "../../context/AuthContext";

interface SidebarProps {
  activeView: string;
  onChangeView: (view: string) => void;
}

export default function Sidebar({ activeView, onChangeView }: SidebarProps) {
  const { logout, credentialScope } = useAuth();

  const menuItems = [
    { label: "Clientes", view: "clients" },
    { label: "Ver Publicaciones", view: "productList" },
    { label: "Crear Publicaciones", view: "productForm" },
    { label: "Historial de Pedidos", view: "orders" },
    { label: "Categorías", view: "categories" },
    { label: "Usuarios", view: "users" },
  ];

  return (
    <aside className="flex w-full shrink-0 flex-col items-center gap-4 border-b border-gray-200 bg-white px-4 py-3 md:sticky md:top-0 md:h-screen md:w-56 md:flex-col md:border-b-0 md:border-r md:px-4 md:py-7">
      <img src="/brand/login/mutter-compacto-color-positivo.svg" alt="Mutter Games" width={846} height={150} className="h-auto w-40 max-w-full shrink-0 md:mb-3 md:w-48" />
      <h2 className="hidden text-center text-base font-semibold md:mb-6 md:block">Administración</h2>
      <nav aria-label="Administración" className="flex w-full flex-1 flex-wrap items-center gap-2 md:w-full md:flex-none md:flex-col md:items-stretch">
        {menuItems.filter(item => credentialScope !== 'JOHN_ADMIN_CLOSED_V1' || item.view === 'productList').map((item) => (
          <button
            key={item.view}
            onClick={() => onChangeView(item.view)}
            className={`w-full text-left px-4 py-2 rounded font-medium transition ${
              activeView === item.view
                ? "bg-black text-white"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            {item.view === 'productList' ? 'Publicaciones' : item.label}
          </button>
        ))}
        <button
          onClick={logout}
          className="rounded px-3 py-2 text-left text-sm font-medium text-gray-500 transition hover:bg-gray-100 md:mt-5 md:w-full"
        >
          Cerrar sesión
        </button>
      </nav>
    </aside>
  );
}
