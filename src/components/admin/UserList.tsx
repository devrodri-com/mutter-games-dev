// src/components/admin/UserList.tsx

import { useState, useEffect } from "react";
import { auth } from "../../firebaseConfig";
import { useAuth } from "../../context/AuthContext";
import ModalConfirm from "./ModalConfirm";
import { toast } from "react-hot-toast";

export default function UserList() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!user) {
      window.location.href = "/admin/login";
    }
  }, [user]);

  const [newUser, setNewUser] = useState({ name: "", email: "", password: "" });
  const [userList, setUserList] = useState<any[]>([]);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [editedName, setEditedName] = useState("");
  const [selectedUser, setSelectedUser] = useState<any | null>(null);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isSuperAdminFlag, setIsSuperAdminFlag] = useState(false);
  useEffect(() => {
    const checkRole = async () => {
      try {
        // Usamos los custom claims de Firebase Auth como fuente de verdad
        const current = auth.currentUser;
        if (!current) {
          setIsSuperAdminFlag(false);
          return;
        }
        const token = await current.getIdTokenResult();
        setIsSuperAdminFlag(token.claims.superadmin === true);
      } catch (e) {
        console.warn("No se pudo verificar rol:", e);
        setIsSuperAdminFlag(false);
      }
    };
    checkRole();
  }, [user?.id]);

  const fetchUsers = async () => {
    try {
      const current = auth.currentUser;
      if (!current) {
        console.warn("No hay usuario autenticado; no se pueden cargar administradores.");
        return;
      }

      const token = await current.getIdToken();
      const res = await fetch("/api/admin/users", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Error al cargar administradores");
      }

      const data = await res.json();
      const users = (data?.users || []) as any[];

      setUserList(
        users.map((u: any) => ({
          ...u,
          id: u.id || u.uid || u.email,
        }))
      );
    } catch (error) {
      console.error("Error al cargar usuarios admin:", error);
      toast.error("❌ No se pudieron cargar los administradores.");
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAddUser = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) return;
    if (!isSuperAdminFlag) {
      toast.error("Solo el superadmin puede crear usuarios.");
      return;
    }
    try {
      const current = auth.currentUser;
      if (!current) {
        toast.error("Usuario no autenticado.");
        return;
      }

      const token = await current.getIdToken();
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nombre: newUser.name,
          email: newUser.email.trim().toLowerCase(),
          password: newUser.password,
          rol: "admin",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Error al crear administrador");
      }

      toast.success("✅ Administrador creado.");
      setNewUser({ name: "", email: "", password: "" });
      fetchUsers();
    } catch (error: any) {
      console.error("Error al crear admin:", error);
      toast.error("❌ No se pudo crear el usuario: " + (error?.message || "error"));
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    if (!isSuperAdminFlag) {
      toast.error("Solo el superadmin puede eliminar usuarios.");
      return;
    }
    setIsDeleting(true);
    try {
      const current = auth.currentUser;
      if (!current) {
        toast.error("Usuario no autenticado.");
        setIsDeleting(false);
        return;
      }

      const token = await current.getIdToken();
      const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Error al eliminar usuario");
      }

      toast.success("✅ Usuario eliminado.");
      setShowConfirmModal(false);
      fetchUsers();
    } catch (error) {
      console.error(error);
      toast.error("❌ Error al eliminar usuario.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEdit = (user: any) => {
    setEditingUser(user);
    setEditedName(user.nombre);
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    try {
      const current = auth.currentUser;
      if (!current) {
        toast.error("Usuario no autenticado.");
        return;
      }

      const token = await current.getIdToken();
      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nombre: editedName,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Error al actualizar administrador");
      }

      setEditingUser(null);
      fetchUsers();
    } catch (error) {
      alert("❌ Error al guardar cambios.");
      console.error(error);
    }
  };

  const handleToggleActivo = async (user: any) => {
    try {
      const current = auth.currentUser;
      if (!current) {
        toast.error("Usuario no autenticado.");
        return;
      }

      const token = await current.getIdToken();
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          activo: !user.activo,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Error al cambiar estado");
      }

      fetchUsers();
    } catch (error) {
      alert("❌ Error al cambiar estado.");
      console.error(error);
    }
  };

  const handleDelete = (id: string) => {
    const userToDelete = userList.find(u => u.id === id);
    if (!userToDelete) return;
    setSelectedUser(userToDelete);
    setShowConfirmModal(true);
  };

  return (
    <div className="bg-white p-4 rounded shadow">
      <div className="text-sm mb-4">
        {isLoading ? (
          <p className="text-gray-500">Cargando usuario...</p>
        ) : user ? null : (
          <p className="text-red-600">Usuario no logueado</p>
        )}
      </div>

      <h2 className="text-xl font-bold mb-6">Administradores</h2>

      {/* Formulario de creación */}
      {isSuperAdminFlag && (
      <>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <input
            type="text"
            placeholder="Nombre"
            value={newUser.name}
            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
            className="border px-3 py-2 rounded text-sm"
          />
          <input
            type="email"
            placeholder="Correo electrónico"
            value={newUser.email}
            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            className="border px-3 py-2 rounded text-sm"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            className="border px-3 py-2 rounded text-sm"
          />
        </div>

        <button
          onClick={handleAddUser}
          className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800 transition"
        >
          Crear Administrador
        </button>
      </>
      )}

      <hr className="my-6" />
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2 text-left">Nombre</th>
            <th className="py-2 text-left">ID</th>
            <th className="py-2 text-left">Acciones</th>
            <th className="py-2 text-left">Eliminar</th>
          </tr>
        </thead>
        <tbody>
          {userList.map((admin) => (
            <tr key={admin.email} className="border-b">
              <td className="py-2 flex items-center gap-2">
                {admin.nombre}
                {admin.rol === "superadmin" && (
                  <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-1 rounded">
                    Super Admin
                  </span>
                )}
              </td>
              <td className="px-4 py-2 border">{admin.id}</td>
              <td className="py-2">
                {(isSuperAdminFlag || (admin.rol === "admin" && user?.id === admin.id)) ? (
                  <button
                    onClick={() => handleEdit(admin)}
                    className="bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600"
                  >
                    Editar
                  </button>
                ) : (
                  <span className="text-gray-400">No editable</span>
                )}
              </td>
              <td className="py-2">
                {isSuperAdminFlag && admin.rol !== "superadmin" && (
                  <button
                    onClick={() => handleDelete(admin.id)}
                    className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                  >
                    Eliminar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editingUser && (
        <div className="mt-4 border-t pt-4">
          <h3 className="text-sm font-bold mb-2">Editar Administrador</h3>
          <input
            type="text"
            className="border px-2 py-1 mr-2 rounded"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            placeholder="Nombre"
          />
          <button onClick={handleSaveEdit} className="bg-green-600 text-white px-3 py-1 rounded mr-2">Guardar</button>
          <button onClick={() => setEditingUser(null)} className="text-gray-500 underline">Cancelar</button>
        </div>
      )}

      {showConfirmModal && selectedUser && (
        <ModalConfirm
          title="¿Eliminar usuario?"
          message={`¿Estás seguro de que querés eliminar a ${selectedUser?.nombre || selectedUser?.email || "este usuario"}?`}
          onConfirm={handleDeleteUser}
          onCancel={() => setShowConfirmModal(false)}
          isLoading={isDeleting}
        />
      )}
    </div>
  );
}