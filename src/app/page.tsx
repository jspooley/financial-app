import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { OverviewTodoList } from "@/components/overview/OverviewTodoList";
import { AppointmentFunnel } from "@/components/overview/AppointmentFunnel";
import { SalesComparisonChart } from "@/components/overview/SalesComparisonChart";
import {
  buildOverviewAutoTodos,
  buildProposalFollowUpTodos,
  buildSendBudgetTodos,
  buildSendProposalTodos,
} from "@/lib/overview-todos";
import { buildOverviewChartSeries, countAppointmentsByMonth } from "@/lib/overview-chart";
import { formatCurrency } from "@/lib/utils";
import {
  summarizeInvoicedUnpaid,
  summarizeJobsByStatus,
  summarizeToBeInvoiced,
} from "@/lib/invoice-utils";
import { normalizeLedgerRow } from "@/lib/ledger-db";
import {
  isPaymentCompanionRow,
  mergePaymentCompanionsOntoEntries,
} from "@/lib/payment-companions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { count: clientCount },
    { count: totalAppointments, error: upcomingAppointmentsError },
    { count: budgetPhaseAppointments, error: budgetPhaseError },
    { count: wonAppointments },
    { count: lostAppointments },
    { count: proposalSentAppointments },
    { count: onHoldAppointments, error: onHoldError },
    { data: ledgerTotals },
    { data: invoiceHeaders },
    { data: appointmentDates },
    { data: proposalAppointments, error: proposalAppointmentsError },
    { data: sendProposalAppointments, error: sendProposalAppointmentsError },
    { data: sendBudgetAppointments, error: sendBudgetAppointmentsError },
  ] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("proposal_sent", false)
      .eq("send_budget", false)
      .eq("job_won", false)
      .eq("job_lost", false),
    supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("send_budget", true)
      .eq("proposal_sent", false)
      .eq("job_won", false)
      .eq("job_lost", false),
    supabase.from("appointments").select("*", { count: "exact", head: true }).eq("job_won", true),
    supabase.from("appointments").select("*", { count: "exact", head: true }).eq("job_lost", true),
    supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("proposal_sent", true)
      .eq("job_won", false)
      .eq("job_lost", false),
    supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("on_hold", true)
      .eq("job_won", false)
      .eq("job_lost", false),
    supabase.from("ledger").select("*, clients(name)"),
    supabase.from("invoicing").select("client_id, po_number"),
    supabase.from("appointments").select("appointment_date"),
    supabase
      .from("appointments")
      .select(
        "id, client_name, proposal_sent, job_won, job_lost, proposal_sent_date, updated_at"
      )
      .eq("proposal_sent", true)
      .eq("job_won", false)
      .eq("job_lost", false),
    supabase
      .from("appointments")
      .select(
        "id, client_name, appointment_date, send_proposal, proposal_sent, job_won, job_lost"
      )
      .eq("send_proposal", true)
      .eq("proposal_sent", false)
      .eq("job_won", false)
      .eq("job_lost", false),
    supabase
      .from("appointments")
      .select("id, client_name, appointment_date, send_budget, job_won, job_lost")
      .eq("send_budget", true)
      .eq("job_won", false)
      .eq("job_lost", false),
  ]);

  let upcomingCount = totalAppointments ?? 0;
  let budgetPhaseCount = budgetPhaseAppointments ?? 0;
  const proposalPhaseCount = proposalSentAppointments ?? 0;
  const onHoldCount = onHoldError ? 0 : (onHoldAppointments ?? 0);
  if (!onHoldError) upcomingCount = Math.max(0, upcomingCount - onHoldCount);
  if (
    (upcomingAppointmentsError && /send_budget/i.test(upcomingAppointmentsError.message)) ||
    (budgetPhaseError && /send_budget/i.test(budgetPhaseError.message))
  ) {
    const fallback = await supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .eq("proposal_sent", false)
      .eq("job_won", false)
      .eq("job_lost", false);
    upcomingCount = fallback.count ?? 0;
    budgetPhaseCount = 0;
  }

  let openProposals = proposalAppointments ?? [];
  if (
    proposalAppointmentsError &&
    /proposal_sent_date/i.test(proposalAppointmentsError.message)
  ) {
    const fallback = await supabase
      .from("appointments")
      .select("id, client_name, proposal_sent, job_won, job_lost, updated_at")
      .eq("proposal_sent", true)
      .eq("job_won", false)
      .eq("job_lost", false);
    openProposals = (fallback.data ?? []).map((row) => ({
      ...row,
      proposal_sent_date: null,
    }));
  }

  const invoicedPoKeys = new Set(
    (invoiceHeaders ?? []).map(
      (invoice) =>
        `${invoice.client_id}:${(invoice.po_number ?? "").trim().toLowerCase()}`
    )
  );

  const ledgerRows = ((ledgerTotals ?? []) as Array<Record<string, unknown>>).map((row) =>
    normalizeLedgerRow(row)
  );

  // Payments live on companion rows, so overlay them before any paid/unpaid math.
  const allLedgerEntries = mergePaymentCompanionsOntoEntries(
    ledgerRows.filter((entry) => !entry.source_ledger_id),
    ledgerRows.filter((entry) => isPaymentCompanionRow(entry))
  );

  const toBeInvoiced = summarizeToBeInvoiced(allLedgerEntries);
  const invoicedUnpaid = summarizeInvoicedUnpaid(allLedgerEntries);
  const jobSummary = summarizeJobsByStatus(allLedgerEntries, { invoicedPoKeys });
  const chartYear = new Date().getFullYear();
  const chartThroughMonth = new Date().getMonth() + 1;
  const appointmentCounts = countAppointmentsByMonth(
    appointmentDates ?? [],
    chartYear,
    chartThroughMonth
  );
  const chartSeries = buildOverviewChartSeries(
    mergePaymentCompanionsOntoEntries(
      ledgerRows,
      ledgerRows.filter((entry) => isPaymentCompanionRow(entry))
    ),
    {
      year: chartYear,
      throughMonth: chartThroughMonth,
      invoicedPoKeys,
    }
  );

  const funnelStages = [
    {
      label: "Upcoming Appointments",
      value: upcomingCount,
      href: "/appointments",
    },
    {
      label: "Budget Phase",
      value: budgetPhaseCount,
      href: "/appointments?status=budget",
    },
    {
      label: "Proposal Phase",
      value: proposalPhaseCount,
      href: "/appointments?status=proposal_sent",
    },
    {
      label: "On Hold",
      value: onHoldCount,
      href: "/appointments?status=on_hold",
    },
    {
      label: "Won",
      value: wonAppointments ?? 0,
      href: "/appointments?status=won",
    },
    {
      label: "Open Jobs",
      value: jobSummary.openJobs,
      hint: "Unpaid invoices or unbilled work",
      href: "/ledger?jobs=open",
    },
    {
      label: "Closed Jobs",
      value: jobSummary.closedJobs,
      hint: "Invoices paid in full",
      href: "/ledger?jobs=closed",
    },
    {
      label: "Lost",
      value: lostAppointments ?? 0,
      href: "/appointments?status=lost",
    },
  ];

  return (
    <AppShell>
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

      <SalesComparisonChart
        year={chartYear}
        series={chartSeries}
        appointments={appointmentCounts}
        aside={<AppointmentFunnel stages={funnelStages} />}
      />

      <div className="mb-6 grid items-stretch gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
      <section className="flex h-full min-h-0 min-w-0 max-h-[var(--paired-box-height,none)] flex-col overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">Invoicing &amp; Payments</h2>
        <div className="mt-4 grid gap-4">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">To Be Invoiced</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatCurrency(toBeInvoiced.amount)}
            </p>
            {toBeInvoiced.count !== 0 ? (
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
            ) : null}
          </div>
          <Link
            href="/payments"
            className="rounded-lg border border-slate-100 bg-slate-50 p-4 transition hover:border-brand-200"
          >
            <p className="text-xs uppercase tracking-wide text-slate-500">Outstanding Payments</p>
            <p className="mt-1 text-xl font-semibold text-amber-800">
              {formatCurrency(invoicedUnpaid.amount)}
            </p>
          </Link>
        </div>
      </section>
      <OverviewTodoList
        autoTodos={[
          ...buildOverviewAutoTodos(allLedgerEntries),
          ...buildProposalFollowUpTodos(openProposals),
          ...buildSendProposalTodos(
            sendProposalAppointmentsError ? [] : (sendProposalAppointments ?? [])
          ),
          ...buildSendBudgetTodos(
            sendBudgetAppointmentsError ? [] : (sendBudgetAppointments ?? [])
          ),
        ]}
      />
      </div>
    </AppShell>
  );
}
