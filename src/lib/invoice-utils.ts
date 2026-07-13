import type { LedgerEntry } from "./types";
import { formatCurrency, formatDate, getLedgerCustomerPrice, getLedgerInvoicedAmount, getLedgerInvoicedAmountExcludingPaymentFee, parseDateOnlyParts, roundMoney } from "./utils";

/** Short US date for printed invoices (e.g. 4/22/2026). */
export function formatInvoiceDisplayDate(value?: string | Date | null): string {
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
    }).format(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parts = parseDateOnlyParts(value);
    if (parts) {
      const date = new Date(parts.year, parts.month - 1, parts.day);
      return new Intl.DateTimeFormat("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
      }).format(date);
    }
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

export function formatInvoiceId(poNumber: string, sequence: number): string {
  return `${poNumber.trim()}-${sequence}`;
}

/** Compare PO values from ledger vs invoice form (trim, case-insensitive). */
export function normalizePoNumber(po: string | null | undefined): string {
  return (po ?? "").trim().toLowerCase();
}

export function poNumbersMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizePoNumber(a);
  const nb = normalizePoNumber(b);
  return na.length > 0 && na === nb;
}

export function isLedgerLineUninvoiced(line: {
  invoiced?: boolean | null;
  invoice_id?: string | null;
}): boolean {
  return !line.invoiced && !line.invoice_id;
}

export function isLedgerLineInvoiced(line: {
  invoiced?: boolean | null;
  invoice_id?: string | null;
}): boolean {
  return Boolean(line.invoiced || line.invoice_id);
}

export function isLedgerLineUnpaid(line: LedgerAmountEntry): boolean {
  return getLedgerOutstandingBalance(line) < 0;
}

export type LedgerAmountEntry = {
  retail_price: number;
  quantity: number;
  discount_percent?: number;
  customer_price?: number | null;
  tax_amount?: number;
  shipping_receiving_amount?: number;
  wholesale_retail?: "wholesale" | "retail" | "service";
  designer_cost?: number;
  credit_debit?: "credit" | "debit";
  invoiced?: boolean | null;
  invoice_id?: string | null;
  paid?: boolean | null;
  payment_fee?: number;
  payment_amount?: number;
  expense?: boolean | null;
  expense_amount?: number | null;
  variance_accepted?: boolean | null;
  variance_amount?: number | null;
  balance_sheet?: boolean | null;
};

/** Line amount: customer price × qty + tax + shipping + fee (invoice and payment totals).
 * Personal use (balance sheet) lines are tax amount only. */
export function ledgerLineAmount(entry: LedgerAmountEntry) {
  return getLedgerInvoicedAmount({
    retail_price: entry.retail_price,
    quantity: entry.quantity,
    discount_percent: entry.discount_percent ?? 0,
    customer_price: entry.customer_price,
    tax_amount: entry.tax_amount ?? 0,
    shipping_receiving_amount: entry.shipping_receiving_amount ?? 0,
    wholesale_retail: entry.wholesale_retail ?? "retail",
    payment_fee: entry.payment_fee ?? 0,
    balance_sheet: entry.balance_sheet,
    designer_cost: entry.designer_cost,
  });
}

/** Cash applied to settle the invoice line (payment_amount only).
 * payment_fee is tracked for expense/P&L but is not added again here — payment_amount
 * is the amount applied to the invoiced total (which already includes fee when present). */
export function getLedgerSettlementPaymentAmount(entry: LedgerAmountEntry) {
  return roundMoney(Number(entry.payment_amount ?? 0));
}

/** Gross cash recorded on the line (payment amount + payment fee). */
export function getLedgerTotalPaymentReceived(entry: LedgerAmountEntry) {
  return roundMoney(
    Number(entry.payment_amount ?? 0) + Number(entry.payment_fee ?? 0)
  );
}

/**
 * Signed balance:
 * payment_amount − (invoiced amount − expense amount + accepted variance)
 *
 * Invoiced amount includes payment fee when present. payment_amount is the full
 * amount applied to that total (do not add payment_fee again).
 *
 * Accepted variance is signed: positive = overpayment, negative = underpayment.
 * Zero means settled; negative means still owed; positive means overpaid.
 */
