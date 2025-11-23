// src/components/admin/ClientDetail.tsx
import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import { adminApiFetch } from "../../utils/adminApi";

interface Props {
  clientId: string;
  onBack: () => void;
}

interface Client {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  address2?: string;
  city: string;
  state: string;
  zip?: string;
  country: string;
  password?: string;
}

interface Pedido {
  id: string; // antes era number
  total: number;
  fecha: string;
  estado: string;
  cliente: {
    email: string;
  };
}

export default function ClientDetail({ clientId, onBack }: Props) {
  const [client, setClient] = useState<Client | null>(null);
  const [editing, setEditing] = useState(false);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [activeTab, setActiveTab] = useState("personal");

  const { user, isLoading } = useAuth();

useEffect(() => {
  async function fetchClient() {
    try {
      console.log("📦 clientId recibido:", clientId);
      if (typeof clientId !== "string" || clientId.trim() === "") {
        console.error("❌ ID del cliente inválido:", clientId);
        return;
      }
      const docRef = doc(db, "clients", clientId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setClient({ ...data, id: docSnap.id } as Client);
      }
    } catch (error) {
      console.error("Error al obtener cliente desde Firestore:", error);
    }
  }

  if (clientId) fetchClient();
}, [clientId]);

  useEffect(() => {
    if (!client) return;

    async function fetchPedidos() {
      try {
        const querySnapshot = await getDocs(
          query(
            collection(db, "orders"),
            where("client.email", "==", client?.email || "")
          )
        );
        const pedidosData = querySnapshot.docs
          .map((doc) => {
            const data = doc.data();
            if (data?.client?.email === client?.email) {
              return {
                id: doc.id,
                total: data.total,
                fecha: data.fecha,
                estado: data.estado,
                cliente: data.client,
              } as Pedido;
            }
            return null;
          })
          .filter((pedido) => pedido !== null) as Pedido[];
        setPedidos(pedidosData);
      } catch (error) {
        console.error("Error al cargar pedidos del cliente:", error);
      }
    }

    fetchPedidos();
  }, [client]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!client) return;
    const { name, value } = e.target;
    setClient({ ...client, [name]: value });
  };

  const handleSave = async () => {
    if (!client) return;
    try {
      await adminApiFetch(`/api/admin/clients/${client.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: client.name,
          email: client.email,
          phone: client.phone,
          address: client.address,
          address2: client.address2,
          city: client.city,
          state: client.state,
          zip: client.zip,
          country: client.country,
          ...(client.password ? { password: client.password } : {})
        }),
      });
      setEditing(false);
      setClient({ ...client });
    } catch (error) {
      console.error("Error al actualizar cliente:", error);
    }
  };

  if (!client) return <p className="text-red-600 p-6 font-bold">Cliente no encontrado.</p>;

  return (
    <div className="p-6 bg-white rounded shadow max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">Perfil del Cliente</h2>
      {/* Usuario logueado */}
      {isLoading ? (
        <p>Cargando usuario...</p>
      ) : user ? (
        <p className="text-sm text-gray-500">Usuario logueado: {user.email}</p>
      ) : (
        <p className="text-sm text-gray-500">Usuario logueado: No Logueado</p>
      )}
  
      <div className="flex border-b mb-4">
        <button
          onClick={() => setActiveTab("personal")}
          className={`px-4 py-2 font-medium ${
            activeTab === "personal" ? "border-b-2 border-black" : "text-gray-500"
          }`}
        >
          Datos Personales
        </button>
        <button
          onClick={() => setActiveTab("orders")}
          className={`px-4 py-2 font-medium ${
            activeTab === "orders" ? "border-b-2 border-black" : "text-gray-500"
          }`}
        >
          Historial de Pedidos
        </button>
      </div>
      {activeTab === "personal" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block font-semibold">Nombre</label>
              <input
                type="text"
                name="name"
                value={client.name}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
                disabled={!editing}
              />
            </div>
            <div>
              <label className="block font-semibold">Email</label>
              <input
                type="email"
                name="email"
                value={client.email}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
                disabled={!editing}
              />
            </div>
            <div>
              <label className="block font-semibold">Teléfono</label>
              <input
                type="text"
                name="phone"
                value={client.phone}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
                disabled={!editing}
              />
            </div>
            <div>
              <label className="block font-semibold">Dirección</label>
              <input
                type="text"
                name="address"
                value={client.address}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
                disabled={!editing}
              />
            </div>
            <div>
              <label className="block font-semibold">Dirección Adicional</label>
              <input
                type="text"
                name="address2"
                value={client.address2 || ""}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
                disabled={!editing}
              />
            </div>
            <div>
              <label className="block font-semibold">Ciudad</label>
              <input
                type="text"
                name="city"
                value={client.city}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
                disabled={!editing}
              />
            </div>
            <div>
              <label className="block font-semibold">Estado</label>
              <input
                type="text"
                name="state"
                value={client.state}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
                disabled={!editing}
              />
            </div>
            <div>
              <label className="block font-semibold">Código Postal</label>
              <input
                type="text"
                name="zip"
                value={client.zip}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
                disabled={!editing}
              />
            </div>
            <div>
              <label className="block font-semibold">País</label>
              <input
                type="text"
                name="country"
                value={client.country || "Uruguay"}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
                disabled={!editing}
              />
            </div>
            {editing && (
              <div className="col-span-2">
                <label className="block font-semibold">Nueva Contraseña</label>
                <input
                  type="password"
                  name="password"
                  value={client.password || ""}
                  onChange={handleChange}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
            )}
          </div>
          <div className="flex gap-4">
            {!editing ? (
              <button
                onClick={() => setEditing(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                Editar datos
              </button>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                >
                  Guardar cambios
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="bg-gray-300 text-black px-4 py-2 rounded hover:bg-gray-400"
                >
                  Cancelar
                </button>
              </>
            )}
          </div>
        </>
      )}
      {activeTab === "orders" && (
        <div>
          {pedidos.length === 0 ? (
            <p className="text-gray-500 italic">Este cliente aún no tiene pedidos registrados.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left">ID</th>
                  <th className="py-2 text-left">Total</th>
                  <th className="py-2 text-left">Estado</th>
                  <th className="py-2 text-left">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((pedido) => (
                  <tr key={pedido.id} className="border-b">
                    <td className="py-2">{pedido.id}</td>
                    <td className="py-2">{pedido.total} USD</td>
                    <td className="py-2">{pedido.estado}</td>
                    <td className="py-2">{new Date(pedido.fecha).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// Wrapper para parsear el id recibido como string a número
export function ClientDetailWrapper({ clientId, onBack }: { clientId: string; onBack: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={onBack} />
      <div className="fixed inset-0 z-50 flex justify-center items-center">
        <div className="bg-white rounded shadow-lg max-w-5xl w-full mx-4 p-6 overflow-y-auto max-h-[90vh] relative">
          <button
            onClick={onBack}
            className="absolute top-4 right-4 text-gray-500 hover:text-black text-2xl"
          >
            ×
          </button>
          <ClientDetail clientId={clientId} onBack={onBack} />
        </div>
      </div>
    </>
  );
}
