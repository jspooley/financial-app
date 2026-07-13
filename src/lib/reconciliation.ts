import {
  getLedgerOutstandingBalance,
  getLedgerTotalPaymentReceived,
  getLedgerUnderpaymentAmount,
  getLedgerAcceptedVarianceAmount,
  getLedgerLinesForInvoice,
  isInvoicePaidByBalance,
  isInvoicePaidByFlag,
  isLedgerLineFullyPaid,
  isInvoicedDebitLine,
  ledgerLineAmount,
  ledgerLineAmountSettled,
  summarizeInvoicedUnpaid,
  normalizeInvoiceId,
} from "./invoice-utils";
import { computePlTotals } from "./pl-report";
import type { Invoice, LedgerEntry } from "./types";
import { ledgerLineRevenue, roundMoney } from "./utils";

export interface ReconciliationSummary {
  invoiceHistoryTotal: number;
  paymentsHistoryTotal: number;
  revenueTotal: number;
  /** Revenue − Payments Received (positive when revenue is higher). */
  revenueMinusPaymentsReceived: number;
  outstandingTotal: number;
  totalExpense: number;
  acceptedUnderpaymentVarianceTotal: number;
  invoiceMinusRevenue: number;
  revenueMinusPayments: number;
}

export interface AcceptedVarianceReconciliationRow {
  id: string;
  entryDate: string;
  clientName: string;
  invoiceId: string;
  description: string;
  poNumber: string;
  invoicedAmount: number;
  paymentAmount: number;
  varianceAmount: number;
  varianceNotes: string;
}

export interface PaymentsVsRevenueGapRow {
  id: string;
  entryDate: string;
  clientName: string;
  invoiceId: string;
  description: string;
  poNumber: string;
  invoicedAmount: number;
  paymentsReceived: number;
  paymentAmount: number;
  revenueAmount: number;
  /** Revenue (payment_amount) − payments received for this line. */
  difference: number;
}

export interface InvoiceReconciliationRow {
  invoiceId: string;
  clientName: string;
  poNumber: string;
  invoicedTotal: number;
  paymentReceivedTotal: number;
  revenueTotal: number;
  outstandingTotal: number;
  paidByFlag: boolean;
  paidByBalance: boolean;
  lineCount: number;
  unpaidDebitCount: number;
}

export interface ReconciliationAttentionTotals {
  invoicedAmount: number;
  paymentsReceivedSettled: number;
  paymentAmount: number;
  paymentFee: number;
  invoicedMinusPaymentsReceived: number;
  outstandingRevenueAmount: number;
  lineDiscrepancyAmount: number;
  outstandingAmount: number;
}

export interface LedgerLineReconciliationRow {
  id: string;
  entryDate: string;
  clientName: string;
  invoiceId: string;
  description: string;
  invoicedAmount: number;
  paymentReceived: number;
  paymentAmount: number;
  paymentFee: number;
  expenseAmount: number;
  outstandingBalance: number;
  paidByBalance: boolean;
  paidFlag: boolean;
  inPaymentsHistory: boolean;
  paymentsReceivedSettled: number;
  paymentsRevenueGap: number;
  lineDiscrepancyAmount: number;
  invoicedMinusPaymentsReceived: number;
  outstandingRevenueAmount: number;
  outstandingAmount: number;
}


function clientNameFor(
  entry: LedgerEntry,
  clientNames: Map<string, string>
) {
  return entry.clients?.name ?? clientNames.get(entry.client_id) ?? "Unknown client";
}

function acceptedVarianceUnderpayment(entry: LedgerEntry): number {
  if (!entry.variance_accepted) return 0;
  const amount = getLedgerAcceptedVarianceAmount(entry);
  return amount < 0 ? roundMoney(-amount) : 0;
}

function appliedExpenseAmount(entry: LedgerEntry): number {
  if (!entry.expense) return 0;
  return roundMoney(Math.max(0, Number(entry.expense_amount ?? 0)));
}

function paymentFeeAmount(entry: LedgerEntry): number {
  return roundMoney(Math.max(0, Number(entry.payment_fee ?? 0)));
}

/**
 * Amount expected in payment_amount when a line is fully settled for collection.
 * Invoiced includes payment fee, but revenue is payment_amount only — so fee,
 * accepted underpayment variance, and expense are not expected as revenue.
 */
function expectedPaymentAmountRevenue(entry: LedgerEntry): number {
  return roundMoney(
    ledgerLineAmount(entry) -
      paymentFeeAmount(entry) -
      acceptedVarianceUnderpayment(entry) -
      appliedExpenseAmount(entry)
  );
}

