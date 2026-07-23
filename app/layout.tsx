import type { Metadata } from "next";
import "./globals.css";

function getSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const vercelUrl =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  const value =
    configuredUrl ?? (vercelUrl ? `https://${vercelUrl}` : "http://localhost:3000");

  return new URL(value);
}

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: "The India Project — Verified Student Public-Interest Record",
    template: "%s · The India Project",
  },
  description:
    "Verified, bilingual public information, safety guidance, documentation, and accountability records for student movements.",
  applicationName: "The India Project",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/brand-mark.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
    ],
  },
  openGraph: {
    title: "The India Project — Verified Student Public-Interest Record",
    description:
      "Quiet, sourced, bilingual public information with offline access and visible corrections.",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "The India Project — Verified Student Public-Interest Record",
    description:
      "Quiet, sourced, bilingual public information with offline access and visible corrections.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
