"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ApiError, getApi, type Session } from "@/lib/api";
import { readStoredSession, subscribeSession, writeStoredSession } from "@/lib/session-storage";

interface SessionContextValue {
  session: Session | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function serverSession(): Session | null {
  return null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, readStoredSession, serverSession);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const next = await getApi().login({ email, password });
      writeStoredSession(next);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("Anmeldung fehlgeschlagen.", 500);
    }
  }, []);

  const logout = useCallback(() => {
    writeStoredSession(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ session, login, logout }),
    [session, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return value;
}
