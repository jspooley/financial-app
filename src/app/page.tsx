import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, currentMonthKey, getLedgerCustomerPrice, getLedgerTotalDesignerCost, groupTaxDueByMonth, sumLedgerCreditsAndDebits } from "@/lib/utils";
import { summarizeInvoicedUnpaid, summarizeJobsByStatus, summarizeToBeInvoiced } from "@/lib/invoice-utils";
import { normalizeLedgerRow } from "@/lib/ledger-db";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { count: clientCount },
    { count: tradeCount },
    { data: recentLedger },
    { data: ledgerTotals },
    { data: invoiceHeaders },
  ] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase.from("trade_partners").select("*", { count: "exact", head: true }),
    supabase
      .from("ledger")
      .select("*, clients(name)")
      .order("entry_date", { ascending: false })
      .limit(10),
    supabase.from("ledger").select("*"),
    supabase.from("invoicing").select("client_id, po_number"),
  ]);

  const recentEntries = ((recentLedger ?? []) as Array<Record<string, unknown>>).map(
    (entry) => normalizeLedgerRow(entry)
  );

  const invoicedPoKeys = new Set(
    (invoiceHeaders ?? []).map(
      (invoice) =>
        `${invoice.client_id}:${(invoice.po_number ?? "").trim().toLowerCase()}`
    )
  );

  const allLedgerEntries = ((ledgerTotals ?? []) as Array<Record<string, unknown>>).map((row) =>
    normalizeLedgerRow(row)
  );

  const ledgerBalances = sumLedgerCreditsAndDebits(allLedgerEntries, { invoicedPoKeys });
  const netBalance = ledgerBalances.credits - ledgerBalances.debits;
  const toBeInvoiced = summarizeToBeInvoiced(allLedgerEntries);
  const invoicedUnpaid = summarizeInvoicedUnpaid(allLedgerEntries);
  const jobSummary = summarizeJobsByStatus(allLedgerEntries, { invoicedPoKeys });

  const taxDueByMonth = groupTaxDueByMonth(allLedgerEntries);
  const totalTaxDue = taxDueByMonth.reduce((sum, row) => sum + row.amount, 0);
  const totalJessTaxDue = taxDueByMonth.reduce((sum, row) => sum + row.jess, 0);
  const totalMollyTaxDue = taxDueByMonth.reduce((sum, row) => sum + row.molly, 0);
  const monthKey = currentMonthKey();
  const currentMonthTax = taxDueByMonth.find((row) => row.monthKey === monthKey);
  const currentMonthTaxDue = currentMonthTax?.amount ?? 0;
  const currentMonthJessTaxDue = currentMonthTax?.jess ?? 0;
  const currentMonthMollyTaxDue = currentMonthTax?.molly ?? 0;

  const cards: Array<{
    label: string;
    value: string | number;
    hint?: string;
    href: string;
  }> = [
    {
      label: "Open Jobs",
      value: jobSummary.openJobs,
      hint: "Client + PO with uninvoiced or unpaid debit items",
      href: "/ledger",
    },
    {
      label: "Closed Jobs",
      value: jobSummary.closedJobs,
      hint: "All debit items invoiced and paid",
      href: "/ledger",
    },
    { label: "Trade Partners", value: tradeCount ?? 0, href: "/trade-partners" },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Dashboard"
        description="Overview of expenses, receivables, tax due, and recent activity."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/clients?add=1"
              className="inline-flex min-h-11 items-center rounded-lg border border-brand-600 bg-white px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
            >
              Add Client
            </Link>
            <Link
              href="/ledger?add=1"
              className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              New Ledger Entry
            </Link>
          </div>
        }
      />

      {(clientCount ?? 0) === 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Get started by adding a client.</p>
          <p className="mt-1">
            Tap <strong>Clients</strong> in the bottom menu (phone) or sidebar (desktop), then
            click <strong>Add Client</strong>.
          </p>
          <Link
            href="/clients?add=1"
            className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Add Your First Client
          </Link>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-200"
          >
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{card.value}</p>
            {card.hint && <p className="mt-1 text-xs text-slate-500">{card.hint}</p>}
          </Link>
        ))}
      </div>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">Invoicing &amp; Payments</h2>
        <p className="mt-1 text-sm text-slate-600">
          Uninvoiced ledger items ready to bill, and invoiced amounts still awaiting payment.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Link
            href="/invoicing"
            className="rounded-lg border border-slate-100 bg-slate-50 p-4 transition hover:border-brand-200"
          >
            <p className="text-xs uppercase tracking-wide text-slate-500">To Be Invoiced</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatCurrency(toBeInvoiced.amount)}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {toBeInvoiced.count} {toBeInvoiced.count === 1 ? "item" : "items"}
            </p>
          </Link>
          <Link
            href="/payments"
            className="rounded-lg border border-slate-100 bg-slate-50 p-4 transition hover:border-brand-200"
          >
            <p className="text-xs uppercase tracking-wide text-slate-500">Invoiced, Not Paid</p>
            <p className="mt-1 text-xl font-semibold text-amber-800">
              {formatCurrency(invoicedUnpaid.amount)}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Customer price on unpaid invoiced debits
            </p>
          </Link>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">Ledger Balance</h2>
        <p className="mt-1 text-sm text-slate-600">
          For each invoiced line: <strong>Credits</strong> = customer price (invoice amount),{" "}
          <strong>Debits</strong> = total designer cost. <strong>Net</strong> = invoice − cost
          (your margin). Uninvoiced debit costs are included in Debits only.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Credits (Invoiced)</p>
            <p className="mt-1 text-xl font-semibold text-brand-800">
              {formatCurrency(ledgerBalances.credits)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Debits (Designer Cost)</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatCurrency(ledgerBalances.debits)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Net Profit</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatCurrency(netBalance)}
            </p>
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Tax Due by Month</h2>
            <p className="text-sm text-slate-600">
              Unpaid sales and use tax from ledger entries where Sales and Use Tax Paid is unchecked.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-4 text-right sm:gap-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Jess (this month)</p>
              <p className="text-xl font-semibold text-brand-800">
                {formatCurrency(currentMonthJessTaxDue)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Molly (this month)</p>
              <p className="text-xl font-semibold text-brand-800">
                {formatCurrency(currentMonthMollyTaxDue)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Total (this month)</p>
              <p className="text-xl font-semibold text-slate-900">
                {formatCurrency(currentMonthTaxDue)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-500">
                <th className="py-2 pr-4">Month</th>
                <th className="py-2 pr-4 text-right">Jess</th>
                <th className="py-2 pr-4 text-right">Molly</th>
                <th className="py-2 pr-4 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {taxDueByMonth.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">
                    No unpaid tax recorded yet.
                  </td>
                </tr>
              ) : (
                taxDueByMonth.map((row) => (
                  <tr key={row.monthKey} className="border-b border-slate-50">
                    <td className="py-3 pr-4">{row.label}</td>
                    <td className="py-3 pr-4 text-right font-medium">
                      {formatCurrency(row.jess)}
                    </td>
                    <td className="py-3 pr-4 text-right font-medium">
                      {formatCurrency(row.molly)}
                    </td>
                    <td className="py-3 pr-4 text-right font-medium">
                      {formatCurrency(row.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {taxDueByMonth.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold text-slate-900">
                  <td className="py-3 pr-4">Total unpaid tax</td>
                  <td className="py-3 pr-4 text-right">{formatCurrency(totalJessTaxDue)}</td>
                  <td className="py-3 pr-4 text-right">{formatCurrency(totalMollyTaxDue)}</td>
                  <td className="py-3 pr-4 text-right">{formatCurrency(totalTaxDue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Recent Ledger Entries</h2>
            <p className="text-sm text-slate-600">
              Latest 10 entries. Full debit and credit tables are on the Ledger page.
            </p>
          </div>
          <Link
            href="/ledger"
            className="text-sm font-medium text-brand-700 hover:text-brand-800 hover:underline"
          >
            Open full Ledger →
          </Link>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-500">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Client</th>
                <th className="py-2 pr-4">Debit/Credit</th>
                <th className="py-2 pr-4">Description</th>
                <th className="py-2 pr-4">PO</th>
                <th className="py-2 pr-4">Total Designer Cost</th>
                <th className="py-2 pr-4">Customer Price</th>
                <th className="py-2 pr-4">Invoiced</th>
                <th className="py-2 pr-4">Invoice ID</th>
                <th className="py-2 pr-4">Paid</th>
              </tr>
            </thead>
            <tbody>
              {(recentEntries.length === 0) ? (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-slate-500">
                    No ledger entries yet.{" "}
                    <Link href="/ledger" className="text-brand-700 underline">
                      Add your first entry
                    </Link>
                  </td>
                </tr>
              ) : (
                recentEntries.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-50">
                    <td className="py-3 pr-4 whitespace-nowrap">{formatDate(entry.entry_date)}</td>
                    <td className="py-3 pr-4">{entry.clients?.name ?? "—"}</td>
                    <td className="py-3 pr-4 capitalize">{entry.credit_debit}</td>
                    <td className="py-3 pr-4 max-w-48 truncate">
                      {entry.description?.trim() || "—"}
                    </td>
                    <td className="py-3 pr-4">{entry.po_number ?? "—"}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      {formatCurrency(getLedgerTotalDesignerCost(entry))}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      {formatCurrency(getLedgerCustomerPrice(entry))}
                    </td>
                    <td className="py-3 pr-4">{entry.invoiced ? "Yes" : "No"}</td>
                    <td className="py-3 pr-4">{entry.invoice_id ?? "—"}</td>
                    <td className="py-3 pr-4">
                      {entry.credit_debit === "debit" ? (entry.paid ? "Yes" : "No") : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
