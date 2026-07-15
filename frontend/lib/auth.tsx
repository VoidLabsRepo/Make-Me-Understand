"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getToken, setToken as saveToken, clearToken, login as apiLogin, signup as apiSignup } from "@/lib/api";

interface AuthContextType {
  authenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    setAuthenticated(!!getToken());
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    saveToken(res.token);
    setAuthenticated(true);
    router.push("/");
  }, [router]);

  const signup = useCallback(async (email: string, password: string) => {
    const res = await apiSignup(email, password);
    saveToken(res.token);
    setAuthenticated(true);
    router.push("/");
  }, [router]);

  const logout = useCallback(() => {
    clearToken();
    setAuthenticated(false);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ authenticated, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