function linePaymentsRevenueGap(entry: LedgerEntry): number {
  const revenue = roundMoney(Number(entry.payment_amount ?? 0));
  // Only compare revenue to the settled portion that should live in payment_amount.
  // If the line is still underpaid, reduce expected revenue by the remaining balance.
  const stillOwed = getLedgerUnderpaymentAmount(entry);
  const expectedRevenue = roundMoney(
    Math.max(0, expectedPaymentAmountRevenue(entry) - stillOwed)
  );
  return roundMoney(revenue - expectedRevenue);
}

/**
 * Invoiced client revenue not yet in payment_amount.
 * Excludes payment fees (in invoiced total but not revenue), accepted underpayment
 * variances, and expense.
 */
function lineOutstandingRevenueAmount(entry: LedgerEntry): number {
  const revenue = roundMoney(Number(entry.payment_amount ?? 0));
  const gap = roundMoney(expectedPaymentAmountRevenue(entry) - revenue);
  return gap > 0 ? gap : 0;
}

/**
 * Gap only when payment_amount is below the revenue expected for the settled line
 * (unusual posting issues). Payment fees, accepted underpayment variances, expenses, and
 * overpayments are not counted as discrepancies.
 */
function lineDiscrepancyAmount(entry: LedgerEntry): number {
  const gap = linePaymentsRevenueGap(entry);
  if (gap >= 0) return 0;
  return gap;
}

function sumInvoicedDebitDiscrepancy(entries: LedgerEntry[]) {
  return roundMoney(
    entries
      .filter(isInvoicedDebitLine)
      .reduce((sum, entry) => sum + lineDiscrepancyAmount(entry), 0)
  );
}

function sumInvoicedDebitOutstandingRevenue(entries: LedgerEntry[]) {
  return roundMoney(
    entries
      .filter(isInvoicedDebitLine)
      .reduce((sum, entry) => sum + lineOutstandingRevenueAmount(entry), 0)
  );
}

function lineNeedsAttention(entry: LedgerEntry): boolean {
  const underpayment = getLedgerUnderpaymentAmount(entry);
  const outstandingRevenue = lineOutstandingRevenueAmount(entry);
  const discrepancy = lineDiscrepancyAmount(entry);
  const paidByBalance = isLedgerLineFullyPaid(entry);
  const paidFlag = Boolean(entry.paid);

  if (underpayment >= 0.005) return true;
  if (outstandingRevenue >= 0.005) return true;
  if (Math.abs(discrepancy) >= 0.005) return true;
  if (paidByBalance !== paidFlag) return true;
  return false;
}

function mapProblemLine(
  entry: LedgerEntry,
  clientNames: Map<string, string>
): LedgerLineReconciliationRow {
  const paymentsReceivedSettled = ledgerLineAmountSettled(entry);
  const paymentAmount = Number(entry.payment_amount ?? 0);
  const paymentFee = Number(entry.payment_fee ?? 0);
  const invoicedAmount = ledgerLineAmount(entry);
  const outstandingAmount = getLedgerUnderpaymentAmount(entry);
  const invoicedMinusPaymentsReceived = roundMoney(
    invoicedAmount - paymentsReceivedSettled
  );
  const outstandingRevenueAmount = lineOutstandingRevenueAmount(entry);
  const discrepancy = lineDiscrepancyAmount(entry);
  return {
    id: entry.id,
    entryDate: entry.entry_date,
    clientName: clientNameFor(entry, clientNames),
    invoiceId: entry.invoice_id ?? "—",
    description: entry.description?.trim() || "—",
    invoicedAmount,
    paymentReceived: getLedgerTotalPaymentReceived(entry),
    paymentAmount,
    paymentFee,
    expenseAmount: Number(entry.expense_amount ?? 0),
    outstandingBalance: getLedgerOutstandingBalance(entry),
    paidByBalance: isLedgerLineFullyPaid(entry),
    paidFlag: Boolean(entry.paid),
    inPaymentsHistory: paymentsReceivedSettled > 0,
    paymentsReceivedSettled,
    paymentsRevenueGap: discrepancy,
    lineDiscrepancyAmount: discrepancy,
    invoicedMinusPaymentsReceived,
    outstandingRevenueAmount,
    outstandingAmount,
  };
}

function sumInvoicedDebitLineAmounts(entries: LedgerEntry[]) {
  return roundMoney(
    entries
      .filter((entry) => isInvoicedDebitLine(entry) && !entry.balance_sheet)
      .reduce((sum, entry) => sum + ledgerLineAmount(entry), 0)
  );
}

function invoicedPoKeysFromInvoices(invoices: Invoice[]) {
  return new Set(
    invoices.map(
      (invoice) =>
        `${invoice.client_id}:${(invoice.po_number ?? "").trim().toLowerCase()}`
    )
  );
}

