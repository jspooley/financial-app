import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, currentMonthKey, getLedgerInvoicedAmount, groupTaxDueByMonth, groupTaxPaidByMonth, roundMoney, sumLedgerCreditsAndDebits } from "@/lib/utils";
import {
  summarizeInvoicedUnpaid,
  summarizeJobsByStatus,
  summarizeToBeInvoiced,
} from "@/lib/invoice-utils";
import { ledgerDetailColumns, ledgerDetailFields, mapLedgerTableRow } from "@/lib/ledger-display";
import { normalizeLedgerRow } from "@/lib/ledger-db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SummaryCardData = {
  label: string;
  value: string | number;
  hint?: string;
  href: string;
};

function SummaryCard({ card }: { card: SummaryCardData }) {
  return (
    <Link
      href={card.href}
      className="flex h-full min-h-[6.5rem] flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-brand-200 sm:min-h-[7.25rem] sm:p-4"
    >
      <p className="text-xs text-slate-500 sm:text-sm">{card.label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">{card.value}</p>
      <p className="mt-auto hidden min-h-[2.5rem] pt-1 text-xs leading-snug text-slate-500 sm:block">
        {card.hint ?? ""}
      </p>
    </Link>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { count: clientCount },
    { count: totalAppointments },
    { count: wonAppointments },
    { count: lostAppointments },
    { count: proposalSentAppointments },
    { data: recentLedger },
    { data: ledgerTotals },
    { data: invoiceHeaders },
  ] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase.from("appointments").select("*", { count: "exact", head: true }),
    supabase.from("appointments").select("*", { count: "exact", head: true }).eq("job_won", true),
    supabase.from("appointments").select("*", { count: "exact", head: true }).eq("job_lost", true),
    supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("proposal_sent", true),
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
  const totalWriteOffAmount = roundMoney(
    allLedgerEntries.reduce((sum, entry) => sum + Number(entry.write_off_amount ?? 0), 0)
  );
  const writeOffCount = allLedgerEntries.filter(
    (entry) => Number(entry.write_off_amount ?? 0) > 0
  ).length;

  const taxDueByMonth = groupTaxDueByMonth(allLedgerEntries);
  const monthKey = currentMonthKey();
  const currentMonthTax = taxDueByMonth.find((row) => row.monthKey === monthKey);
  const currentMonthTaxDue = currentMonthTax?.amount ?? 0;
  const currentMonthJessTaxDue = currentMonthTax?.jess ?? 0;
  const currentMonthMollyTaxDue = currentMonthTax?.molly ?? 0;
  const taxPaidByMonth = groupTaxPaidByMonth(allLedgerEntries);

  const summaryCards: SummaryCardData[] = [
    {
      label: "Appointments",
      value: totalAppointments ?? 0,
      href: "/appointments",
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
      label: "Proposal Sent",
      value: proposalSentAppointments ?? 0,
      href: "/appointments?status=proposal_sent",
    },
    {
      label: "Open Jobs",
      value: jobSummary.openJobs,
      hint: "Ongoing jobs or unpaid invoices",
      href: "/ledger",
    },
    {
      label: "Closed Jobs",
      value: jobSummary.closedJobs,
      hint: "All invoices paid",
      href: "/ledger",
    },
  ];

  const [
    pendingCard,
    wonCard,
    lostCard,
    proposalSentCard,
    openJobsCard,
    closedJobsCard,
  ] = summaryCards;

  return (
    <AppShell>
      <PageHeader
        title="Maison Joy Business Overview"
        description="Overview of expenses, receivables, tax due, and recent activity."
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

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 lg:grid-flow-col lg:grid-rows-2">
        <SummaryCard card={pendingCard} />
        <SummaryCard card={proposalSentCard} />
        <SummaryCard card={wonCard} />
        <SummaryCard card={lostCard} />
        <SummaryCard card={openJobsCard} />
        <SummaryCard card={closedJobsCard} />
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
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
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
          <Link
            href="/payments"
            className="rounded-lg border border-slate-100 bg-slate-50 p-4 transition hover:border-brand-200"
          >
            <p className="text-xs uppercase tracking-wide text-slate-500">Write Off Amount</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatCurrency(totalWriteOffAmount)}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {writeOffCount === 0
                ? "No write-offs recorded"
                : `Total across ${writeOffCount} ledger ${writeOffCount === 1 ? "entry" : "entries"}`}
            </p>
          </Link>
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
              Unpaid sales and use tax from ledger entries where Sales and Use Tax Paid is unchecked.{" "}
              <Link href="/sales-use-tax" className="font-medium text-brand-700 hover:underline">
                Record tax payments →
              </Link>
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

        {(taxDueByMonth.length > 0 || taxPaidByMonth.length > 0) && (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {taxDueByMonth.length > 0 && (
              <Link href="/sales-use-tax" className="font-medium text-brand-700 hover:underline">
                View unpaid tax details →
              </Link>
            )}
            {taxPaidByMonth.length > 0 && (
              <Link
                href="/sales-use-tax?view=paid"
                className="font-medium text-brand-700 hover:underline"
              >
                View paid tax history →
              </Link>
            )}
          </div>
        )}
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
