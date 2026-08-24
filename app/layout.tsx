import type { Metadata } from "next";
import { Big_Shoulders, IBM_Plex_Mono, Literata } from "next/font/google";
import "./globals.css";

const display = Big_Shoulders({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  adjustFontFallback: false,
});

const body = Literata({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Seedance / Wan · Telecine",
  description: "Generate videos with Doubao Seedance 2.5 on Volcano Engine Ark and Wan 3.0 on Alibaba Model Studio.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
