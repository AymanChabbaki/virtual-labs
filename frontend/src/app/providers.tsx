"use client";
import type { ReactNode } from "react";
import { LangProvider } from "@/i18n";
import { AuthProvider } from "@/lib/auth";
import { SocketProvider } from "@/lib/socket";
import { UxProvider } from "@/components/ui";
import type { Lang } from "@/lib/types";

export function Providers({ lang, children }: { lang: Lang; children: ReactNode }) {
  return (
    <LangProvider initial={lang}>
      <UxProvider>
        <AuthProvider>
          <SocketProvider>{children}</SocketProvider>
        </AuthProvider>
      </UxProvider>
    </LangProvider>
  );
}