function sumAttentionTotals(
  lines: LedgerLineReconciliationRow[]
): ReconciliationAttentionTotals {
  return lines.reduce(
    (acc, line) => ({
      invoicedAmount: roundMoney(acc.invoicedAmount + line.invoicedAmount),
      paymentsReceivedSettled: roundMoney(
        acc.paymentsReceivedSettled + line.paymentsReceivedSettled
      ),
      paymentAmount: roundMoney(acc.paymentAmount + line.paymentAmount),
      paymentFee: roundMoney(acc.paymentFee + line.paymentFee),
      invoicedMinusPaymentsReceived: roundMoney(
        acc.invoicedMinusPaymentsReceived + line.invoicedMinusPaymentsReceived
      ),
      outstandingRevenueAmount: roundMoney(
        acc.outstandingRevenueAmount + line.outstandingRevenueAmount
      ),
      lineDiscrepancyAmount: roundMoney(
        acc.lineDiscrepancyAmount + line.lineDiscrepancyAmount
      ),
      outstandingAmount: roundMoney(acc.outstandingAmount + line.outstandingAmount),
    }),
    {
      invoicedAmount: 0,
      paymentsReceivedSettled: 0,
      paymentAmount: 0,
      paymentFee: 0,
      invoicedMinusPaymentsReceived: 0,
      outstandingRevenueAmount: 0,
      lineDiscrepancyAmount: 0,
      outstandingAmount: 0,
    }
  );
}

