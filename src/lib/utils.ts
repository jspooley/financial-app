import type { PaymentType } from "./types";

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Dollar amount for editable inputs (always two decimal places). */
export function formatMoneyInput(value: number) {
  if (!Number.isFinite(value)) return "";
  return roundMoney(value).toFixed(2);
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/** Ledger quantity rounded to two decimal places (min 0.01). */
export function normalizeQuantity(value: number) {
  const qty = roundMoney(Number(value));
  return qty > 0 ? qty : 1;
}

export function formatQuantity(value: number) {
  return normalizeQuantity(value).toFixed(2);
}

/** Venmo processing fee: 2.3% of payment amount. */
export function calculateVenmoPaymentFee(paymentAmount: number) {
  return roundMoney(Math.max(0, Number(paymentAmount) || 0) * 0.023);
}

/** Credit card processing fee: 2.6% of payment amount. */
export function calculateCreditCardPaymentFee(paymentAmount: number) {
  return roundMoney(Math.max(0, Number(paymentAmount) || 0) * 0.026);
}

export function paymentTypeHasAutoFee(paymentType: PaymentType) {
  return paymentType === "Venmo" || paymentType === "CC";
}

/** Auto-calculated payment fee for Venmo (2.3%) or CC (2.6%). */
export function calculateAutoPaymentFee(
  paymentType: PaymentType,
  paymentAmount: number
) {
  switch (paymentType) {
    case "Venmo":
      return calculateVenmoPaymentFee(paymentAmount);
    case "CC":
      return calculateCreditCardPaymentFee(paymentAmount);
    default:
      return 0;
  }
}

/** Sales/use tax: customer price × qty × 0.06 (after discount). */
export function calculateTaxFromCustomerPrice(
  retailPrice: number,
  quantity: number,
  discountPercent: number
) {
  return roundMoney(
    calculateCustomerPrice(retailPrice, quantity, discountPercent) * 0.06
  );
}

/** Discounted retail subtotal: retail price × (1 − discount %) × qty */
export function getLedgerMerchandiseAmount(entry: {
  retail_price: number;
  quantity: number;
  discount_percent: number;
}) {
  const qty = normalizeQuantity(entry.quantity);
  const retailSubtotal = Number(entry.retail_price) * qty;
  const discountAmount = (Number(entry.discount_percent) / 100) * retailSubtotal;
  return roundMoney(retailSubtotal - discountAmount);
}

/** Discounted retail only: retail price × (1 − discount %) × qty */
export function getLedgerCustomerPrice(entry: {
  retail_price: number;
  quantity: number;
  discount_percent: number;
  customer_price?: number | null;
}) {
  const discountPercent = Number(entry.discount_percent) || 0;
  if (discountPercent > 0) {
    return getLedgerMerchandiseAmount({
      retail_price: entry.retail_price,
      quantity: entry.quantity,
      discount_percent: discountPercent,
    });
  }
  const stored = roundMoney(Number(entry.customer_price ?? 0));
  if (stored > 0) {
    return stored;
  }
  return getLedgerMerchandiseAmount({
    retail_price: entry.retail_price,
    quantity: entry.quantity,
    discount_percent: 0,
  });
}

/** Customer price × qty + tax + shipping + fee — used for invoice and payment line totals. */
export function getLedgerInvoicedAmount(entry: {
  retail_price: number;
  quantity: number;
  discount_percent: number;
  customer_price?: number | null;
  tax_amount: number;
  shipping_receiving_amount: number;
  wholesale_retail: "wholesale" | "retail";
  payment_fee?: number;
}) {
  const tax =
    entry.wholesale_retail === "wholesale" ? Number(entry.tax_amount) : 0;
  const shipping = Number(entry.shipping_receiving_amount) || 0;
  const fee = Number(entry.payment_fee ?? 0);
  return roundMoney(
    getLedgerCustomerPrice(entry) + tax + shipping + fee
  );
}

/** Form helper — discounted retail subtotal only. */
export function calculateCustomerPrice(
  retailPrice: number,
  quantity: number,
  discountPercent: number
) {
  return getLedgerMerchandiseAmount({
    retail_price: retailPrice,
    quantity,
    discount_percent: discountPercent,
  });
}

export function getLedgerTotalDesignerCost(entry: {
  designer_cost: number;
  quantity: number;
}) {
  return roundMoney(Number(entry.designer_cost) * (Number(entry.quantity) || 1));
}

/** Unit retail price × quantity (before discount). */
export function getLedgerRetailSubtotal(entry: {
  retail_price: number;
  quantity: number;
}) {
  const qty = normalizeQuantity(entry.quantity);
  return roundMoney(Number(entry.retail_price) * qty);
}

type LedgerBalanceEntry = {
  client_id?: string;
  po_number?: string | null;
  designer_cost: number;
  retail_price: number;
  quantity: number;
  credit_debit: "credit" | "debit";
  invoiced?: boolean;
  invoice_id?: string | null;
  discount_percent?: number;
  tax_amount?: number;
  shipping_receiving_amount?: number;
  wholesale_retail?: "wholesale" | "retail";
  payment_fee?: number;
  payment_amount?: number;
};

function ledgerRevenueAmount(entry: LedgerBalanceEntry) {
  return roundMoney(Number(entry.payment_amount ?? 0));
}

function ledgerPoClientKey(clientId: string, po: string | null | undefined) {
  return `${clientId}:${(po ?? "").trim().toLowerCase()}`;
}

function isInvoicedForBalance(
  entry: LedgerBalanceEntry,
  invoicedPoKeys?: Set<string>
) {
  if (entry.invoiced || entry.invoice_id) return true;
  if (!invoicedPoKeys || !entry.client_id || !entry.po_number?.trim()) return false;
  return invoicedPoKeys.has(ledgerPoClientKey(entry.client_id, entry.po_number));
}

/**
 * Invoiced lines: credits = payments received, debits = designer cost.
 * Net balance = credits − debits. Uninvoiced debits add designer cost only.
 */
export function sumLedgerCreditsAndDebits(
  entries: LedgerBalanceEntry[],
  options?: { invoicedPoKeys?: Set<string> }
) {
  return entries.reduce(
    (acc, entry) => {
      const designerTotal = getLedgerTotalDesignerCost(entry);
      const revenue = ledgerRevenueAmount(entry);

      if (isInvoicedForBalance(entry, options?.invoicedPoKeys)) {
        acc.credits += revenue;
        acc.debits += designerTotal;
        return acc;
      }

      if (entry.credit_debit === "debit") {
        acc.debits += designerTotal;
      }

      return acc;
    },
    { credits: 0, debits: 0 }
  );
}

export function defaultLedgerDiscountPercent(tradePartnerPercent: number) {
  return roundMoney(tradePartnerPercent / 2);
}

/** Trade discount % from sample pricing: ((retail − designer cost) ÷ retail) × 100 */
export function calculateTradeDiscountPercentFromPricing(
  retailPrice: number,
  designerCost: number
) {
  const retail = Number(retailPrice);
  if (retail <= 0) return 0;
  return roundMoney(((retail - Number(designerCost)) / retail) * 100);
}

/** Unit designer cost: retail price × (1 − trade partner discount %). */
export function calculateDesignerCostFromTradePartner(
  retailPrice: number,
  tradePartnerDiscountPercent: number
) {
  const discountRate = Number(tradePartnerDiscountPercent) / 100;
  return roundMoney(Number(retailPrice) * (1 - discountRate));
}

/** Parse YYYY-MM-DD (or leading ISO datetime) as a calendar date — no UTC shift. */
export function parseDateOnlyParts(value: string) {
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Value for HTML date inputs from a DB date, ISO string, or Date object. */
export function toDateInputValue(value: string | Date | null | undefined) {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    // Postgres DATE values often deserialize as UTC midnight.
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  const parts = parseDateOnlyParts(String(value));
  if (!parts) return "";
  const { year, month, day } = parts;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Today's date in local time for HTML date inputs. */
export function todayDateInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function formatDate(value: string | Date | null | undefined) {
  const iso = toDateInputValue(value);
  if (!iso) return "—";
  const parts = parseDateOnlyParts(iso);
  if (!parts) return "—";
  const date = new Date(parts.year, parts.month - 1, parts.day);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function purchaserFromEmail(email: string | undefined): "Jess" | "Molly" | null {
  if (!email) return null;
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.includes("jess")) return "Jess";
  if (local.includes("molly")) return "Molly";
  return null;
}

export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export interface MonthlyTaxDue {
  monthKey: string;
  label: string;
  amount: number;
  jess: number;
  molly: number;
}

type TaxDueEntry = {
  entry_date: string;
  tax_amount: number;
  purchaser?: "Jess" | "Molly" | string | null;
  sales_and_use_tax_paid?: boolean;
  sand_u_tax_paid?: boolean;
  wholesale_retail?: "wholesale" | "retail";
  clients?: { name?: string } | null;
  id?: string;
};

export function isSalesUseTaxPaid(entry: TaxDueEntry) {
  return Boolean(entry.sales_and_use_tax_paid ?? entry.sand_u_tax_paid);
}

function isUnpaidSalesUseTax(entry: TaxDueEntry) {
  return !isSalesUseTaxPaid(entry);
}

function taxPurchaserBucket(
  purchaser: string | null | undefined
): "Jess" | "Molly" | null {
  if (!purchaser) return null;
  const normalized = purchaser.trim().toLowerCase();
  if (normalized === "jess") return "Jess";
  if (normalized === "molly") return "Molly";
  return null;
}

export function getSalesUseTaxLineItems(entries: TaxDueEntry[]) {
  return entries
    .filter(
      (entry) =>
        entry.wholesale_retail !== "retail" && Number(entry.tax_amount) > 0
    )
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
}

export function getPaidSalesUseTaxLineItems(entries: TaxDueEntry[]) {
  return getSalesUseTaxLineItems(entries).filter(isSalesUseTaxPaid);
}

export function groupTaxDueByMonth(entries: TaxDueEntry[]): MonthlyTaxDue[] {
  return groupSalesUseTaxByMonth(entries, isUnpaidSalesUseTax);
}

export function groupTaxPaidByMonth(entries: TaxDueEntry[]): MonthlyTaxDue[] {
  return groupSalesUseTaxByMonth(entries, isSalesUseTaxPaid);
}

function groupSalesUseTaxByMonth(
  entries: TaxDueEntry[],
  includeEntry: (entry: TaxDueEntry) => boolean
): MonthlyTaxDue[] {
  const byMonth = new Map<string, { amount: number; jess: number; molly: number }>();

  for (const entry of entries) {
    if (!includeEntry(entry)) continue;
    const monthKey = entry.entry_date.slice(0, 7);
    const tax = Number(entry.tax_amount) || 0;
    if (tax === 0) continue;
    const row = byMonth.get(monthKey) ?? { amount: 0, jess: 0, molly: 0 };
    row.amount = roundMoney(row.amount + tax);
    const purchaser = taxPurchaserBucket(entry.purchaser);
    if (purchaser === "Jess") row.jess = roundMoney(row.jess + tax);
    else if (purchaser === "Molly") row.molly = roundMoney(row.molly + tax);
    byMonth.set(monthKey, row);
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, totals]) => ({
      monthKey,
      label: new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "long",
      }).format(new Date(`${monthKey}-01T12:00:00`)),
      amount: totals.amount,
      jess: totals.jess,
      molly: totals.molly,
    }));
}
