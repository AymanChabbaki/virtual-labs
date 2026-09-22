import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Virtual & Remote Labs",
  description: "Plateforme de travaux pratiques virtuels et à distance — منصة الأعمال التطبيقية",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // اللغة الافتراضية: الفرنسية (LTR). العربية (RTL) تُحفظ في كوكي "lang".
  const lang = (await cookies()).get("lang")?.value === "ar" ? "ar" : "fr";
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <body>
        <Providers lang={lang}>{children}</Providers>
      </body>
    </html>
  );
}
