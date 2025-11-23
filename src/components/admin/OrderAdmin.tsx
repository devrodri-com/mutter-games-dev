// src/components/admin/OrderAdmin.tsx

// Utilidad para obtener info del cliente desde diferentes fuentes
const getClienteInfo = (pedido: Order) => {
  const cliente = (typeof pedido.client === 'object' && pedido.client !== null)
    ? pedido.client
    : typeof pedido.clientInfo === 'object'
    ? pedido.clientInfo
    : typeof pedido.shippingInfo === 'object'
    ? pedido.shippingInfo
    : {};

  return {
    nombre: cliente.nombre || cliente.name || pedido.shippingInfo?.name || (pedido.shippingInfo as any)?.fullName || "-",
    telefono: cliente.telefono || cliente.phone || pedido.shippingInfo?.phone || (pedido.shippingInfo as any)?.phoneNumber || "-",
    direccion: cliente.direccion || cliente.address || pedido.address || pedido.shippingInfo?.address || "-",
    address: cliente.address || pedido.address || pedido.shippingInfo?.address || "-",
    address2: cliente.address2 || (cliente as any)?.apto || (cliente as any)?.address_line2 || (pedido.shippingInfo?.address2 || (pedido.shippingInfo as any)?.addressLine2 || "-"),
    email: cliente.email || pedido.shippingInfo?.email || (pedido.shippingInfo as any)?.contactEmail || "-"
  };
};

import { useState, useEffect } from "react";
import { auth } from "@/firebaseUtils";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import {
  collection,
  getDocs,
  doc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db } from "@/firebase"; // asumimos que ya existe tu instancia db

interface ClientInfo {
  name?: string;
  nombre?: string;
  email?: string;
  phone?: string;
  telefono?: string;
  address?: string;
  address2?: string;
  direccion?: string;
  country?: string;
}

interface ShippingInfo {
  // Define properties as needed, or leave empty if unknown
  [key: string]: any;
}

interface OrderItem {
  title?: { es?: string };
  name?: { es?: string };
  options?: string;
  quantity?: number;
  price?: number;
  variantLabel?: string;
}

interface Order {
  id: number | string;
  client: string | ClientInfo;
  items: OrderItem[] | string[];
  total: number;
  status: "En Proceso" | "Cancelado" | "Confirmado" | "Entregado" | "Enviado";
  address: string;
  city: string;
  department: string;
  postalCode: string;
  phone?: string;
  createdAt: Date;
  clientInfo?: ClientInfo;
  amountPaid?: number;
  shippingInfo?: ShippingInfo;
  totalAmount?: number;
  shippingCost?: number;
}

