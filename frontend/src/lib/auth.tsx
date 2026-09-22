"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api";
import { useI18n } from "@/i18n";
import type { Lang, User } from "./types";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  updateLocale: (l: Lang) => Promise<void>;
  refresh: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { setLang } = useI18n();
  const router = useRouter();

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    setUnauthorizedHandler(() => logout());
  }, [logout]);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { user } = await api<{ user: User }>("/auth/me");
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await api<{ token: string; user: User }>("/auth/login", { method: "POST", body: { email, password } });
      setToken(r.token);
      setUser(r.user);
      setLang(r.user.locale);
      return r.user;
    },
    [setLang],
  );

  const updateLocale = useCallback(
    async (l: Lang) => {
      setLang(l);
      if (getToken()) {
        try {
          const { user } = await api<{ user: User }>("/auth/me", { method: "PATCH", body: { locale: l } });
          setUser(user);
        } catch {
          /* ignore */
        }
      }
    },
    [setLang],
  );

  return <Ctx.Provider value={{ user, loading, login, logout, updateLocale, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
