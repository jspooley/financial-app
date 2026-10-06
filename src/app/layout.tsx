import type { Metadata } from "next";
import { Great_Vibes } from "next/font/google";
import { RecordLockProvider } from "@/components/RecordLockProvider";
import "./globals.css";

const greatVibes = Great_Vibes({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-great-vibes",
});

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
    <html lang="en" className={greatVibes.variable}>
      <body>
        <RecordLockProvider>{children}</RecordLockProvider>
      </body>
    </html>
  );
}
