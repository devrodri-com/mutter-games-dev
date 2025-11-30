// Empecemos por la estructura del sistema de integración real de pedidos
// Creamos una función utilitaria para guardar pedidos en localStorage

// src/utils/saveOrder.ts
import { getItem, setItem, safeParse } from "../safeStorage";

export type OrderStatus = "En Proceso" | "Cancelado" | "Confirmado" | "Entregado";

export interface OrderData {
  id: string;
  client: string;
  phone: string;
  address: string;
  products: string;
  total: string;
  status: OrderStatus;
}

export function saveOrderToLocalStorage(newOrder: OrderData) {
  const parsed: OrderData[] = safeParse<OrderData[]>("orders", []);
  parsed.push(newOrder);
  setItem("orders", JSON.stringify(parsed));
}
