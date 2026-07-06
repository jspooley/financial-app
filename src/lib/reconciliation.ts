import {
  getLedgerOutstandingBalance,
  getLedgerTotalPaymentReceived,
  getLedgerUnderpaymentAmount,
  getLedgerLinesForInvoice,
  isInvoicePaidByBalance,
  isInvoicePaidByFlag,
  isLedgerLineFullyPaid,
  isInvoicedDebitLine,
  ledgerLineAmount,
  ledgerLineAmountSettled,
  sumPaymentsHistoryTotal,
  summarizeInvoicedUnpaid,
  normalizeInvoiceId,
} from "./invoice-utils";
import type { Invoice, LedgerEntry } from "./types";
import { roundMoney } from "./utils";

export interface ReconciliationSummary {
  invoiceHistoryTotal: number;
  paymentsHistoryTotal: number;
  revenueTotal: number;
  outstandingTotal: number;
  totalExpense: number;
  invoiceMinusRevenue: number;
  revenueMinusPayments: number;
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

function linePaymentsRevenueGap(entry: LedgerEntry): number {
  const settled = ledgerLineAmountSettled(entry);
  const revenue = roundMoney(Number(entry.payment_amount ?? 0));
  return roundMoney(revenue - settled);
}

/** Invoiced amount not yet recorded in payment_amount (zero when overpaid). */
function lineOutstandingRevenueAmount(entry: LedgerEntry): number {
  const invoiced = ledgerLineAmount(entry);
  const paymentAmount = roundMoney(Number(entry.payment_amount ?? 0));
  const gap = roundMoney(invoiced - paymentAmount);
  return gap > 0 ? gap : 0;
}

/**
 * Structural gap only when revenue is below payments received (e.g. payment fees).
 * Overpayment (revenue > settled) is additional revenue, not a discrepancy.
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
      .filter(isInvoicedDebitLine)
      .reduce((sum, entry) => sum + ledgerLineAmount(entry), 0)
  );
}

function sumInvoicedDebitRevenue(entries: LedgerEntry[]) {
  return roundMoney(
    entries
      .filter(isInvoicedDebitLine)
      .reduce((sum, entry) => sum + Number(entry.payment_amount ?? 0), 0)
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
  clientNames: Map<string, string>
) {
  const invoicedDebits = ledgerEntries.filter((entry) => isInvoicedDebitLine(entry));

  const invoiceHistoryTotal = sumInvoicedDebitLineAmounts(ledgerEntries);
  const paymentsHistoryTotal = sumPaymentsHistoryTotal(ledgerEntries);
  const revenueTotal = sumInvoicedDebitRevenue(ledgerEntries);

  const outstanding = summarizeInvoicedUnpaid(ledgerEntries);
  const totalExpense = roundMoney(
    ledgerEntries.reduce(
      (sum, entry) => sum + Number(entry.expense_amount ?? 0),
      0
    )
  );

  const summary: ReconciliationSummary = {
    invoiceHistoryTotal,
    paymentsHistoryTotal,
    revenueTotal,
    outstandingTotal: outstanding.amount,
    totalExpense,
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
    invoicesMissingPaidBadge: invoicesWithUnsetPaidFlag,
    outstandingCount: outstanding.count,
  };
}
