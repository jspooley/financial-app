import type { LedgerEntry } from "./types";

export const COA_SALES_INCOME_CATEGORY = "100 Sales Income";
export const COA_COGS_CATEGORY = "101 COGS";
export const COA_SU_TAX_PAYABLE_CATEGORY = "400 Sales & Use Tax Payable";

/** Leading account number from a CoA label, e.g. "210 Office Expense" → 210. */
export function coaAccountNumber(
  category: string | null | undefined
): number | null {
  if (!category) return null;
  const match = /^(\d{3})\b/.exec(category.trim());
  return match ? Number(match[1]) : null;
}

export function isSalesIncomeCoa(category: string | null | undefined) {
  const n = coaAccountNumber(category);
  return category === COA_SALES_INCOME_CATEGORY || n === 100;
}

export function isCogsCoa(category: string | null | undefined) {
  const n = coaAccountNumber(category);
  return category === COA_COGS_CATEGORY || n === 101;
}

/**
 * Cashflow / operating register categories (not goods invoice lines):
 * 200–299 expenses and 300–399 equity / transfers.
 */
export function isCashflowOperatingCoa(
  category: string | null | undefined
): boolean {
  const n = coaAccountNumber(category);
  return n != null && n >= 200 && n < 400;
}

/** Operating expense categories only (200–299). Excludes 300s equity / transfers. */
export function isOperatingExpenseCoa(
  category: string | null | undefined
): boolean {
  const n = coaAccountNumber(category);
  return n != null && n >= 200 && n < 300;
}

/**
 * Liability categories (400+), e.g. S&U tax collected from clients and owed to
 * the state. Cash moves through them, but they are never P&L revenue or expense.
 */
export function isLiabilityCoa(category: string | null | undefined): boolean {
  const n = coaAccountNumber(category);
  return n != null && n >= 400;
}

type CoaKindFields = Pick<
  LedgerEntry,
  | "coa_category"
  | "expense_type"
  | "source_ledger_id"
  | "designer_cost"
  | "payment_amount"
  | "client_id"
  | "invoice_id"
  | "invoiced"
  | "po_number"
>;

/**
 * Goods / services invoice lines — classified from ledger relationship/data,
 * not CoA. Changing CoA (e.g. 101 → 302) must not hide these from Ledger /
 * Invoicing / Payments.
 */
export function isInvoiceGoodsLine(entry: CoaKindFields): boolean {
  if (entry.source_ledger_id) return false;
  if (entry.client_id) return true;
  if (Number(entry.designer_cost ?? 0) > 0) return true;
  if (entry.invoiced) return true;
  if (normalizeText(entry.invoice_id)) return true;
  if (normalizeText(entry.po_number)) return true;
  return false;
}

/**
 * Operating cashflow row (OpEx / equity / transfers / liability remittances
 * entered on Cashflow). Never true for invoice goods lines, sales-income
 * credits, or companions.
 *
 * After expense_type was cleared (migration 059), classification is: anything
 * left that is not goods / sales income / a companion is cashflow-managed —
 * including rows whose CoA is blank or unrecognized, so Edit/Delete stay available.
 */
export function isOperatingExpenseEntry(entry: CoaKindFields): boolean {
  if (entry.source_ledger_id) return false;
  if (isInvoiceGoodsLine(entry)) return false;
  if (isSalesIncomeCoa(entry.coa_category)) return false;
  return true;
}

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

/** Supabase `.or(...)` fragment to include cashflow operating CoA rows. */
export const CASHFLOW_OPERATING_COA_OR =
  'coa_category.like.2%,coa_category.like.3%,and(coa_category.eq."101 COGS",designer_cost.eq.0,client_id.is.null)';
