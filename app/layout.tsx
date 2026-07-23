import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://theindiaproject.example"),
  title: {
    default: "The India Project — Verified Student Public-Interest Record",
    template: "%s · The India Project",
  },
  description:
    "Verified, bilingual public information, safety guidance, documentation, and accountability records for student movements.",
  applicationName: "The India Project",
  manifest: "/manifest.webmanifest",
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
