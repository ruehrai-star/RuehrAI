"use client";

import type { ReactNode } from "react";
import { AppHeader } from "./app-header";
import { SessionProvider } from "./session-provider";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <div className="app">
        <AppHeader />
        <div className="app-body">{children}</div>
      </div>
    </SessionProvider>
  );
}
