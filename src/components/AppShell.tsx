"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useInactivityLogout } from "@/lib/use-inactivity-logout";
import { Button } from "./ui/Button";

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
      <path
        fill="#ff69b4"
        d="M2.25 2.25a.75.75 0 0 0 0 1.5h1.386c.17 0 .318.114.362.278l2.558 9.592a3.752 3.752 0 0 0-2.806 3.63c0 .414.336.75.75.75h15.75a.75.75 0 0 0 0-1.5H5.378A2.25 2.25 0 0 1 7.5 15h11.218a.75.75 0 0 0 .674-.421 60.358 60.358 0 0 0 2.96-7.228.75.75 0 0 0-.525-.965A60.864 60.864 0 0 0 5.68 4.509l-.232-.867A1.875 1.875 0 0 0 3.636 2.25H2.25ZM3.75 20.25a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM16.5 20.25a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z"
      />
    </svg>
  );
}

const navItems: { href: string; label: string; shortLabel: string; icon: ReactNode }[] = [
  { href: "/", label: "Dashboard", shortLabel: "Dashboard", icon: "🏠" },
  { href: "/appointments", label: "Add Appointment", shortLabel: "Add Appointment", icon: "📅" },
  { href: "/budget-tool", label: "Budget Tool", shortLabel: "Budget Tool", icon: "📊" },
  { href: "/clients", label: "Client List", shortLabel: "Client List", icon: "👤" },
  {
    href: "/ledger",
    label: "Buy Goods/Svcs",
    shortLabel: "Buy Goods/Svcs",
    icon: <CartIcon />,
  },
  { href: "/invoicing", label: "Invoicing", shortLabel: "Invoicing", icon: "📄" },
  { href: "/payments", label: "Payments", shortLabel: "Payments", icon: "💵" },
];

const tradePartnersHref = "/trade-partners";
const chartOfAccountsHref = "/chart-of-accounts";

function navLinkClass(active: boolean) {
  return `flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
    active ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-50"
  }`;
}

function TradeAccountBox({ pathname }: { pathname: string }) {
  return (
    <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
      <div className="px-1.5 py-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Accounts
        </p>
      </div>
      <Link
        href={tradePartnersHref}
        className={navLinkClass(pathname === tradePartnersHref)}
        title="View Trade Accounts"
      >
        <span aria-hidden>🤝</span>
        Trade Accts
      </Link>
      <Link
        href={chartOfAccountsHref}
        className={navLinkClass(pathname === chartOfAccountsHref)}
        title="Chart of Accounts"
      >
        <span aria-hidden>📒</span>
        Chart of Accts
      </Link>
    </div>
  );
}

const cashflowHref = "/cashflow";
const salesUseTaxHref = "/sales-use-tax";
const plReportHref = "/pl-report";
const trueUpHref = "/true-up";
const scheduleCHref = "/schedule-c";
const debtTrackingHref = "/debt-tracking";
const documentationHref = "/documentation";

function ReportsBox({ pathname }: { pathname: string }) {
  return (
    <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
      <div className="px-1.5 py-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Reports
        </p>
      </div>
      <Link
        href={cashflowHref}
        className={navLinkClass(pathname === cashflowHref)}
        title="Cashflow"
      >
        <span aria-hidden>💸</span>
        Cashflow
      </Link>
      <Link
        href={debtTrackingHref}
        className={navLinkClass(pathname === debtTrackingHref)}
        title="Debt"
      >
        <span aria-hidden>👛</span>
        Debt
      </Link>
      <Link
        href={plReportHref}
        className={navLinkClass(
          pathname === plReportHref || pathname === "/reconciliation"
        )}
        title="Profit/Loss"
      >
        <span aria-hidden>📈</span>
        Profit/Loss
      </Link>
      <Link
        href={scheduleCHref}
        className={navLinkClass(pathname === scheduleCHref)}
        title="Schedule C Report"
      >
        <span aria-hidden>🗂️</span>
        Schedule C
      </Link>
      <Link
        href={salesUseTaxHref}
        className={navLinkClass(pathname === salesUseTaxHref)}
        title="Sales & Use Tax"
      >
        <span aria-hidden>🧾</span>
        Sales &amp; Use Tax
      </Link>
      <Link
        href={trueUpHref}
        className={navLinkClass(pathname === trueUpHref)}
        title="True Up Report"
      >
        <span aria-hidden>⚖️</span>
        True Up Report
      </Link>
    </div>
  );
}

function DocumentationBox({ pathname }: { pathname: string }) {
  return (
    <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
      <div className="px-1.5 py-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Docs
        </p>
      </div>
      <Link
        href={documentationHref}
        className={navLinkClass(pathname === documentationHref)}
        title="Documentation"
      >
        <span aria-hidden>📝</span>
        Documentation
      </Link>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useInactivityLogout();

  const overview = pathname === "/";

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-brand-stone-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-2 sm:px-4 sm:py-2.5">
          <Link href="/" className="flex min-w-0 items-center gap-2 sm:gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/maison-joy-logo-tagline.png"
              alt="Maison Joy"
              className="h-10 w-auto shrink-0 sm:h-14"
            />
            <div className="min-w-0">
              <p className="truncate font-script text-[1.75rem] font-semibold leading-tight text-brand-600 sm:text-[2.52rem] sm:whitespace-normal">
                Financial Manager
              </p>
            </div>
          </Link>
          <Button
            variant="ghost"
            onClick={handleSignOut}
            className="hidden shrink-0 !text-[1.26rem] sm:inline-flex"
          >
            Sign out
          </Button>
        </div>
      </header>

      <div
        className={
          overview
            ? "mx-auto grid max-w-7xl grid-cols-1 items-start gap-3 px-3 py-4 pb-28 sm:py-5 md:grid-cols-[9rem_minmax(0,1fr)] md:px-4 md:pb-6"
            : "mx-auto flex max-w-7xl flex-col gap-3 px-3 py-4 pb-28 sm:py-5 md:flex-row md:gap-3 md:pb-6 md:px-4"
        }
      >
        <nav className={`hidden w-36 shrink-0 md:block ${overview ? "md:col-start-1 md:w-full" : ""}`}>
          <ul className="space-y-0.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={navLinkClass(active)}
                    title={item.label}
                  >
                    <span aria-hidden>{item.icon}</span>
                    {item.shortLabel}
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

          <div className="mt-3">
            <ReportsBox pathname={pathname} />
          </div>
          <div className="mt-3">
            <TradeAccountBox pathname={pathname} />
          </div>
          <div id="sidebar-documentation" className="mt-3">
            <DocumentationBox pathname={pathname} />
          </div>
        </nav>

        <main className={`min-w-0 flex-1 overflow-x-hidden ${overview ? "md:col-start-2" : ""}`}>
          {children}
          <div className="mt-4 md:hidden">
            <ReportsBox pathname={pathname} />
            <div className="mt-3">
              <TradeAccountBox pathname={pathname} />
            </div>
            <div className="mt-3">
              <DocumentationBox pathname={pathname} />
            </div>
          </div>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white md:hidden">
        <ul className="grid grid-cols-4">
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
                  <span className="max-w-[3.25rem] truncate leading-tight">
                    {item.shortLabel}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
