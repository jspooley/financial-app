"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "./ui/Button";

const navItems = [
  { href: "/", label: "Maison Joy Business Overview", icon: "⌂" },
  { href: "/ledger", label: "Ledger", icon: "₿" },
  { href: "/invoicing", label: "Invoicing", icon: "📄" },
  { href: "/payments", label: "Payments", icon: "💵" },
  { href: "/clients", label: "Clients", icon: "👤" },
  { href: "/appointments", label: "Appointments", icon: "📅" },
];

const tradePartnersHref = "/trade-partners";

function navLinkClass(active: boolean) {
  return `flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
    active ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-50"
  }`;
}

function tradeAccountCountLabel(count: number | null) {
  if (count === null) return "—";
  if (count === 0) return "No trade accounts";
  return `${count} trade ${count === 1 ? "account" : "accounts"}`;
}

function TradeAccountBox({
  count,
  pathname,
}: {
  count: number | null;
  pathname: string;
}) {
  return (
    <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
      <div className="px-3 py-2">
        <p className="text-xs uppercase tracking-wide text-slate-500">Trade Accounts</p>
        <p className="mt-1 text-sm font-medium text-slate-900">
          {tradeAccountCountLabel(count)}
        </p>
      </div>
      <Link
        href={tradePartnersHref}
        className={navLinkClass(pathname === tradePartnersHref)}
      >
        <span aria-hidden>🤝</span>
        View Trade Accounts
      </Link>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [tradeAccountCount, setTradeAccountCount] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("trade_partners")
      .select("*", { count: "exact", head: true })
      .then(({ count, error }) => {
        if (!error) setTradeAccountCount(count ?? 0);
      });
  }, [pathname]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-brand-stone-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/maison-joy-logo-tagline.png"
              alt="Maison Joy"
              className="h-14 w-auto"
            />
            <div>
              <p className="text-sm font-semibold text-brand-600">Maison Joy Financial Manager</p>
              <p className="text-sm text-slate-500">Shared business ledger</p>
            </div>
          </Link>
          <Button variant="ghost" onClick={handleSignOut} className="hidden sm:inline-flex">
            Sign out
          </Button>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 pb-24 md:flex-row md:pb-6">
        <nav className="hidden w-56 shrink-0 md:block">
          <ul className="space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link href={item.href} className={navLinkClass(active)}>
                    <span aria-hidden>{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <li className="border-t border-slate-100 pt-2 sm:hidden">
              <button
                onClick={handleSignOut}
                className="flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Sign out
              </button>
            </li>
          </ul>

          <div className="mt-4">
            <TradeAccountBox count={tradeAccountCount} pathname={pathname} />
          </div>
        </nav>

        <main className="min-w-0 flex-1">
          <div className="mb-4 md:hidden">
            <TradeAccountBox count={tradeAccountCount} pathname={pathname} />
          </div>
          {children}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white md:hidden">
        <ul className="grid grid-cols-6">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                    active ? "text-brand-700" : "text-slate-500"
                  }`}
                >
                  <span className="text-base" aria-hidden>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
