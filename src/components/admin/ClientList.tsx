// src/components/admin/ClientList.tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ClientWithId } from "../../data/types";
import { auth } from "../../firebaseConfig";
import { toast } from "react-hot-toast";

interface Props {
  onSelectClient?: (id: string) => void;
}

export default function ClientList({ onSelectClient }: Props) {
  const [search, setSearch] = useState("");
  const [clients, setClients] = useState<ClientWithId[]>([]);
  const [clientToDelete, setClientToDelete] = useState<ClientWithId | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function loadClients() {
      try {
        const current = auth.currentUser;
        if (!current) return;

        const token = await current.getIdToken();
        const res = await fetch("/api/admin/clients", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "Error al cargar clientes");
        }

        const data = await res.json();
        setClients(data.clients || []);
      } catch (error) {
        console.error("Error fetching clients:", error);
        toast.error("❌ No se pudieron cargar los clientes.");
      }
    }
    loadClients();
  }, []);

  const filtered = clients.filter((c) =>
    (c.name || "").toLowerCase().includes(search.toLowerCase())
  );

  const handleDeleteClient = async (id: string) => {
    try {
      const current = auth.currentUser;
      if (!current) {
        toast.error("Usuario no autenticado.");
        return;
      }

      const token = await current.getIdToken();
      const res = await fetch(`/api/admin/clients/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Error al eliminar cliente");
      }

      setClients((prev) => prev.filter((c) => c.id !== id));
      toast.success("Cliente eliminado.");
    } catch (error) {
      console.error("Error al eliminar cliente:", error);
      toast.error("❌ No se pudo eliminar el cliente.");
    }
  };

  return (
    <div className="bg-white p-4 rounded shadow">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Lista de Clientes</h2>
        <input
          type="text"
          placeholder="Buscar por nombre..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border px-3 py-1 rounded text-sm"
        />
      </div>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2">Nombre</th>
            <th className="py-2">Email</th>
            <th className="py-2">Teléfono</th>
            <th className="py-2">Dirección</th>
            <th className="py-2">País</th>
            <th className="py-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((client) => (
            <tr key={client.id} className="border-b">
              <td className="py-2">{client.name}</td>
              <td className="py-2">{client.email}</td>
              <td className="py-2">{client.phone}</td>
              <td className="py-2">{client.address}</td>
              <td className="py-2">{client.country}</td>
              <td className="py-2 flex gap-2">
                <button
                  onClick={() =>
                    onSelectClient
                      ? onSelectClient(client.id)
                      : navigate(`/admin/clientes/${client.id}`)
                  }
                  className="text-blue-600 hover:underline text-sm"
                >
                  Ver perfil
                </button>
                <button
                  onClick={() => setClientToDelete(client)}
                  className="text-red-600 hover:text-red-800"
                  title="Eliminar cliente"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3m5 0H6" />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {clientToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded shadow-md max-w-sm w-full text-center">
            <h3 className="text-lg font-semibold mb-4">¿Eliminar cliente?</h3>
            <p className="text-sm text-gray-600 mb-6">
              ¿Estás seguro de que deseas eliminar a <span className="font-bold">{clientToDelete.name}</span>? Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-center gap-4">
              <button
                onClick={async () => {
                  await handleDeleteClient(clientToDelete.id);
                  setClientToDelete(null);
                }}
                className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition"
              >
                Sí, eliminar
              </button>
              <button
                onClick={() => setClientToDelete(null)}
                className="px-4 py-2 border rounded hover:bg-gray-100 transition"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}