export default function OrderAdmin() {
  const [orders, setOrders] = useState<Order[]>([]);
  // Para tipado de la función handleStatusChange
  type OrderType = Order;
  // Nueva función para cambiar el estado de un pedido y descontar stock si corresponde
  const handleStatusChange = async (orderId: string, newStatus: string) => {
    const order = orders.find((o: OrderType) => o.id === orderId);
    if (!order) return;

    // TODO: persistir estado via backend admin
    if (import.meta.env.DEV) {
      console.warn("[OrderAdmin] Modo solo lectura: no se actualiza en Firestore");
    }

    const updatedOrders: Order[] = orders.map((o) =>
      o.id === orderId ? { ...o, status: newStatus as Order['status'] } : o
    );
    setOrders(updatedOrders);
  };
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  // Estado para el filtro de estado de pedido
  const [filtroEstado, setFiltroEstado] = useState("Todos");
  const [busqueda, setBusqueda] = useState("");
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);

  useEffect(() => {
    let unsubOrders: (() => void) | null = null;

    const detachOrders = () => {
      if (unsubOrders) {
        unsubOrders();
        unsubOrders = null;
      }
    };

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          // No autenticado: limpiar lista y soltar listener de orders
          detachOrders();
          setOrders([]);
          return;
        }

        // Determinar si es admin usando los custom claims de Firebase Auth
        const token = await user.getIdTokenResult();
        const esAdmin = token.claims.admin === true || token.claims.superadmin === true;

        // Construir query según permisos + filtro estado
        const baseCol = collection(db, "orders");
        let q;
        if (esAdmin) {
          q = (filtroEstado === "Todos")
            ? query(baseCol, orderBy("createdAt", "desc"), limit(300))
            : query(baseCol, where("status", "==", filtroEstado), orderBy("createdAt", "desc"), limit(300));
        } else {
          q = (filtroEstado === "Todos")
            ? query(baseCol, where("uid", "==", user.uid), orderBy("createdAt", "desc"), limit(300))
            : query(baseCol, where("uid", "==", user.uid), where("status", "==", filtroEstado), orderBy("createdAt", "desc"), limit(300));
        }

        // Re‑adjuntar listener de orders (evita duplicados)
        detachOrders();
        unsubOrders = onSnapshot(q, (snapshot) => {
          const docs = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            const cliente = data.cliente || {};
            const clientRaw = data.clientInfo || data.client || {};
            const shippingRaw = data.shippingInfo || data.shipping || {};

            const createdAtVal = (() => {
              if (data.createdAt?.toDate) return data.createdAt.toDate();
              if (typeof data.createdAt === "number") return new Date(data.createdAt);
              return new Date();
            })();

            return {
              id: docSnap.id,
              client: {
                name: clientRaw.name || clientRaw.nombre || shippingRaw.name || shippingRaw.fullName || cliente.nombre || "-",
                email: clientRaw.email || shippingRaw.email || shippingRaw.contactEmail || cliente.email || "-",
                phone: clientRaw.phone || clientRaw.telefono || shippingRaw.phone || shippingRaw.phoneNumber || cliente.telefono || "-",
              },
              address: shippingRaw.address || shippingRaw.addressLine1 || cliente.direccion || data.address || "-",
              city: shippingRaw.city || cliente.ciudad || data.city || "-",
              department: shippingRaw.state || cliente.departamento || data.department || "-",
              postalCode: shippingRaw.postalCode || shippingRaw.zip || shippingRaw.zipCode || shippingRaw.postCode || cliente.codigoPostal || data.postalCode || "-",
              items: data.items || [],
              total: data.total || 0,
              amountPaid: data.amountPaid || data.total || 0,
              status: data.status || "Pendiente",
              createdAt: createdAtVal,
              shippingInfo: shippingRaw,
              totalAmount: data.totalAmount || data.total || 0,
              shippingCost: data.shippingCost || 0,
            } as Order;
          });
          setOrders(docs);
        }, (err) => {
          console.error("[Orders] snapshot error:", err);
          if ((err?.code || "").includes("permission-denied")) {
            setOrders([]);
          }
        });
      } catch (e: any) {
        console.error("[Orders] fetch error:", e);
        setOrders([]);
      }
    });

    // Limpieza
    return () => {
      detachOrders();
      unsubAuth();
    };
  }, [filtroEstado]);

  const cycleStatus = (status: Order["status"]): Order["status"] => {
    const order = ["En proceso", "Cancelado", "Confirmado", "Entregado", "Enviado"];
    const index = order.indexOf(status);
    return order[(index + 1) % order.length] as Order["status"];
  };

  const updateStatus = async (id: number | string, newStatus: Order["status"]) => {
    const order = orders.find((order) => order.id === id);
    const updatedOrders = orders.map((order) =>
      order.id === id ? { ...order, status: newStatus } : order
    );
    setOrders(updatedOrders);
    // TODO: persistir estado via backend admin
    if (import.meta.env.DEV) {
      console.warn("[OrderAdmin] Modo solo lectura: no se actualiza en Firestore");
    }
  };

  const generateLabel = async (order: Order) => {
    console.log("[Etiqueta] Generando para:", order);
    const doc = new jsPDF({ orientation: "landscape", unit: "in", format: [4, 6] });
  
    // Cargar imagen como base64
    const response = await fetch("/logo-etiqueta.png");
    const blob = await response.blob();
    const reader = new FileReader();
  
    reader.onloadend = async () => {
      const base64data = reader.result as string;
  
      // Recuadro
      doc.setDrawColor(200);
      doc.rect(0.2, 0.2, 5.6, 3.6);
  
      // Título
      doc.setFontSize(14);
      doc.setFont(undefined, "bold");
      doc.text("Etiqueta de Envío", 3, 0.6, { align: "center" });
  
      // Logo
      doc.addImage(base64data, "PNG", 0.4, 1.0, 1.6, 1.6);
  
      // Campos
      doc.setFontSize(12);
      let y = 1.0;
      const labelX = 2.4;
      const valueX = 3.8;
  
      const drawRow = (label: string, value: string) => {
        doc.setFont(undefined, "bold");
        doc.text(`${label}:`, labelX, y);
        doc.setFont(undefined, "normal");
        doc.text(value, valueX, y);
        y += 0.35;
      };
  
      drawRow("Orden", `${order.id ?? "-"}`);
      drawRow("Nombre", typeof order.client === "object" ? order.client?.name || "-" : order.client);
      drawRow("Teléfono", typeof order.client === "object" ? order.client?.phone || "-" : "-");
      drawRow("Dirección", order.address);
      drawRow("Ciudad", order.city);
      drawRow("Departamento", order.department);
      drawRow("Código Postal", order.postalCode);

      // Generar imagen QR en base64 con el ID
      const qrDataUrl = await QRCode.toDataURL(`ID-${order.id}`);
      doc.addImage(qrDataUrl, "PNG", 5.0, 2.8, 0.8, 0.8); // Ubicación esquina inferior derecha
  
      doc.save(`Etiqueta-${order.client}.pdf`);
    };
  
    reader.readAsDataURL(blob);
  };

  const exportCSV = () => {
    const csv = [
      ["ID", "Cliente", "Productos", "Total", "Estado"],
      ...orders.map((o) => [
        o.id,
        `"${typeof o.client === "object" ? o.client.name : o.client}"`,
        `"${o.items}"`,
        `"${o.total} USD"`,
        `"${o.status}"`,
      ]),
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "pedidos.csv";
    link.click();
  };

  // Filtrar pedidos según el filtro visual y el término de búsqueda
  const pedidosFiltrados = orders.filter((pedido) => {
    const estadoMatch =
      filtroEstado === "Todos"
        ? true
        : pedido.status === filtroEstado;
    const clienteInfo = getClienteInfo(pedido);
    const nombre = clienteInfo.nombre || "Sin nombre";
    const email = clienteInfo.email || "";
    const busquedaMatch =
      nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      email.toLowerCase().includes(busqueda.toLowerCase());
    return estadoMatch && busquedaMatch;
  });

  // Función para formatear la fecha
  function formatDate(date: Date | string) {
    if (!date) return "-";
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString();
  }

  // Acciones de detalle, imprimir, eliminar
  function handleVerDetalle(pedido: Order) {
    setSelectedOrder(pedido);
  }
  function handleImprimirEtiqueta(pedido: Order) {
    generateLabel(pedido);
  }
  function handleEliminarPedido(id: number | string) {
    setOrderToDelete(orders.find((o) => o.id === id) || null);
  }


  if (!Array.isArray(orders)) {
    console.error("Error: orders no es un array", orders);
    return <div className="p-4 text-red-600 font-semibold">Error al cargar los pedidos.</div>;
  }
  console.log("[PEDIDOS RENDERIZADOS]", orders);
  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold mb-4">Historial de Pedidos</h1>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap gap-4">
        {/* Filtro por estado */}
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="Todos">Todos</option>
          <option value="Pendiente">Pendiente</option>
          <option value="Confirmado">Confirmado</option>
        </select>

        {/* Buscador */}
        <input
          type="text"
          placeholder="Buscar por nombre o email"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 flex-1 min-w-[200px]"
        />
      </div>

      {/* Tabla de pedidos */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Fecha</th>
              <th className="px-4 py-2 border text-left text-sm font-semibold text-gray-700">Nombre</th>
              <th className="px-4 py-2 border text-left text-sm font-semibold text-gray-700">Email</th>
              <th className="px-4 py-2 border text-left text-sm font-semibold text-gray-700">Teléfono</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Total</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Estado</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {pedidosFiltrados.map((pedido) => {
              const clienteInfo = getClienteInfo(pedido);
              return (
                <tr key={pedido.id}>
                  <td className="px-4 py-2 text-sm text-gray-800">{formatDate(pedido.createdAt)}</td>
                  <td className="px-4 py-2 border">{clienteInfo.nombre || 'No disponible'}</td>
                  <td className="px-4 py-2 border">{clienteInfo.email || 'No disponible'}</td>
                  <td className="px-4 py-2 border">{clienteInfo.telefono || 'No disponible'}</td>
                  <td className="px-4 py-2 text-sm text-gray-800">
                    {(() => {
                      const subtotal = Array.isArray(pedido.items)
                        ? pedido.items.reduce((sum, item) => {
                            if (typeof item !== "object") return sum;
                            const price =
                              item?.price !== undefined
                                ? item.price
                                : ((item as any)?.priceUSD ?? 0);
                            const quantity = item?.quantity ?? 0;
                            return sum + price * quantity;
                          }, 0)
                        : 0;
                      const total = subtotal + (pedido.shippingCost ?? 0);
                      return `$${total.toFixed(2)}`;
                    })()}
                  </td>
                  <td className="px-4 py-2 text-sm">
                    <select
                      value={pedido.status}
                      onChange={(e) => updateStatus(pedido.id, e.target.value as Order["status"])}
                      className="border border-gray-300 rounded px-2 py-1"
                    >
                      <option value="Pendiente">Pendiente</option>
                      <option value="Confirmado">Confirmado</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-800 flex gap-2">
                    <button
                      onClick={() => handleVerDetalle(pedido)}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      Ver detalle
                    </button>
                    <button
                      onClick={() => handleImprimirEtiqueta(pedido)}
                      className="text-green-600 hover:underline text-sm"
                    >
                      Imprimir
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`¿Estás seguro que deseas eliminar la orden ${pedido.id}?`)) {
                          if (import.meta.env.DEV) {
                            console.warn("[OrderAdmin] Modo solo lectura: no se elimina en Firestore");
                          }
                          setOrders(orders.filter(o => o.id !== pedido.id));
                        }
                      }}
                      className="text-red-600 hover:underline text-sm"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedOrder && (() => {
        const clienteInfo = getClienteInfo(selectedOrder);
        // Calcular el subtotal correctamente sumando los subtotales de cada producto
        const total =
          Array.isArray(selectedOrder.items)
            ? selectedOrder.items.reduce(
                (sum, item) =>
                  typeof item === "object"
                    ? sum +
                      (
                        ((item.price !== undefined ? item.price : (item as any).priceUSD ?? 0) *
                        (item.quantity ?? 0))
                      )
                    : sum,
                0
              )
            : 0;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white p-6 rounded shadow-lg max-w-2xl w-full">
              <h2 className="text-xl font-bold mb-4">Detalle del Pedido</h2>
              {/* Datos del cliente */}
              <div className="mb-4">
                <h3 className="text-lg font-semibold mb-1">Datos del cliente</h3>
                <p><strong>Nombre:</strong> {clienteInfo.nombre || 'No disponible'}</p>
                <p><strong>Email:</strong> {clienteInfo.email || 'No disponible'}</p>
                <p><strong>Teléfono:</strong> {clienteInfo.telefono || 'No disponible'}</p>
              </div>
              <div className="mb-4">
                <p><strong>ID:</strong> {selectedOrder.id}</p>
                <p>
                  <strong>Dirección:</strong>{" "}
                  {
                    [
                      clienteInfo.address,
                      clienteInfo.address2,
                      selectedOrder.city,
                      selectedOrder.department,
                      selectedOrder.postalCode
                    ].filter(Boolean).join(', ') || '-'
                  }
                </p>
              </div>
              <div className="mb-4">
                <h3 className="font-bold mb-2">Productos:</h3>
                <table className="w-full border text-sm">
                  <thead>
                    <tr>
                      <th className="border px-2 py-1">Producto</th>
                      <th className="border px-2 py-1">Variante</th>
                      <th className="border px-2 py-1">Cantidad</th>
                      <th className="border px-2 py-1">Precio Unitario</th>
                      <th className="border px-2 py-1">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.isArray(selectedOrder.items) &&
                      selectedOrder.items.map((item, index) => {
                        if (typeof item === "string") return null;
                        const title = item.title?.es || item.name?.es || "Producto";
                        const variant = item.variantLabel || item.options || "-";
                        const quantity = item.quantity ?? 0;
                        const price = (item.price !== undefined ? item.price : (item as any).priceUSD ?? 0);
                        const subtotal = (price * quantity).toFixed(2);

                        return (
                          <tr key={index}>
                            <td className="border px-2 py-1">{title}</td>
                            <td className="border px-2 py-1">{variant}</td>
                            <td className="border px-2 py-1">{quantity}</td>
                            <td className="border px-2 py-1">${price.toFixed(2)}</td>
                            <td className="border px-2 py-1">${subtotal}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 text-right">
                <p>Subtotal productos: ${total.toFixed(2)}</p>
                <p>Costo de envío: ${selectedOrder.shippingCost ?? 0}</p>
                <p className="font-semibold">Total con envío: ${(total + (selectedOrder.shippingCost ?? 0)).toFixed(2)}</p>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded">Cerrar</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}