// src/components/LoginModal.tsx

import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../firebaseConfig";

interface LoginModalProps {
  onClose: () => void;
}

export default function LoginModal({ onClose }: LoginModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const firebaseUser = cred.user;

      if (!firebaseUser.email) {
        alert("Usuario sin email válido.");
        return;
      }

      // AuthContext se sincroniza por onAuthStateChanged, pero mantenemos login como refuerzo de estado local
      login({
        id: firebaseUser.uid,
        uid: firebaseUser.uid,
        name: firebaseUser.displayName || firebaseUser.email,
        email: firebaseUser.email,
        password: "",
      });

      onClose();
    } catch (error) {
      console.error("Error en login de admin:", error);
      alert("Usuario o contraseña incorrectos");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-3 text-gray-400 hover:text-black text-xl"
        >
          ×
        </button>
        <h2 className="text-xl font-bold mb-4">Iniciar sesión</h2>
        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="email"
            placeholder="Correo electrónico"
            value={email}
            required
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 px-4 py-2 rounded-md"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            required
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-300 px-4 py-2 rounded-md"
          />
          <button
            type="submit"
            className="w-full bg-black text-white py-2 rounded-md font-semibold hover:bg-gray-900"
          >
            Iniciar sesión
          </button>
        </form>
      </div>
    </div>
  );
}