// src/components/RequireAuth.tsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ReactNode } from "react";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return null; // o spinner en el futuro
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}