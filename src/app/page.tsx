import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, currentMonthKey, getLedgerInvoicedAmount, getSalesUseTaxLineItems, groupTaxDueByMonth, isSalesUseTaxPaid, sumLedgerCreditsAndDebits } from "@/lib/utils";
import {
  summarizeInvoicedUnpaid,
  summarizeJobsByStatus,
  summarizeToBeInvoiced,
} from "@/lib/invoice-utils";
import { ledgerDetailColumns, ledgerDetailFields, mapLedgerTableRow } from "@/lib/ledger-display";
import { normalizeLedgerRow } from "@/lib/ledger-db";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { count: clientCount },
    { count: pendingAppointments },
    { count: wonAppointments },
    { count: lostAppointments },
    { data: recentLedger },
    { data: ledgerTotals },
    { data: invoiceHeaders },
  ] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("job_won", false)
      .eq("job_lost", false),
    supabase.from("appointments").select("*", { count: "exact", head: true }).eq("job_won", true),
    supabase.from("appointments").select("*", { count: "exact", head: true }).eq("job_lost", true),
    supabase
      .from("ledger")
      .select("*, clients(name)")
      .order("entry_date", { ascending: false })
      .limit(10),
    supabase.from("ledger").select("*, clients(name)"),
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
  const salesUseTaxLines = getSalesUseTaxLineItems(allLedgerEntries);

  const cards: Array<{
    label: string;
    value: string | number;
    hint?: string;
    href: string;
  }> = [
    {
      label: "Pending Appointments",
      value: pendingAppointments ?? 0,
      hint: "Neither won nor lost",
      href: "/appointments?status=pending",
    },
    {
      label: "Won",
      value: wonAppointments ?? 0,
      href: "/appointments?status=won",
    },
    {
      label: "Lost",
      value: lostAppointments ?? 0,
      href: "/appointments?status=lost",
    },
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
  ];

  return (
    <AppShell>
      <PageHeader
        title="Maison Joy Business Overview"
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

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-brand-200 sm:p-4"
          >
            <p className="text-xs text-slate-500 sm:text-sm">{card.label}</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">{card.value}</p>
            {card.hint && (
              <p className="mt-1 hidden text-xs text-slate-500 sm:block">{card.hint}</p>
            )}
          </Link>
        ))}
      </div>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">Invoicing &amp; Payments</h2>
        <p className="mt-1 text-sm text-slate-600">
          Uninvoiced ledger items ready to bill, and invoiced amounts still awaiting payment.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">To Be Invoiced</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatCurrency(toBeInvoiced.amount)}
            </p>
            {toBeInvoiced.count === 0 ? (
              <p className="mt-1 text-sm text-slate-600">
                No outstanding items to be invoiced
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm text-slate-600">
                  {toBeInvoiced.count} outstanding{" "}
                  {toBeInvoiced.count === 1 ? "item" : "items"} to be invoiced
                </p>
                <div className="mt-2 flex flex-wrap gap-3 text-sm font-medium">
                  <Link
                    href="/ledger?uninvoiced=1"
                    className="text-brand-700 hover:text-brand-800 hover:underline"
                  >
                    View in Ledger →
                  </Link>
                  <Link
                    href="/invoicing"
                    className="text-brand-700 hover:text-brand-800 hover:underline"
                  >
                    Create Invoice →
                  </Link>
                </div>
              </>
            )}
          </div>
          <Link
            href="/payments"
            className="rounded-lg border border-slate-100 bg-slate-50 p-4 transition hover:border-brand-200"
          >
            <p className="text-xs uppercase tracking-wide text-slate-500">Outstanding Payments</p>
            <p className="mt-1 text-xl font-semibold text-amber-800">
              {formatCurrency(invoicedUnpaid.amount)}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {invoicedUnpaid.count === 0
                ? "No outstanding payment balance"
                : `${invoicedUnpaid.count} ${invoicedUnpaid.count === 1 ? "item" : "items"} with balance due`}
            </p>
          </Link>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">P&amp;L Details</h2>
        <p className="mt-1 hidden text-sm text-slate-600 sm:block">
          For each invoiced line: <strong>Revenue</strong> = payments received,{" "}
          <strong>Cost of goods sold</strong> = total designer cost. <strong>Gross profit</strong> =
          revenue − cost (before expenses & loans). Uninvoiced debit costs are included in
          cost of goods sold only.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Revenue</p>
            <p className="mt-1 text-xl font-semibold text-brand-800">
              {formatCurrency(ledgerBalances.credits)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Cost of Goods Sold</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatCurrency(ledgerBalances.debits)}
            </p>
          </div>
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
            <p className="text-sm font-semibold leading-snug text-slate-700">
              GROSS PROFIT
              <br />
              <span className="text-xs font-medium text-slate-500">(before expenses &amp; loans)</span>
            </p>
            <p className="mt-2 text-2xl font-bold text-brand-800">
              {formatCurrency(netBalance)}
            </p>
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Sales and Use Tax Due by the 20th of each month
            </h2>
            <p className="text-sm text-slate-600">
              Unpaid sales and use tax from ledger entries where Sales and Use Tax Paid is unchecked.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-right sm:justify-end sm:gap-6">
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

        <div className="mt-4 space-y-3 md:hidden">
          {taxDueByMonth.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">No unpaid tax recorded yet.</p>
          ) : (
            <>
              {taxDueByMonth.map((row) => (
                <div
                  key={row.monthKey}
                  className="rounded-lg border border-slate-100 bg-slate-50 p-3"
                >
                  <p className="font-medium text-slate-900">{row.label}</p>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-slate-500">Jess</dt>
                      <dd className="font-medium">{formatCurrency(row.jess)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Molly</dt>
                      <dd className="font-medium">{formatCurrency(row.molly)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Total</dt>
                      <dd className="font-medium">{formatCurrency(row.amount)}</dd>
                    </div>
                  </dl>
                </div>
              ))}
              <div className="rounded-lg border border-slate-200 bg-white p-3 font-semibold text-slate-900">
                <p>Total unpaid tax</p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="font-normal text-slate-500">Jess</dt>
                    <dd>{formatCurrency(totalJessTaxDue)}</dd>
                  </div>
                  <div>
                    <dt className="font-normal text-slate-500">Molly</dt>
                    <dd>{formatCurrency(totalMollyTaxDue)}</dd>
                  </div>
                  <div>
                    <dt className="font-normal text-slate-500">Total</dt>
                    <dd>{formatCurrency(totalTaxDue)}</dd>
                  </div>
                </dl>
              </div>
            </>
          )}
        </div>

        <div className="mt-4 hidden overflow-x-auto md:block">
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

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-900">Tax by ledger entry</h3>
          <p className="mt-1 text-sm text-slate-600">
            Wholesale tax amounts and whether sales and use tax has been paid.
          </p>
          <div className="mt-3 space-y-3 md:hidden">
            {salesUseTaxLines.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">No tax entries yet.</p>
            ) : (
              salesUseTaxLines.slice(0, 20).map((entry) => (
                <div
                  key={entry.id ?? `${entry.entry_date}-${entry.tax_amount}`}
                  className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm"
                >
                  <p className="font-medium text-slate-900">
                    {entry.clients?.name ?? "—"} · {formatDate(entry.entry_date)}
                  </p>
                  <dl className="mt-2 grid grid-cols-3 gap-2">
                    <div>
                      <dt className="text-slate-500">Tax</dt>
                      <dd className="font-medium">{formatCurrency(Number(entry.tax_amount))}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Purchaser</dt>
                      <dd>{entry.purchaser ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Paid</dt>
                      <dd>{isSalesUseTaxPaid(entry) ? "Yes" : "No"}</dd>
                    </div>
                  </dl>
                </div>
              ))
            )}
          </div>
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-500">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Client</th>
                  <th className="py-2 pr-4 text-right">Tax</th>
                  <th className="py-2 pr-4">Purchaser</th>
                  <th className="py-2 pr-4">Paid</th>
                </tr>
              </thead>
              <tbody>
                {salesUseTaxLines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      No tax entries yet.
                    </td>
                  </tr>
                ) : (
                  salesUseTaxLines.slice(0, 20).map((entry) => (
                    <tr
                      key={entry.id ?? `${entry.entry_date}-${entry.tax_amount}`}
                      className="border-b border-slate-50"
                    >
                      <td className="py-3 pr-4 whitespace-nowrap">
                        {formatDate(entry.entry_date)}
                      </td>
                      <td className="py-3 pr-4">{entry.clients?.name ?? "—"}</td>
                      <td className="py-3 pr-4 text-right font-medium">
                        {formatCurrency(Number(entry.tax_amount))}
                      </td>
                      <td className="py-3 pr-4">{entry.purchaser ?? "—"}</td>
                      <td className="py-3 pr-4">
                        {isSalesUseTaxPaid(entry) ? "Yes" : "No"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
        <div className="mt-4 space-y-3 md:hidden">
          {(recentEntries.length === 0) ? (
            <p className="py-4 text-center text-sm text-slate-500">
              No ledger entries yet.{" "}
              <Link href="/ledger" className="text-brand-700 underline">
                Add your first entry
              </Link>
            </p>
          ) : (
            recentEntries.map((entry) => (
              <article
                key={entry.id}
                className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-500">Invoiced Amount</p>
                  <p className="font-semibold text-brand-800">
                    {formatCurrency(getLedgerInvoicedAmount(entry))}
                  </p>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {ledgerDetailFields(entry).map((field) => (
                    <div key={field.label}>
                      <dt className="text-slate-500">{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))
          )}
        </div>
        <div className="mt-4 hidden overflow-x-auto md:block">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-500">
                {ledgerDetailColumns.map((column) => (
                  <th key={column.key} className="py-2 pr-4 whitespace-nowrap">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(recentEntries.length === 0) ? (
                <tr>
                  <td
                    colSpan={ledgerDetailColumns.length}
                    className="py-6 text-center text-slate-500"
                  >
                    No ledger entries yet.{" "}
                    <Link href="/ledger" className="text-brand-700 underline">
                      Add your first entry
                    </Link>
                  </td>
                </tr>
              ) : (
                recentEntries.map((entry) => {
                  const row = mapLedgerTableRow(entry);
                  return (
                    <tr key={entry.id} className="border-b border-slate-50">
                      {ledgerDetailColumns.map((column) => (
                        <td key={column.key} className="py-3 pr-4 whitespace-nowrap">
                          {row[column.key as keyof typeof row]}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
