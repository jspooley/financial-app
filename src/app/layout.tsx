import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Maison Joy Financial Manager",
  description: "Shared financial management for expenses, receivables, and invoicing",
  icons: {
    icon: "/favicon.svg",
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