export function buildReconciliationReport(
  invoices: Invoice[],
  ledgerEntries: LedgerEntry[],
  clientNames: Map<string, string>,
  reportYear: number = new Date().getFullYear()
) {
  const invoicedPoKeys = invoicedPoKeysFromInvoices(invoices);
  const yearPrefix = `${reportYear}-`;
  const ytdEntries = ledgerEntries.filter(
    (entry) =>
      typeof entry.entry_date === "string" && entry.entry_date.startsWith(yearPrefix)
  );
  const ytdPlEntries = ytdEntries.filter((entry) => !entry.balance_sheet);

  // Same revenue as P&L YTD: payment_amount on invoiced lines (excl. balance sheet).
  const revenueTotal = computePlTotals(ytdEntries, invoicedPoKeys).revenue;

  const invoicedDebits = ledgerEntries.filter((entry) => isInvoicedDebitLine(entry));

  const invoiceHistoryTotal = sumInvoicedDebitLineAmounts(ledgerEntries);

  const outstanding = summarizeInvoicedUnpaid(ledgerEntries);
  const totalExpense = roundMoney(
    ledgerEntries.reduce(
      (sum, entry) => sum + Number(entry.expense_amount ?? 0),
      0
    )
  );

  const acceptedVarianceLines: AcceptedVarianceReconciliationRow[] = ytdPlEntries
    .filter((entry) => acceptedVarianceUnderpayment(entry) >= 0.005)
    .map((entry) => ({
      id: entry.id,
      entryDate: entry.entry_date,
      clientName: clientNameFor(entry, clientNames),
      invoiceId: entry.invoice_id?.trim() || "—",
      description: entry.description?.trim() || "—",
      poNumber: entry.po_number?.trim() || "—",
      invoicedAmount: ledgerLineAmount(entry),
      paymentAmount: roundMoney(Number(entry.payment_amount ?? 0)),
      varianceAmount: acceptedVarianceUnderpayment(entry),
      varianceNotes: entry.variance_notes?.trim() || "",
    }))
    .sort((a, b) => {
      if (b.varianceAmount !== a.varianceAmount) {
        return b.varianceAmount - a.varianceAmount;
      }
      return b.entryDate.localeCompare(a.entryDate);
    });

  const acceptedUnderpaymentVarianceTotal = roundMoney(
    acceptedVarianceLines.reduce((sum, row) => sum + row.varianceAmount, 0)
  );

  // Payments Received = P&L revenue minus accepted underpayments (Revenue itself is gross).
  const paymentsHistoryTotal = roundMoney(
    revenueTotal - acceptedUnderpaymentVarianceTotal
  );

  const paymentsVsRevenueGapLines: PaymentsVsRevenueGapRow[] = ytdPlEntries
    .filter((entry) => ledgerLineRevenue(entry, invoicedPoKeys) > 0 || Number(entry.payment_amount ?? 0) > 0)
    .map((entry) => {
      const paymentsReceived = ledgerLineAmountSettled(entry);
      const paymentAmount = roundMoney(Number(entry.payment_amount ?? 0));
      const revenueAmount = ledgerLineRevenue(entry, invoicedPoKeys);
      const difference = roundMoney(revenueAmount - paymentsReceived);
      return {
        id: entry.id,
        entryDate: entry.entry_date,
        clientName: clientNameFor(entry, clientNames),
        invoiceId: entry.invoice_id?.trim() || "—",
        description: entry.description?.trim() || "—",
        poNumber: entry.po_number?.trim() || "—",
        invoicedAmount: ledgerLineAmount(entry),
        paymentsReceived,
        paymentAmount,
        revenueAmount,
        difference,
      };
    })
    .filter((row) => Math.abs(row.difference) >= 0.005)
    .sort((a, b) => {
      if (Math.abs(b.difference) !== Math.abs(a.difference)) {
        return Math.abs(b.difference) - Math.abs(a.difference);
      }
      return b.entryDate.localeCompare(a.entryDate);
    });

  const revenueMinusPaymentsReceived = roundMoney(
    paymentsVsRevenueGapLines.reduce((sum, row) => sum + row.difference, 0)
  );

  const summary: ReconciliationSummary = {
    invoiceHistoryTotal,
    paymentsHistoryTotal,
    revenueTotal,
    revenueMinusPaymentsReceived,
    outstandingTotal: outstanding.amount,
    totalExpense,
    acceptedUnderpaymentVarianceTotal,
    invoiceMinusRevenue: sumInvoicedDebitOutstandingRevenue(ledgerEntries),
    revenueMinusPayments: sumInvoicedDebitDiscrepancy(ledgerEntries),
  };

  const invoiceRows: InvoiceReconciliationRow[] = [...invoices]
    .sort((a, b) => (b.invoice_id ?? "").localeCompare(a.invoice_id ?? ""))
    .map((invoice) => {
      const invoiceId = normalizeInvoiceId(invoice.invoice_id);
      const lines = getLedgerLinesForInvoice(ledgerEntries, invoiceId);
      const debits = lines.filter(isInvoicedDebitLine);
      const invoicedTotal = roundMoney(
        debits.reduce((sum, line) => sum + ledgerLineAmount(line), 0)
      );
      const paymentReceivedTotal = roundMoney(
        debits.reduce(
          (sum, line) =>
            sum +
            roundMoney(ledgerLineAmount(line) - getLedgerUnderpaymentAmount(line)),
          0
        )
      );
      const revenueTotalForInvoice = roundMoney(
        debits.reduce((sum, line) => sum + Number(line.payment_amount ?? 0), 0)
      );
      const outstandingTotal = roundMoney(
        debits.reduce((sum, line) => sum + getLedgerUnderpaymentAmount(line), 0)
      );

      return {
        invoiceId,
        clientName:
          invoice.clients?.name ??
          clientNames.get(invoice.client_id) ??
          "Unknown client",
        poNumber: invoice.po_number,
        invoicedTotal,
        paymentReceivedTotal,
        revenueTotal: revenueTotalForInvoice,
        outstandingTotal,
        paidByFlag: isInvoicePaidByFlag(lines),
        paidByBalance: isInvoicePaidByBalance(lines),
        lineCount: lines.length,
        unpaidDebitCount: debits.filter((line) => !isLedgerLineFullyPaid(line))
          .length,
      };
    });

  const problemLineById = new Map<string, LedgerLineReconciliationRow>();
  for (const entry of invoicedDebits) {
    if (lineNeedsAttention(entry)) {
      problemLineById.set(entry.id, mapProblemLine(entry, clientNames));
    }
  }
  const problemLines = Array.from(problemLineById.values()).sort((a, b) => {
    if (b.outstandingAmount !== a.outstandingAmount) {
      return b.outstandingAmount - a.outstandingAmount;
    }
    if (b.outstandingRevenueAmount !== a.outstandingRevenueAmount) {
      return b.outstandingRevenueAmount - a.outstandingRevenueAmount;
    }
    if (Math.abs(b.lineDiscrepancyAmount) !== Math.abs(a.lineDiscrepancyAmount)) {
      return Math.abs(b.lineDiscrepancyAmount) - Math.abs(a.lineDiscrepancyAmount);
    }
    return b.entryDate.localeCompare(a.entryDate);
  });

  const attentionLineTotals = sumAttentionTotals(problemLines);

  const invoicesWithUnsetPaidFlag = invoiceRows.filter(
    (row) => row.paidByBalance && !row.paidByFlag
  );

  return {
    summary,
    invoiceRows,
    problemLines,
    attentionLineTotals,
    acceptedVarianceLines,
    paymentsVsRevenueGapLines,
    invoicesMissingPaidBadge: invoicesWithUnsetPaidFlag,
    outstandingCount: outstanding.count,
  };
}