export function getLedgerOutstandingBalance(entry: LedgerAmountEntry) {
  const invoiced = ledgerLineAmount(entry);
  const paymentApplied = getLedgerSettlementPaymentAmount(entry);
  const expenseApplied = entry.expense
    ? roundMoney(Math.max(0, Number(entry.expense_amount ?? 0)))
    : 0;
  const varianceApplied = getLedgerAcceptedVarianceAmount(entry);

  return roundMoney(
    paymentApplied - (invoiced - expenseApplied + varianceApplied)
  );
}

/** Underpayment still owed (positive), or zero when balanced/overpaid. */
export function getLedgerUnderpaymentAmount(entry: LedgerAmountEntry) {
  const balance = getLedgerOutstandingBalance(entry);
  return balance < 0 ? roundMoney(-balance) : 0;
}

/** Alias for amount still owed on a line (always >= 0). */
export function getLineAmountStillOwed(entry: LedgerAmountEntry) {
  return getLedgerUnderpaymentAmount(entry);
}

/**
 * Signed variance before acceptance:
 * payment_amount − (invoiced − expense)
 * Positive = overpayment; negative = underpayment.
 *
 * Invoiced includes payment fee; payment_amount is compared directly (fee is not
 * added on the payment side).
 */
export function getLedgerVarianceBeforeAcceptance(entry: LedgerAmountEntry) {
  const withoutVariance = {
    ...entry,
    variance_accepted: false,
    variance_amount: 0,
  };
  const invoiced = ledgerLineAmount(withoutVariance);
  const paymentApplied = getLedgerSettlementPaymentAmount(withoutVariance);
  const expenseApplied = withoutVariance.expense
    ? roundMoney(Math.max(0, Number(withoutVariance.expense_amount ?? 0)))
    : 0;
  return roundMoney(paymentApplied - (invoiced - expenseApplied));
}

/** Accepted variance in current sign convention (derived from payment vs invoiced). */
export function getLedgerAcceptedVarianceAmount(entry: LedgerAmountEntry) {
  if (!entry.variance_accepted) return 0;
  return getLedgerVarianceBeforeAcceptance(entry);
}

/** @deprecated Use getLedgerVarianceBeforeAcceptance */
export function getLedgerShortfallBeforeAcceptance(entry: LedgerAmountEntry) {
  const variance = getLedgerVarianceBeforeAcceptance(entry);
  return variance < 0 ? roundMoney(-variance) : 0;
}

/** Paid when nothing is still owed (balance settled or overpaid). */
export function isLedgerLineFullyPaid(entry: LedgerAmountEntry) {
  return getLedgerUnderpaymentAmount(entry) < 0.005;
}

/** DB paid flag derived from balance math (set on Payments save and ledger edits). */
export function deriveLedgerPaidFlag(entry: {
  credit_debit?: string | null;
  retail_price?: number | null;
  quantity?: number | null;
  discount_percent?: number | null;
  customer_price?: number | null;
  tax_amount?: number | null;
  shipping_receiving_amount?: number | null;
  wholesale_retail?: string | null;
  designer_cost?: number | null;
  payment_fee?: number | null;
  payment_amount?: number | null;
  expense?: boolean | null;
  expense_amount?: number | null;
  variance_accepted?: boolean | null;
  variance_amount?: number | null;
  balance_sheet?: boolean | null;
}): boolean {
  if (entry.credit_debit !== "debit") return false;
  const wholesaleRetail =
    entry.wholesale_retail === "wholesale" ||
    entry.wholesale_retail === "service"
      ? entry.wholesale_retail
      : "retail";
  return isLedgerLineFullyPaid({
    retail_price: Number(entry.retail_price ?? 0),
    quantity: Number(entry.quantity ?? 1),
    discount_percent: Number(entry.discount_percent ?? 0),
    customer_price: entry.customer_price,
    tax_amount: Number(entry.tax_amount ?? 0),
    shipping_receiving_amount: Number(entry.shipping_receiving_amount ?? 0),
    wholesale_retail: wholesaleRetail,
    designer_cost: Number(entry.designer_cost ?? 0),
    payment_fee: Number(entry.payment_fee ?? 0),
    payment_amount: Number(entry.payment_amount ?? 0),
    expense: entry.expense,
    expense_amount: entry.expense_amount,
    variance_accepted: entry.variance_accepted,
    variance_amount: entry.variance_amount,
    balance_sheet: entry.balance_sheet,
  });
}

