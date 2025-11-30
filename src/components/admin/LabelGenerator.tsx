// src/components/admin/LabelGenerator.tsx
import { useState, useEffect } from "react";
import jsPDF from "jspdf";
import { safeParse } from "../../utils/safeStorage";

interface Order {
  id: number;
  client: string;
  phone: string;
  address: string;
  city: string;
  department: string;
  postalCode: string;
  status: string;
}

export default function LabelGenerator() {
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    const pedidos = safeParse<any[]>("pedidos", []);

    const parsed: Order[] = pedidos.map((pedido: any) => ({
      id: pedido.id,
      client: pedido.cliente.nombre,
      phone: pedido.cliente.telefono,
      address: pedido.cliente.direccion,
      city: pedido.cliente.ciudad || "Ciudad no especificada",
      department: pedido.cliente.departamento || "-",
      postalCode: pedido.cliente.codigoPostal || "-",
      status: pedido.estado || "En proceso",
    }));

    setOrders(parsed);
  }, []);

  const generateLabel = (order: Order) => {
    const doc = new jsPDF({ orientation: "landscape", unit: "in", format: [4, 6] });
  
    const logo = new Image();
    logo.src = "/logo-etiqueta.png";
  
    logo.onload = () => {
      // Recuadro general de la etiqueta
      doc.setDrawColor(200);
      doc.rect(0.2, 0.2, 5.6, 3.6); // x, y, width, height
  
      // Título centrado
      doc.setFontSize(14);
      doc.setFont(undefined, "bold");
      doc.text("Etiqueta de Envío", 3, 0.6, { align: "center" });
  
      // Logo
      doc.addImage(logo, "PNG", 0.4, 1.0, 1.6, 1.6);
  
      // Campos alineados
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
      drawRow("Nombre", order.client);
      drawRow("Teléfono", order.phone);
      drawRow("Dirección", order.address);
      drawRow("Ciudad", order.city);
      drawRow("Departamento", order.department);
      drawRow("Código Postal", order.postalCode);
  
      doc.save(`Etiqueta-${order.client}.pdf`);
    };
  };
  return (
    <div className="bg-white p-6 rounded shadow">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Generar Etiquetas</h2>
      </div>

      {orders.length === 0 ? (
        <p className="text-sm text-gray-500">No hay pedidos cargados.</p>
      ) : (
        <ul className="space-y-4">
          {orders.map((order) => (
            <li key={order.id} className="border rounded p-4">
              <p className="text-sm font-semibold">
                {order.client} - {order.address}
              </p>
              <button
                onClick={() => generateLabel(order)}
                className="mt-2 text-sm bg-black text-white px-4 py-1 rounded hover:bg-gray-900"
              >
                Generar etiqueta 6x4
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}