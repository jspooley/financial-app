import type { Metadata } from "next";
import { Dancing_Script } from "next/font/google";
import { RecordLockProvider } from "@/components/RecordLockProvider";
import "./globals.css";

const dancingScript = Dancing_Script({
  weight: "600",
  subsets: ["latin"],
  variable: "--font-dancing-script",
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
    <html lang="en" className={dancingScript.variable}>
      <body>
        <RecordLockProvider>{children}</RecordLockProvider>
      </body>
    </html>
  );
}
