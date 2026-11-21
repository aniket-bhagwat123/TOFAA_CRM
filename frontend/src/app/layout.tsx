import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = { title: "TOFAA CRM", manifest: "/manifest.webmanifest" };
export const viewport: Viewport = { themeColor: "#0F4C75" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
