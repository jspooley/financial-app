import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import {
  summarizeInvoicedUnpaid,
  summarizeJobsByStatus,
  summarizeToBeInvoiced,
} from "@/lib/invoice-utils";
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
    { data: ledgerTotals },
    { data: invoiceHeaders },
  ] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase.from("appointments").select("*", { count: "exact", head: true }).eq("proposal_sent", false),
    supabase.from("appointments").select("*", { count: "exact", head: true }).eq("job_won", true),
    supabase.from("appointments").select("*", { count: "exact", head: true }).eq("job_lost", true),
    supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("proposal_sent", true)
      .eq("job_won", false)
      .eq("job_lost", false),
    supabase.from("ledger").select("*, clients(name)"),
    supabase.from("invoicing").select("client_id, po_number"),
  ]);

  const invoicedPoKeys = new Set(
    (invoiceHeaders ?? []).map(
      (invoice) =>
        `${invoice.client_id}:${(invoice.po_number ?? "").trim().toLowerCase()}`
    )
  );

  const allLedgerEntries = ((ledgerTotals ?? []) as Array<Record<string, unknown>>).map((row) =>
    normalizeLedgerRow(row)
  );

  const toBeInvoiced = summarizeToBeInvoiced(allLedgerEntries);
  const invoicedUnpaid = summarizeInvoicedUnpaid(allLedgerEntries);
  const jobSummary = summarizeJobsByStatus(allLedgerEntries, { invoicedPoKeys });

  const summaryCards: SummaryCardData[] = [
    {
      label: "Upcoming Appointments",
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
        description="Overview of expenses and receivables."
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
    </AppShell>
  );
}
