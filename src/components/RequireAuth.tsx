// src/components/RequireAuth.tsx
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ReactNode } from "react";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading, credentialScope } = useAuth();
  const { pathname } = useLocation();

  if (isLoading) {
    return null; // o spinner en el futuro
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (credentialScope === 'JOHN_ADMIN_CLOSED_V1'
    && !['/admin', '/admin/', '/admin/productList', '/admin/productList/'].includes(pathname)) {
    return <Navigate to="/admin/productList" replace />;
  }

  return <>{children}</>;
}
