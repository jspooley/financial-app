import type { LedgerEntry } from "./types";
import { formatCurrency, formatDate, getLedgerCustomerPrice, getLedgerInvoicedAmount, roundMoney } from "./utils";

/** Short US date for printed invoices (e.g. 4/22/2026). */
export function formatInvoiceDisplayDate(value?: string | Date | null): string {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(date);
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
  return getLedgerOutstandingBalance(line) > 0;
}

export type LedgerAmountEntry = {
  retail_price: number;
  quantity: number;
  discount_percent?: number;
  tax_amount?: number;
  shipping_receiving_amount?: number;
  wholesale_retail?: "wholesale" | "retail";
  credit_debit?: "credit" | "debit";
  invoiced?: boolean | null;
  invoice_id?: string | null;
  paid?: boolean | null;
  payment_fee?: number;
  payment_amount?: number;
};

function invoicedAmountForEntry(entry: LedgerAmountEntry) {
  return getLedgerInvoicedAmount({
    retail_price: entry.retail_price,
    quantity: entry.quantity,
    discount_percent: entry.discount_percent ?? 0,
    tax_amount: entry.tax_amount ?? 0,
    shipping_receiving_amount: entry.shipping_receiving_amount ?? 0,
    wholesale_retail: entry.wholesale_retail ?? "retail",
    payment_fee: entry.payment_fee ?? 0,
  });
}

/** Remaining balance when payment amount is less than invoiced amount. */
export function getLedgerOutstandingBalance(entry: LedgerAmountEntry) {
  const invoiced = invoicedAmountForEntry(entry);
  const paid = roundMoney(Number(entry.payment_amount ?? 0));
  return roundMoney(Math.max(0, invoiced - paid));
}

/** Paid only when cumulative payment amount meets or exceeds invoiced amount. */
export function isLedgerLineFullyPaid(entry: LedgerAmountEntry) {
  return getLedgerOutstandingBalance(entry) === 0;
}

export function summarizeToBeInvoiced(entries: LedgerAmountEntry[]) {
  const lines = entries.filter(isLedgerLineUninvoiced);
  return {
    count: lines.length,
    amount: roundMoney(
      lines.reduce((sum, entry) => sum + invoicedAmountForEntry(entry), 0)
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
      lines.reduce((sum, entry) => sum + getLedgerOutstandingBalance(entry), 0)
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
    LedgerAmountEntry & { client_id?: string; po_number?: string | null }
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
  for (const hasOpenLine of jobHasOpenLine.values()) {
    if (hasOpenLine) openJobs += 1;
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
    if (!entry.invoice_id) continue;
    const list = grouped.get(entry.invoice_id) ?? [];
    list.push(entry);
    grouped.set(entry.invoice_id, list);
  }
  return grouped;
}

export function invoiceLineTotal(entry: InvoiceLineItem): number {
  return getLedgerInvoicedAmount(entry);
}

export interface InvoiceLineBreakdown {
  merchandise: number;
  tax: number;
  shipping: number;
  total: number;
  taxLabel: string;
}

export function getInvoiceLineBreakdown(entry: InvoiceLineItem): InvoiceLineBreakdown {
  const shipping = Number(entry.shipping_receiving_amount) || 0;
  const merchandise = getLedgerCustomerPrice(entry);
  const tax =
    entry.wholesale_retail === "wholesale" ? Number(entry.tax_amount) || 0 : 0;

  return {
    merchandise,
    tax,
    shipping,
    total: roundMoney(merchandise + tax + shipping),
    taxLabel: entry.wholesale_retail === "retail" ? "N/A" : formatCurrency(tax),
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
        total: roundMoney(acc.total + line.total),
        taxLabel: "",
      };
    },
    { merchandise: 0, tax: 0, shipping: 0, total: 0, taxLabel: "" }
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
