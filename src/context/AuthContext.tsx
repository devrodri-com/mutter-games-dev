// src/context/AuthContext.tsx

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { User } from "../data/types";
import { getAuth, onAuthStateChanged, getIdTokenResult } from "firebase/auth";

interface AuthContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const auth = getAuth();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        localStorage.removeItem("userEmail");
        setIsLoading(false);
        return;
      }

      try {
        const tokenResult = await getIdTokenResult(firebaseUser);
        const claims = tokenResult.claims;
        const isAdmin = claims.admin === true || claims.superadmin === true;

        if (!isAdmin) {
          setUser(null);
          localStorage.removeItem("userEmail");
          setIsLoading(false);
          return;
        }

        setUser({
          id: firebaseUser.uid,
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || firebaseUser.email || "",
          email: firebaseUser.email || "",
          password: "",
        });

        if (firebaseUser.email) {
          localStorage.setItem("userEmail", firebaseUser.email);
        }
      } catch (err) {
        console.error("Error resolving admin claims:", err);
        setUser(null);
        localStorage.removeItem("userEmail");
      } finally {
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);


  const login = (user: User) => {
    setUser({
      ...user,
      uid: user.uid || String(user.id),
    });
    localStorage.setItem("userEmail", user.email);
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("userEmail");
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}