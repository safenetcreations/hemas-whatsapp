import type { Metadata, Viewport } from "next";
import { Open_Sans, Raleway } from "next/font/google";
import "./globals.css";

const bodyFont = Open_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const displayFont = Raleway({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Hemas Connect — SafeNet Synthetic Demo",
    template: "%s · Hemas Connect",
  },
  description:
    "Synthetic demonstration of a governed healthcare patient-engagement workspace.",
  icons: { icon: "/favicon.svg" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#075e54",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>{children}</body>
    </html>
  );
}