/** Invoiced debit line (goods/services on an invoice). */
export function isInvoicedDebitLine(entry: LedgerAmountEntry): boolean {
  return entry.credit_debit === "debit" && isLedgerLineInvoiced(entry);
}

function sumLineAmounts(entries: LedgerAmountEntry[]) {
  return roundMoney(
    entries.reduce(
      (sum, entry) => sum + getLedgerInvoicedAmountExcludingPaymentFee(entry),
      0
    )
  );
}

/** Invoice History total — sum of line amounts on invoiced debits per invoice. */
export function sumInvoiceHistoryTotal(
  invoices: Array<{ invoice_id?: string | null }>,
  ledgerEntries: LedgerAmountEntry[]
): number {
  return roundMoney(
    invoices.reduce((total, invoice) => {
      const lines = getLedgerLinesForInvoice(
        ledgerEntries,
        normalizeInvoiceId(invoice.invoice_id)
      ).filter(isInvoicedDebitLine);
      return total + sumLineAmounts(lines);
    }, 0)
  );
}

/** Cash portion of an invoiced line counted as received (excludes still owed, expense, and accepted underpayment variance). */
export function ledgerLineAmountSettled(entry: LedgerAmountEntry): number {
  if (!isInvoicedDebitLine(entry)) return 0;
  const invoiced = ledgerLineAmount(entry);
  const stillOwed = getLedgerUnderpaymentAmount(entry);
  const expenseApplied = entry.expense
    ? roundMoney(Math.max(0, Number(entry.expense_amount ?? 0)))
    : 0;
  const acceptedVariance = getLedgerAcceptedVarianceAmount(entry);
  const varianceUnderpayment =
    acceptedVariance < 0 ? roundMoney(-acceptedVariance) : 0;
  return roundMoney(
    Math.max(0, invoiced - stillOwed - expenseApplied - varianceUnderpayment)
  );
}

/** Payments History total — cash collected on invoiced lines (not variance/expense write-offs). */
export function sumPaymentsHistoryTotal(entries: LedgerAmountEntry[]): number {
  return roundMoney(
    entries
      .filter(isInvoicedDebitLine)
      .reduce((sum, entry) => sum + ledgerLineAmountSettled(entry), 0)
  );
}

