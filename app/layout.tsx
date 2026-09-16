import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Garuda Access Entitlement System",
  description: "Aplikasi pengelolaan akses Lounge/Tenant, visitor, dan informasi penerbangan Garuda Indonesia.",
  icons: {
    icon: "/garuda-wing.svg",
    shortcut: "/garuda-wing.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}
