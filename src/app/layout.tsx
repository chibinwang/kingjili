import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Noto_Sans_TC } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const noto = Noto_Sans_TC({ weight: ["400", "500", "600", "700"], variable: "--font-noto", display: "swap", preload: false });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face", display: "swap" });

export const metadata: Metadata = {
  title: "金吉利營運中心 · Everyse",
  description: "金吉利食品 AI-native 批發營運系統（示範）",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-TW">
      <body className={`${inter.variable} ${noto.variable} ${mono.variable}`}>
        {children}
        <Toaster position="top-center" offset={68} toastOptions={{ style: { fontFamily: "var(--font-sans)", fontSize: 13, borderRadius: 12 } }} />
      </body>
    </html>
  );
}