export function normalizeInvoiceId(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function getLedgerLinesForInvoice<T extends { invoice_id?: string | null }>(
  entries: T[],
  invoiceId: string
): T[] {
  const id = normalizeInvoiceId(invoiceId);
  if (!id) return [];
  return entries.filter(
    (entry) => normalizeInvoiceId(entry.invoice_id) === id
  );
}

/** True when every invoiced debit line has paid=true (synced from balance on save). */
export function isInvoiceFullyPaid(lines: LedgerAmountEntry[]): boolean {
  return isInvoicePaidByFlag(lines);
}

export function getInvoiceOutstandingTotal(lines: LedgerAmountEntry[]): number {
  return roundMoney(
    lines
      .filter(isInvoicedDebitLine)
      .reduce((sum, line) => sum + getLedgerUnderpaymentAmount(line), 0)
  );
}

/** Every invoiced debit line has the paid flag set in the database. */
export function isInvoicePaidByFlag(lines: LedgerAmountEntry[]): boolean {
  const debits = lines.filter(isInvoicedDebitLine);
  if (debits.length === 0) return false;
  return debits.every((line) => Boolean(line.paid));
}

/** All invoiced debit lines balance-paid (matches Ledger Paid column). */
export function isInvoicePaidByBalance(lines: LedgerAmountEntry[]): boolean {
  const debits = lines.filter(isInvoicedDebitLine);
  if (debits.length === 0) return false;
  return debits.every((line) => isLedgerLineFullyPaid(line));
}

export function summarizeToBeInvoiced(entries: LedgerAmountEntry[]) {
  const lines = entries.filter(isLedgerLineUninvoiced);
  return {
    count: lines.length,
    amount: roundMoney(
      lines.reduce(
        (sum, entry) => sum + getLedgerInvoicedAmountExcludingPaymentFee(entry),
        0
      )
    ),
  };
}

export function summarizeInvoicedUnpaid(entries: LedgerAmountEntry[]) {
  const lines = entries.filter(
    (entry) =>
      entry.credit_debit === "debit" &&
      isLedgerLineInvoiced(entry) &&
      isLedgerLineUnpaid(entry)
  );
  return {
    count: lines.length,
    amount: roundMoney(
      lines.reduce(
        (sum, entry) => sum + getLedgerUnderpaymentAmount(entry),
        0
      )
    ),
  };
}

export function ledgerJobKey(
  clientId: string | null | undefined,
  poNumber: string | null | undefined
): string | null {
  const po = normalizePoNumber(poNumber);
  if (!clientId || !po) return null;
  return `${clientId}:${po}`;
}

function isLineInvoicedForJob(
  entry: {
    client_id?: string;
    po_number?: string | null;
    invoiced?: boolean | null;
    invoice_id?: string | null;
  },
  invoicedPoKeys?: Set<string>
) {
  if (isLedgerLineInvoiced(entry)) return true;
  if (!invoicedPoKeys || !entry.client_id) return false;
  const key = ledgerJobKey(entry.client_id, entry.po_number);
  return key ? invoicedPoKeys.has(key) : false;
}

/** Jobs are grouped by client + PO. Open = any debit line not both invoiced and paid. */
export function summarizeJobsByStatus(
  entries: Array<
    LedgerAmountEntry & {
      client_id?: string;
      po_number?: string | null;
    }
  >,
  options?: { invoicedPoKeys?: Set<string> }
) {
  const jobHasOpenLine = new Map<string, boolean>();

  for (const entry of entries) {
    if (entry.credit_debit !== "debit") continue;
    const key = ledgerJobKey(entry.client_id, entry.po_number);
    if (!key) continue;

    const complete =
      isLineInvoicedForJob(entry, options?.invoicedPoKeys) &&
      isLedgerLineFullyPaid(entry);
    jobHasOpenLine.set(key, (jobHasOpenLine.get(key) ?? false) || !complete);
  }

  let openJobs = 0;
  let closedJobs = 0;
  for (const [, hasOpen] of jobHasOpenLine) {
    if (hasOpen) openJobs += 1;
    else closedJobs += 1;
  }

  return { openJobs, closedJobs };
}

export const INVOICE_DB_SETUP_SQL = `ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS invoiced BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS invoice_id TEXT;

ALTER TABLE invoicing
  ADD COLUMN IF NOT EXISTS invoice_id TEXT;

ALTER TABLE invoicing
  ADD COLUMN IF NOT EXISTS invoice_sequence INTEGER;

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_invoicing_fk;

ALTER TABLE invoicing DROP CONSTRAINT IF EXISTS invoicing_client_id_po_number_key;

UPDATE invoicing
SET invoice_sequence = 1, invoice_id = po_number || '-1'
WHERE invoice_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoicing_invoice_id ON invoicing(invoice_id);

NOTIFY pgrst, 'reload schema';`;

export function parseInvoiceDbError(error: {
  message: string;
  code?: string;
}): { needsSetup: boolean; message: string } {
  const msg = error.message.toLowerCase();
  if (
    msg.includes("invoice_id") ||
    msg.includes("invoice_sequence") ||
    msg.includes("invoiced") ||
    msg.includes("invoicing_client_id_po_number")
  ) {
    return {
      needsSetup: true,
      message:
        error.code === "23505"
          ? "This PO already has a registry row and your database still blocks multiple invoices per PO. Run the SQL below once in Supabase."
          : error.message,
    };
  }
  if (error.code === "23505") {
    return {
      needsSetup: true,
      message:
        "Duplicate key error — run the SQL below in Supabase to allow multiple invoices per PO (PO-1, PO-2, …).",
    };
  }
  return { needsSetup: false, message: error.message };
}

export function nextInvoiceSequence(existingSequences: number[]): number {
  if (existingSequences.length === 0) return 1;
  return Math.max(...existingSequences) + 1;
}

export interface InvoiceLineItem extends LedgerEntry {
  clients?: { name: string } | null;
}

export function groupLedgerByInvoiceId(
  entries: InvoiceLineItem[]
): Map<string, InvoiceLineItem[]> {
  const grouped = new Map<string, InvoiceLineItem[]>();
  for (const entry of entries) {
    const invoiceId = entry.invoice_id?.trim();
    if (!invoiceId) continue;
    const list = grouped.get(invoiceId) ?? [];
    list.push(entry);
    grouped.set(invoiceId, list);
  }
  return grouped;
}

export interface InvoicePaymentSummary {
  invoiceId: string;
  lineCount: number;
  invoicedTotal: number;
  paidTotal: number;
  outstandingTotal: number;
}

export function summarizePaymentsByInvoiceId(
  entries: InvoiceLineItem[],
  projectEntry?: (entry: InvoiceLineItem) => LedgerAmountEntry
): InvoicePaymentSummary[] {
  const grouped = groupLedgerByInvoiceId(entries);

  return Array.from(grouped.entries())
    .map(([invoiceId, lines]) => {
      const projected = lines.map((line) =>
        projectEntry ? projectEntry(line) : line
      );
      const invoicedTotal = roundMoney(
        lines
          .filter(isInvoicedDebitLine)
          .reduce(
            (sum, entry) => sum + getLedgerInvoicedAmountExcludingPaymentFee(entry),
            0
          )
      );
      const paidTotal = roundMoney(
        projected
          .filter(isInvoicedDebitLine)
          .reduce((sum, entry) => sum + ledgerLineAmountSettled(entry), 0)
      );
      const outstandingTotal = roundMoney(
        projected.reduce(
          (sum, entry) => sum + getLedgerUnderpaymentAmount(entry),
          0
        )
      );
      return {
        invoiceId,
        lineCount: lines.length,
        invoicedTotal,
        paidTotal,
        outstandingTotal,
      };
    })
    .sort((a, b) => b.invoiceId.localeCompare(a.invoiceId));
}

export function invoiceLineTotal(entry: InvoiceLineItem): number {
  return getLedgerInvoicedAmountExcludingPaymentFee(entry);
}

export interface InvoiceLineBreakdown {
  merchandise: number;
  tax: number;
  shipping: number;
  paymentFee: number;
  total: number;
  taxLabel: string;
}

export function getInvoiceLineBreakdown(entry: InvoiceLineItem): InvoiceLineBreakdown {
  const tax =
    entry.wholesale_retail === "wholesale" ? Number(entry.tax_amount) || 0 : 0;

  if (entry.balance_sheet) {
    return {
      merchandise: 0,
      tax,
      shipping: 0,
      paymentFee: 0,
      total: roundMoney(tax),
      taxLabel: entry.wholesale_retail === "wholesale" ? formatCurrency(tax) : "N/A",
    };
  }

  const shipping = Number(entry.shipping_receiving_amount) || 0;
  const merchandise = getLedgerCustomerPrice(entry);

  return {
    merchandise,
    tax,
    shipping,
    paymentFee: 0,
    total: roundMoney(merchandise + tax + shipping),
    taxLabel: entry.wholesale_retail === "wholesale" ? formatCurrency(tax) : "N/A",
  };
}

export function sumInvoiceLineBreakdowns(entries: InvoiceLineItem[]): InvoiceLineBreakdown {
  return entries.reduce(
    (acc, entry) => {
      const line = getInvoiceLineBreakdown(entry);
      return {
        merchandise: roundMoney(acc.merchandise + line.merchandise),
        tax: roundMoney(acc.tax + line.tax),
        shipping: roundMoney(acc.shipping + line.shipping),
        paymentFee: roundMoney(acc.paymentFee + line.paymentFee),
        total: roundMoney(acc.total + line.total),
        taxLabel: "",
      };
    },
    { merchandise: 0, tax: 0, shipping: 0, paymentFee: 0, total: 0, taxLabel: "" }
  );
}

export function invoiceLinesSubtotal(entries: InvoiceLineItem[]): number {
  return sumInvoiceLineBreakdowns(entries).total;
}

export function describeInvoiceLine(entry: InvoiceLineItem): string {
  const parts = [
    formatDate(entry.entry_date),
    entry.description?.trim() || "Ledger item",
    formatCurrency(invoiceLineTotal(entry)),
  ];
  return parts.join(" · ");
}
