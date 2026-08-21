import type { LedgerEntry } from "./types";

export const COA_SALES_INCOME_CATEGORY = "100 Sales Income";
export const COA_COGS_CATEGORY = "101 COGS";
export const COA_FEES_CATEGORY = "203 commissions and fees";
export const COA_TRANSFERS_CATEGORY =
  "302 Transfers between accounts (paying a credit card bill)";
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
 * Expense / Balance Sheet / Income Statement flags written on Cashflow Add/Edit.
 * Derived from CoA (not user checkboxes): 300-series equity and transfers are
 * Balance Sheet; 200-series operating expenses are Income Statement expenses.
 */
export function cashflowClassificationFlags(coaCategory: string) {
  const isCogs = isCogsCoa(coaCategory);
  const isEquityOrTransfer =
    isCashflowOperatingCoa(coaCategory) && !isOperatingExpenseCoa(coaCategory);
  return {
    expense: !isCogs && !isEquityOrTransfer,
    balance_sheet: isEquityOrTransfer,
    income_statement: !isEquityOrTransfer,
  };
}

/** 303/304 (or any CoA label that names both partners), e.g. Jess to Molly. */
export function isPartnerToPartnerTransferCoa(
  category: string | null | undefined
) {
  const n = coaAccountNumber(category);
  if (n === 303 || n === 304) return true;
  const label = (category ?? "").toLowerCase();
  return label.includes("jess") && label.includes("molly");
}

/** Partner true-up transfers: 203 commissions/fees and 302–399 account transfers. */
export function isRecordedTransferCoa(
  category: string | null | undefined
): boolean {
  const n = coaAccountNumber(category);
  return n === 203 || (n != null && n >= 302 && n < 400);
}

/** 300 Owner's Contribution and 301 Owner's Draws — equity, not a 50/50 share. */
export function isOwnerEquityCoa(category: string | null | undefined): boolean {
  const n = coaAccountNumber(category);
  return n === 300 || n === 301;
}

/** 214 Taxes and licenses — remitted to the state, not a 50/50 partner share. */
export function isTaxesAndLicensesCoa(
  category: string | null | undefined
): boolean {
  return coaAccountNumber(category) === 214;
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
  if (normalizeText(entry.po_number)) return true;
  // invoice_id alone is not a goods line — Cashflow transfers can reference an
  // invoice for the True Up report without being a Ledger/Invoicing line.
  return false;
}

/**
 * Row owned by Cashflow Add/Edit: not a ledger goods line and not a companion.
 * Includes operating expenses, equity/transfers, and sales-income credits typed
 * in on Cashflow (those are excluded from isOperatingExpenseEntry).
 */
export function isCashflowManagedEntry(entry: CoaKindFields): boolean {
  if (entry.source_ledger_id) return false;
  if (isInvoiceGoodsLine(entry)) return false;
  return true;
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
  if (!isCashflowManagedEntry(entry)) return false;
  if (isSalesIncomeCoa(entry.coa_category)) return false;
  return true;
}

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

/** Supabase `.or(...)` fragment to include cashflow operating CoA rows. */
export const CASHFLOW_OPERATING_COA_OR =
  'coa_category.like.2%,coa_category.like.3%,and(coa_category.eq."101 COGS",designer_cost.eq.0,client_id.is.null)';
