import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smokehouse Admin",
  description: "Operational dashboard for Smokehouse staff."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
