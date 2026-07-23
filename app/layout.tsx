import type { Metadata } from "next";
import "@fontsource/anton/400.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
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
    default: "The India Project — Safe. Verified. People Powered.",
    template: "%s · The India Project",
  },
  description:
    "Clear, verified, bilingual civic information, safety guidance, source records, and visible corrections.",
  applicationName: "The India Project",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/brand/compact-logo.png", type: "image/png" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
    ],
  },
  openGraph: {
    title: "The India Project — Safe. Verified. People Powered.",
    description:
      "Make participation safer. Make information clearer. Make evidence harder to erase.",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "The India Project — Safe. Verified. People Powered.",
    description:
      "Make participation safer. Make information clearer. Make evidence harder to erase.",
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
