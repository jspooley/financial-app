"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/client";
import { normalizeLedgerRow, syncAllLedgerPaidFlags, type LedgerDbRow } from "@/lib/ledger-db";
import { buildReconciliationReport } from "@/lib/reconciliation";
import type { Client, Invoice, LedgerEntry } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils";

function PaidBadge({ paid, label }: { paid: boolean; label: string }) {
  return (
    <span
      className={
        paid
          ? "inline-flex rounded-full bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-800"
          : "inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
      }
    >
      {label}
    </span>
  );
}

function GapRow({
  label,
  amount,
  hint,
}: {
  label: string;
  amount: number;
  hint: string;
}) {
  const isZero = Math.abs(amount) < 0.005;
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold ${
          isZero ? "text-slate-900" : "text-amber-800"
        }`}
      >
        {formatCurrency(amount)}
      </p>
      <p className="mt-1 text-sm text-slate-600">{hint}</p>
    </div>
  );
}

export default function ReconciliationPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [showAcceptedUnderpayments, setShowAcceptedUnderpayments] = useState(false);
  const [showPaymentsVsRevenue, setShowPaymentsVsRevenue] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [{ data: invoiceData }, { data: clientData }, { data: ledgerData }] =
      await Promise.all([
        supabase
          .from("invoicing")
          .select("*, clients(name)")
          .order("created_at", { ascending: false }),
        supabase.from("clients").select("*").order("name", { ascending: true }),
        supabase.from("ledger").select("*, clients(name)"),
      ]);
    setInvoices((invoiceData ?? []) as Invoice[]);
    setClients(clientData ?? []);
    setLedgerEntries(
      (ledgerData ?? []).map((row) =>
        normalizeLedgerRow(row as LedgerDbRow & Record<string, unknown>)
      )
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        loadData();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [loadData]);

  useEffect(() => {
    if (!showAcceptedUnderpayments) return;
    document
      .getElementById("accepted-underpayment-variances")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showAcceptedUnderpayments]);

  useEffect(() => {
    if (!showPaymentsVsRevenue) return;
    document
      .getElementById("payments-vs-revenue-gap")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showPaymentsVsRevenue]);

  function toggleAcceptedUnderpayments() {
    setShowAcceptedUnderpayments((open) => !open);
  }

  function togglePaymentsVsRevenue() {
    setShowPaymentsVsRevenue((open) => !open);
  }

  async function handleSyncPaidFlags() {
    setSyncing(true);
    setSyncMessage(null);
    const supabase = createClient();
    const { updated, error } = await syncAllLedgerPaidFlags(supabase);
    setSyncing(false);
    if (error) {
      setSyncMessage(`Sync failed: ${error}`);
      return;
    }
    setSyncMessage(
      updated === 0
        ? "All paid flags already match balance."
        : `Updated paid flag on ${updated} line${updated === 1 ? "" : "s"}.`
    );
    await loadData();
  }

  const clientNames = useMemo(
    () => new Map(clients.map((client) => [client.id, client.name])),
    [clients]
  );

  const report = useMemo(
    () => buildReconciliationReport(invoices, ledgerEntries, clientNames),
    [invoices, ledgerEntries, clientNames]
  );

  const problemLineRows = report.problemLines.map((line) => ({
    entryDate: formatDate(line.entryDate),
    invoiceId: line.invoiceId,
    clientName: line.clientName,
    description: (
      <span className="max-w-xs truncate block" title={line.description}>
        {line.description}
      </span>
    ),
    invoiced: formatCurrency(line.invoicedAmount),
    cashReceived: formatCurrency(line.paymentReceived),
    paymentsReceived: (
      <span
        className={
          line.invoicedMinusPaymentsReceived >= 0.005 ? "font-medium text-amber-800" : ""
        }
      >
        {formatCurrency(line.paymentsReceivedSettled)}
      </span>
    ),
    revenue: formatCurrency(line.paymentAmount),
    paymentFee: (
      <span className={line.paymentFee > 0 ? "font-medium text-amber-800" : ""}>
        {formatCurrency(line.paymentFee)}
      </span>
    ),
    invoicedMinusPayments: (
      <span
        className={
          line.invoicedMinusPaymentsReceived >= 0.005 ? "font-medium text-amber-800" : ""
        }
      >
        {formatCurrency(line.invoicedMinusPaymentsReceived)}
      </span>
    ),
    outstandingRevenue: (
      <span
        className={
          line.outstandingRevenueAmount >= 0.005 ? "font-medium text-amber-800" : ""
        }
      >
        {formatCurrency(line.outstandingRevenueAmount)}
      </span>
    ),
    discrepancy: (
      <span
        className={
          Math.abs(line.lineDiscrepancyAmount) >= 0.005
            ? "font-medium text-amber-800"
            : ""
        }
      >
        {formatCurrency(line.lineDiscrepancyAmount)}
      </span>
    ),
    outstanding: (
      <span className={line.outstandingAmount > 0 ? "font-medium text-amber-800" : ""}>
        {formatCurrency(line.outstandingAmount)}
      </span>
    ),
    paidFlag: <PaidBadge paid={line.paidFlag} label={line.paidFlag ? "Yes" : "No"} />,
    paidByBalance: (
      <PaidBadge paid={line.paidByBalance} label={line.paidByBalance ? "Yes" : "No"} />
    ),
  }));

  const problemLineFooter = useMemo(() => {
    const { summary, attentionLineTotals } = report;
    const discrepancyHighlight =
      Math.abs(attentionLineTotals.lineDiscrepancyAmount) >= 0.005
        ? "text-amber-800"
        : "";
    return {
      entryDate: "",
      invoiceId: "",
      clientName: "",
      description: (
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Total (lines shown)
        </span>
      ),
      invoiced: formatCurrency(attentionLineTotals.invoicedAmount),
      paymentsReceived: formatCurrency(attentionLineTotals.paymentsReceivedSettled),
      revenue: formatCurrency(attentionLineTotals.paymentAmount),
      paymentFee: formatCurrency(attentionLineTotals.paymentFee),
      invoicedMinusPayments: (
        <span className="text-amber-800">
          {formatCurrency(attentionLineTotals.invoicedMinusPaymentsReceived)}
        </span>
      ),
      outstandingRevenue: (
        <span className="text-amber-800">
          {formatCurrency(attentionLineTotals.outstandingRevenueAmount)}
        </span>
      ),
      discrepancy: (
        <span className={discrepancyHighlight}>
          {formatCurrency(attentionLineTotals.lineDiscrepancyAmount)}
        </span>
      ),
      cashReceived: "",
      paidFlag: "",
      paidByBalance: "",
      outstanding: (
        <span className="text-amber-800">
          {formatCurrency(attentionLineTotals.outstandingAmount)}
        </span>
      ),
    };
  }, [report]);

  return (
    <AppShell>
      <PageHeader
        title="Reconciliation Report"
        description="Compare total amount invoiced, payments, and revenue totals and find mismatches."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => loadData()}
              disabled={loading || syncing}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleSyncPaidFlags}
              disabled={loading || syncing}
            >
              {syncing ? "Syncing…" : "Sync paid flags from balance"}
            </Button>
          </div>
        }
      />

      {syncMessage && (
        <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {syncMessage}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-600">Loading…</p>
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">Summary Totals</h2>
            <p className="mt-1 text-sm text-slate-600">
              Outstanding Payments uses collection balance (including expense and accepted
              underpayment variance). Outstanding Revenue is invoiced amount not yet in payment_amount
              after expense and accepted underpayment variance.
            </p>
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Total Amount Invoiced
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {formatCurrency(report.summary.invoiceHistoryTotal)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Sum of invoiced amounts on all invoices (balance-sheet lines excluded)
                  </p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Accepted Underpayment Variances
                  </p>
                  <p className="mt-1 text-xl font-semibold text-amber-800">
                    {formatCurrency(report.summary.acceptedUnderpaymentVarianceTotal)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {report.acceptedVarianceLines.length === 0
                      ? "No accepted underpayment variances"
                      : `${report.acceptedVarianceLines.length} accepted underpayment ${
                          report.acceptedVarianceLines.length === 1 ? "line" : "lines"
                        } (written off from collection)`}
                  </p>
                  {report.acceptedVarianceLines.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleAcceptedUnderpayments}
                      className="mt-2 inline-block text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline"
                    >
                      {showAcceptedUnderpayments
                        ? "Hide accepted underpayment variances ↑"
                        : "View accepted underpayment variances →"}
                    </button>
                  )}
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Payments Received
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {formatCurrency(report.summary.paymentsHistoryTotal)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Current-year revenue minus accepted underpayment variances
                    {report.summary.acceptedUnderpaymentVarianceTotal >= 0.005 && (
                      <>
                        {" "}
                        (−{formatCurrency(report.summary.acceptedUnderpaymentVarianceTotal)})
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <GapRow
                  label="Outstanding Revenue"
                  amount={report.summary.invoiceMinusRevenue}
                  hint="Expected client revenue not yet in payment_amount (excludes payment fees, expenses, and accepted underpayment variances)"
                />
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Outstanding Payments
                  </p>
                  <p className="mt-1 text-xl font-semibold text-amber-800">
                    {formatCurrency(report.summary.outstandingTotal)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Total Amount Invoiced minus Payments Received — invoiced amount not yet
                    collected
                    {report.outstandingCount > 0 && (
                      <>
                        {" "}
                        ({report.outstandingCount} line
                        {report.outstandingCount === 1 ? "" : "s"} with balance due)
                      </>
                    )}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Revenue
                  </p>
                  <p className="mt-1 text-xl font-semibold text-brand-800">
                    {formatCurrency(report.summary.revenueTotal)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Same as P&amp;L: sum of <code className="text-xs">payment_amount</code> on
                    invoiced lines for the current year (balance-sheet lines excluded). Does not
                    deduct accepted underpayments.
                  </p>
                  {Math.abs(report.summary.revenueMinusPaymentsReceived) >= 0.005 && (
                    <>
                      <p className="mt-1 text-sm text-amber-800">
                        {formatCurrency(Math.abs(report.summary.revenueMinusPaymentsReceived))}{" "}
                        differs from settled collection on some lines
                      </p>
                      <button
                        type="button"
                        onClick={togglePaymentsVsRevenue}
                        className="mt-2 inline-block text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline"
                      >
                        {showPaymentsVsRevenue
                          ? "Hide ledger lines causing this difference ↑"
                          : "View ledger lines causing this difference →"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Expenses</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {formatCurrency(report.summary.totalExpense)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">Total expense amount on ledger</p>
                </div>
                <GapRow
                  label="Discrepancy Amount"
                  amount={report.summary.revenueMinusPayments}
                  hint="Payment_amount below expected revenue for the settled line. Payment fees, accepted underpayment variances, expenses, and overpayments are not counted here."
                />
              </div>
            </div>
          </section>

          {showAcceptedUnderpayments && report.acceptedVarianceLines.length > 0 && (
            <section
              id="accepted-underpayment-variances"
              className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Accepted Underpayment Variances
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Lines where a short payment was accepted. These amounts are excluded from
                    outstanding revenue and discrepancy; they still reduce net profit on the
                    P&amp;L.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowAcceptedUnderpayments(false)}
                >
                  Close
                </Button>
              </div>
              <div className="mt-4">
                <DataTable
                  columns={[
                    { key: "entryDate", label: "Date" },
                    { key: "invoiceId", label: "Invoice" },
                    { key: "clientName", label: "Client" },
                    { key: "description", label: "Description" },
                    { key: "poNumber", label: "PO" },
                    { key: "invoiced", label: "Invoiced" },
                    { key: "paymentAmount", label: "Payment Amount" },
                    { key: "variance", label: "Underpayment" },
                    { key: "notes", label: "Notes" },
                  ]}
                  rows={report.acceptedVarianceLines.map((line) => ({
                    entryDate: formatDate(line.entryDate),
                    invoiceId: line.invoiceId,
                    clientName: line.clientName,
                    description: (
                      <span className="max-w-xs truncate block" title={line.description}>
                        {line.description}
                      </span>
                    ),
                    poNumber: line.poNumber,
                    invoiced: formatCurrency(line.invoicedAmount),
                    paymentAmount: formatCurrency(line.paymentAmount),
                    variance: (
                      <span className="font-medium text-amber-800">
                        {formatCurrency(line.varianceAmount)}
                      </span>
                    ),
                    notes: line.varianceNotes.trim() || "—",
                  }))}
                  emptyMessage="No accepted underpayment variances."
                  rowKey={(_, index) =>
                    report.acceptedVarianceLines[index]?.id ?? String(index)
                  }
                  mobileTitleKey="invoiceId"
                />
              </div>
              <p className="mt-3 text-sm font-medium text-slate-800">
                Total: {formatCurrency(report.summary.acceptedUnderpaymentVarianceTotal)}
              </p>
            </section>
          )}

          {showPaymentsVsRevenue && report.paymentsVsRevenueGapLines.length > 0 && (
            <section
              id="payments-vs-revenue-gap"
              className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Payments Received vs Revenue
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Ledger lines where Payments Received (settled invoiced amount) differs from
                    Revenue (<code className="text-xs">payment_amount</code>). Overpayments and
                    other posting gaps usually appear here.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowPaymentsVsRevenue(false)}
                >
                  Close
                </Button>
              </div>
              <div className="mt-4">
                <DataTable
                  columns={[
                    { key: "entryDate", label: "Date" },
                    { key: "invoiceId", label: "Invoice" },
                    { key: "clientName", label: "Client" },
                    { key: "description", label: "Description" },
                    { key: "poNumber", label: "PO" },
                    { key: "invoiced", label: "Invoiced" },
                    { key: "paymentsReceived", label: "Payments Received" },
                    { key: "paymentAmount", label: "Payment Amount" },
                    { key: "revenue", label: "Revenue" },
                    { key: "difference", label: "Difference" },
                  ]}
                  rows={report.paymentsVsRevenueGapLines.map((line) => ({
                    entryDate: formatDate(line.entryDate),
                    invoiceId: line.invoiceId,
                    clientName: line.clientName,
                    description: (
                      <span className="max-w-xs truncate block" title={line.description}>
                        {line.description}
                      </span>
                    ),
                    poNumber: line.poNumber,
                    invoiced: formatCurrency(line.invoicedAmount),
                    paymentsReceived: formatCurrency(line.paymentsReceived),
                    paymentAmount: formatCurrency(line.paymentAmount),
                    revenue: formatCurrency(line.revenueAmount),
                    difference: (
                      <span className="font-medium text-amber-800">
                        {formatCurrency(line.difference)}
                      </span>
                    ),
                  }))}
                  emptyMessage="No payment vs revenue differences."
                  rowKey={(_, index) =>
                    report.paymentsVsRevenueGapLines[index]?.id ?? String(index)
                  }
                  mobileTitleKey="invoiceId"
                />
              </div>
              <p className="mt-3 text-sm font-medium text-slate-800">
                Line differences total:{" "}
                {formatCurrency(
                  report.paymentsVsRevenueGapLines.reduce(
                    (sum, line) => sum + line.difference,
                    0
                  )
                )}{" "}
                (Revenue − Payments Received ={" "}
                {formatCurrency(report.summary.revenueMinusPaymentsReceived)})
              </p>
            </section>
          )}

          {report.invoicesMissingPaidBadge.length > 0 && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm sm:p-6">
              <h2 className="text-lg font-semibold text-amber-900">
                Invoices With Paid Flag Not Set
              </h2>
              <p className="mt-1 text-sm text-amber-900/80">
                These invoices are balance-paid but at least one debit line still has{" "}
                <code className="text-xs">paid = false</code>. Run{" "}
                <strong>Sync paid flags from balance</strong> above, or re-save on Payments.
              </p>
              <ul className="mt-4 space-y-3">
                {report.invoicesMissingPaidBadge.map((row) => (
                  <li
                    key={row.invoiceId}
                    className="rounded-lg border border-amber-200 bg-white p-4 text-sm"
                  >
                    <p className="font-medium text-slate-900">
                      {row.invoiceId}{" "}
                      <span className="font-normal text-slate-600">({row.clientName})</span>
                    </p>
                    <p className="mt-1 text-slate-600">
                      Invoiced {formatCurrency(row.invoicedTotal)} · Received{" "}
                      {formatCurrency(row.paymentReceivedTotal)} · Outstanding{" "}
                      {formatCurrency(row.outstandingTotal)}
                    </p>
                    <p className="mt-1">
                      Paid flag: <strong>No</strong> · Balance paid:{" "}
                      <strong>{row.paidByBalance ? "Yes" : "No"}</strong>
                      {row.unpaidDebitCount > 0 && (
                        <> · {row.unpaidDebitCount} unpaid debit line(s)</>
                      )}
                    </p>
                    <Link
                      href="/invoicing"
                      className="mt-2 inline-block text-brand-700 hover:underline"
                    >
                      Open Invoice History →
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(report.problemLines.length > 0 || report.outstandingCount > 0) && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <h2 className="text-lg font-semibold text-slate-900">
                Ledger Lines Needing Attention
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Lines with an outstanding balance, a paid-flag mismatch, invoiced
                amount not matching payments or revenue, or a non-zero discrepancy
                (revenue minus payments received). The <strong>Discrepancy</strong>{" "}
                column per line is revenue − payments received; the footer total
                should match the summary Discrepancy Amount when every contributing
                line is listed.
              </p>
              <div className="mt-4">
                <DataTable
                  stickyLastColumn
                  columns={[
                    { key: "entryDate", label: "Date" },
                    { key: "invoiceId", label: "Invoice" },
                    { key: "clientName", label: "Client" },
                    { key: "description", label: "Description" },
                    { key: "invoiced", label: "Invoiced" },
                    { key: "paymentsReceived", label: "Payments Received" },
                    { key: "revenue", label: "Revenue" },
                    { key: "paymentFee", label: "Payment Fee" },
                    { key: "invoicedMinusPayments", label: "Invoiced − Payments" },
                    { key: "outstandingRevenue", label: "Outstanding Revenue" },
                    { key: "discrepancy", label: "Discrepancy" },
                    { key: "cashReceived", label: "Cash Received" },
                    { key: "paidFlag", label: "Paid Flag" },
                    { key: "paidByBalance", label: "Balance Paid" },
                    { key: "outstanding", label: "Outstanding Payments" },
                  ]}
                  rows={problemLineRows}
                  footerRow={problemLineFooter}
                  emptyMessage="No problem lines."
                  rowKey={(_, index) => report.problemLines[index]?.id ?? String(index)}
                  mobileTitleKey="invoiceId"
                />
              </div>
              <Link
                href="/ledger"
                className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline"
              >
                Open Ledger to fix paid flags →
              </Link>
            </section>
          )}

          <section className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-800">How totals are calculated</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>Total Amount Invoiced</strong> — sum of line amount (customer price × qty
                + tax + shipping + fee) on invoiced debit lines per invoice (balance-sheet lines
                excluded).
              </li>
              <li>
                <strong>Payments Received</strong> — current-year Revenue minus accepted
                underpayment variances.
              </li>
              <li>
                <strong>Revenue</strong> — same as P&amp;L YTD: sum of{" "}
                <code className="text-xs">payment_amount</code> on invoiced ledger lines for the
                current year (balance-sheet lines excluded). Accepted underpayments are not
                deducted here.
              </li>
              <li>
                <strong>Invoiced − Payments</strong> — per line, invoiced amount minus
                payments received (cash collection gap; matches Outstanding Payments when
                cash is still owed).
              </li>
              <li>
                <strong>Outstanding Revenue</strong> — per line, expected client revenue
                (invoiced minus payment fee, expense, and accepted underpayment variance) not yet in
                payment_amount.
              </li>
              <li>
                <strong>Discrepancy</strong> — per line, only when payment_amount is below
                that expected revenue for the settled portion. Payment fees, accepted
                underpayment variances, expenses, and overpayments are not discrepancies.
              </li>
              <li>
                <strong>Accepted Underpayment Variances</strong> — sum of accepted short
                payments (invoiced − payment after expense). Excluded from outstanding
                revenue and discrepancy; listed in the section above.
              </li>
              <li>
                <strong>Outstanding Payments</strong> — Total Amount Invoiced minus Payments
                Received (invoiced amount not yet collected).
              </li>
              <li>
                <strong>Outstanding Revenue</strong> — sum of per-line outstanding revenue
                (fees are excluded because they are not revenue).
              </li>
              <li>
                <strong>Pink Paid badge</strong> — every debit line has{" "}
                <code className="text-xs">paid = true</code> (set from balance on Payments save
                and ledger edits).
              </li>
            </ul>
          </section>
        </div>
      )}
    </AppShell>
  );
}
