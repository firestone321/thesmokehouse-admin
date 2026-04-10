import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Firestone Country Smokehouse Admin",
    template: "%s | Firestone Country Smokehouse Admin"
  },
  description: "Installable operational dashboard for Firestone Country Smokehouse staff.",
  applicationName: "Firestone Country Smokehouse Admin",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/logo-bigger.jpg", type: "image/jpeg" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    shortcut: [{ url: "/icons/logo-bigger.jpg", type: "image/jpeg" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }]
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Firestone Country Smokehouse Admin"
  },
  formatDetection: {
    telephone: false
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4eadf",
  colorScheme: "light"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegistration />
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
