// src/utils/adminApi.ts
import { auth } from "../firebase";
export async function adminApiFetch(path: string, options: RequestInit = {}) {
  const base = import.meta.env.VITE_ADMIN_API_URL;
  if (!base) throw new Error("Falta VITE_ADMIN_API_URL en .env.development.local");

  const current = auth.currentUser;
  if (!current) throw new Error("Usuario no autenticado");

  const token = await current.getIdToken();

  const headers: HeadersInit = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  // Si hay body y no se especificó Content-Type, asumimos JSON
  if (options.body && !(headers as any)["Content-Type"]) {
    (headers as any)["Content-Type"] = "application/json";
  }

  const res = await fetch(`${base}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // ignoramos errores de parseo de JSON
    }
    throw new Error(data?.error || `Error ${res.status}`);
  }

  return res.json();
}

// ⚠️ Solo para uso manual en consola, no usar en producción real
export async function runSortKeyMigrationOnce() {
  console.log("[MIGRATION] Ejecutando /api/admin/products/migrate-sort-key...");
  const res = await adminApiFetch("/api/admin/products/migrate-sort-key", {
    method: "POST",
  });
  console.log("[MIGRATION] Resultado:", res);
}