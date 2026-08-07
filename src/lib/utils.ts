import type { PaymentType, TradePartner } from "./types";

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

/**
 * Normalize S&U tax input to a decimal rate (e.g. 0.0600).
 * Accepts percent points (6 or 6.5) or decimal rates (0.06 or 0.065).
 * Values greater than 1 are treated as percent points.
 */
export function normalizeSandUTaxRate(input: number) {
  if (!Number.isFinite(input) || input < 0) return NaN;
  const rate = input > 1 ? input / 100 : input;
  return Math.round(rate * 10000) / 10000;
}

/** Convert a stored decimal tax rate to percent points for form display (0.06 → 6). */
export function sandUTaxRateToPercentInput(rate: number) {
  if (!Number.isFinite(rate)) return 0;
  return Math.round(rate * 100 * 10000) / 10000;
}

/** Format a stored decimal tax rate for display (0.06 → "6.00%"). */
export function formatSandUTaxPercent(rate: number) {
  return `${sandUTaxRateToPercentInput(Number(rate) || 0).toFixed(2)}%`;
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

/** Sales/use tax: customer price × qty × client sand_u_tax rate (after discount). */
export function calculateTaxFromCustomerPrice(
  retailPrice: number,
  quantity: number,
  discountPercent: number,
  taxRate: number
) {
  const rate = Number(taxRate) || 0;
  return roundMoney(
    calculateCustomerPrice(retailPrice, quantity, discountPercent) * rate
  );
}

/** Discounted retail subtotal: retail price × (1 − discount %) × qty.
 * Retail with no trade partner: discount_percent is markup; customer pays full retail × qty.
 * Service lines use the same discount-off-retail math as wholesale (0% = full retail). */
export function getLedgerMerchandiseAmount(entry: {
  retail_price: number;
  quantity: number;
  discount_percent: number;
  designer_cost?: number;
  wholesale_retail?: "wholesale" | "retail" | "service";
  trade_partner_id?: string | null;
}) {
  const qty = normalizeQuantity(entry.quantity);
  // No-trade-partner retail: markup is stored in discount_percent; do not markdown.
  if (
    entry.wholesale_retail === "retail" &&
    !(entry.trade_partner_id ?? "").trim()
  ) {
    return roundMoney(Number(entry.retail_price) * qty);
  }
  const retailSubtotal = Number(entry.retail_price) * qty;
  const discountAmount = (Number(entry.discount_percent) / 100) * retailSubtotal;
  return roundMoney(retailSubtotal - discountAmount);
}

/** Discounted retail only: retail price × (1 − discount %) × qty.
 * No-trade-partner retail uses full retail (markup lives in discount_percent). */
export function getLedgerCustomerPrice(entry: {
  retail_price: number;
  quantity: number;
  discount_percent: number;
  customer_price?: number | null;
  designer_cost?: number;
  wholesale_retail?: "wholesale" | "retail" | "service";
  trade_partner_id?: string | null;
}) {
  if (
    entry.wholesale_retail === "retail" &&
    !(entry.trade_partner_id ?? "").trim()
  ) {
    return getLedgerMerchandiseAmount(entry);
  }
  const discountPercent = Number(entry.discount_percent) || 0;
  if (discountPercent > 0) {
    return getLedgerMerchandiseAmount({
      retail_price: entry.retail_price,
      quantity: entry.quantity,
      discount_percent: discountPercent,
      wholesale_retail: entry.wholesale_retail,
      trade_partner_id: entry.trade_partner_id,
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
    wholesale_retail: entry.wholesale_retail,
    trade_partner_id: entry.trade_partner_id,
  });
}

/** Customer price × qty + tax + shipping + fee — used for invoice and payment line totals.
 * Personal use (balance sheet) lines invoice tax amount only. */
export function getLedgerInvoicedAmount(entry: {
  retail_price: number;
  quantity: number;
  discount_percent?: number;
  customer_price?: number | null;
  tax_amount?: number;
  shipping_receiving_amount?: number;
  wholesale_retail?: "wholesale" | "retail" | "service";
  payment_fee?: number;
  balance_sheet?: boolean | null;
  designer_cost?: number;
  trade_partner_id?: string | null;
}) {
  const wholesaleRetail = entry.wholesale_retail ?? "retail";
  const tax =
    wholesaleRetail === "wholesale" ? Number(entry.tax_amount) || 0 : 0;

  if (entry.balance_sheet) {
    return roundMoney(tax);
  }

  const shipping = Number(entry.shipping_receiving_amount) || 0;
  const fee = Number(entry.payment_fee ?? 0);
  return roundMoney(
    getLedgerCustomerPrice({
      retail_price: entry.retail_price,
      quantity: entry.quantity,
      discount_percent: entry.discount_percent ?? 0,
      customer_price: entry.customer_price,
      wholesale_retail: wholesaleRetail,
      designer_cost: entry.designer_cost,
      trade_partner_id: entry.trade_partner_id,
    }) +
      tax +
      shipping +
      fee
  );
}

/** Client invoice total without payment processing fee (fee is shown separately on Payments). */
export function getLedgerInvoicedAmountExcludingPaymentFee(
  entry: Parameters<typeof getLedgerInvoicedAmount>[0]
) {
  return getLedgerInvoicedAmount({ ...entry, payment_fee: 0 });
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

/** (Designer cost × qty) + tax. */
export function getLedgerDesignerCostWithExtras(entry: {
  designer_cost?: number | null;
  quantity?: number | null;
  tax_amount?: number | null;
}) {
  return roundMoney(
    getLedgerTotalDesignerCost({
      designer_cost: Number(entry.designer_cost ?? 0),
      quantity: Number(entry.quantity ?? 1),
    }) + Number(entry.tax_amount ?? 0)
  );
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
  client_id?: string | null;
  po_number?: string | null;
  designer_cost: number;
  retail_price: number;
  quantity: number;
  credit_debit: "credit" | "debit";
  invoiced?: boolean;
  invoice_id?: string | null;
  discount_percent?: number;
  customer_price?: number | null;
  tax_amount?: number;
  shipping_receiving_amount?: number;
  wholesale_retail?: "wholesale" | "retail" | "service";
  payment_fee?: number;
  payment_amount?: number;
  balance_sheet?: boolean | null;
  source_ledger_id?: string | null;
};

/** Billed amount (excl. payment fee) — used for reconciliation vs payments, not P&L revenue. */
export function ledgerLineBilledAmount(
  entry: LedgerBalanceEntry,
  invoicedPoKeys?: Set<string>
) {
  if (entry.source_ledger_id) return 0;
  if (!isInvoicedForBalance(entry, invoicedPoKeys)) return 0;
  return getLedgerInvoicedAmountExcludingPaymentFee({
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
    trade_partner_id: undefined,
  });
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

/** Whether a ledger line is an invoiced goods/services parent (not a companion). */
export function isLedgerLineInvoicedForRevenue(
  entry: LedgerBalanceEntry,
  invoicedPoKeys?: Set<string>
) {
  if (entry.source_ledger_id) return false;
  return isInvoicedForBalance(entry, invoicedPoKeys);
}

/** P&L revenue: cash actually received (payment_amount). No payment → no revenue. */
export function ledgerLineRevenue(
  entry: LedgerBalanceEntry,
  _invoicedPoKeys?: Set<string>
) {
  // Payment cash is merged onto the parent; skip companion rows to avoid double-counting.
  if (entry.source_ledger_id) return 0;
  return roundMoney(Math.max(0, Number(entry.payment_amount ?? 0)));
}

/** COGS for one ledger line (P&L): designer cost when invoiced or uninvoiced debit, else 0. */
export function ledgerLineCogs(
  entry: LedgerBalanceEntry,
  invoicedPoKeys?: Set<string>
) {
  if (entry.source_ledger_id) return 0;
  const designerTotal = getLedgerTotalDesignerCost(entry);
  if (isInvoicedForBalance(entry, invoicedPoKeys)) return designerTotal;
  if (entry.credit_debit === "debit") return designerTotal;
  return 0;
}

/**
 * Credits = cash received (payment_amount). Debits = designer cost (COGS).
 * Companion rows are skipped (payment is counted on the merged parent).
 */
export function sumLedgerCreditsAndDebits(
  entries: LedgerBalanceEntry[],
  options?: { invoicedPoKeys?: Set<string> }
) {
  return entries.reduce(
    (acc, entry) => {
      if (entry.source_ledger_id) return acc;

      const designerTotal = getLedgerTotalDesignerCost(entry);
      const revenue = ledgerLineRevenue(entry);

      if (isInvoicedForBalance(entry, options?.invoicedPoKeys)) {
        acc.credits += revenue;
        acc.debits += designerTotal;
        return acc;
      }

      // Uninvoiced: still count cash if present; COGS for debits.
      acc.credits += revenue;
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

/** Markup % from cost to retail: ((retail − designer) ÷ designer) × 100 */
export function calculateMarkupPercentFromPricing(
  retailPrice: number,
  designerCost: number
) {
  const designer = Number(designerCost);
  if (designer <= 0) return 0;
  return roundMoney(((Number(retailPrice) - designer) / designer) * 100);
}

export function tradePartnerDiscountPercent(
  partner: Pick<TradePartner, "retail_price" | "designer_cost" | "discount_amount">
): number {
  const retail = Number(partner.retail_price ?? 0);
  const designer = Number(partner.designer_cost ?? 0);
  if (retail > 0) {
    return calculateTradeDiscountPercentFromPricing(retail, designer);
  }
  return Number(partner.discount_amount ?? 0);
}

export function averageTradePartnerDiscount(
  partners: Pick<TradePartner, "retail_price" | "designer_cost" | "discount_amount">[]
): number {
  if (partners.length === 0) return 0;
  const total = partners.reduce(
    (sum, partner) => sum + tradePartnerDiscountPercent(partner),
    0
  );
  return roundMoney(total / partners.length);
}

export function grossProfitGoalFromTradePartners(
  partners: Pick<TradePartner, "retail_price" | "designer_cost" | "discount_amount">[]
): number {
  return defaultLedgerDiscountPercent(averageTradePartnerDiscount(partners));
}

/** Unit designer cost from retail and trade discount %: retail × (1 − discount/100). */
export function calculateDesignerCostFromTradePartner(
  retailPrice: number,
  tradePartnerDiscountPercent: number
) {
  const discountRate = Number(tradePartnerDiscountPercent) / 100;
  return roundMoney(Number(retailPrice) * (1 - discountRate));
}

/** Unit retail price from designer cost and trade discount %: designer ÷ (1 − discount/100). */
export function calculateRetailPriceFromTradePartner(
  designerCost: number,
  tradePartnerDiscountPercent: number
) {
  const cost = Number(designerCost);
  if (cost <= 0) return 0;
  const discountRate = Number(tradePartnerDiscountPercent) / 100;
  const divisor = 1 - discountRate;
  if (divisor <= 0) return 0;
  return roundMoney(cost / divisor);
}

/** Unit retail from designer markup %: designer × (1 + markup/100). */
export function calculateRetailPriceFromMarkup(
  designerCost: number,
  markupPercent: number
) {
  return roundMoney(
    Math.max(0, Number(designerCost) || 0) *
      (1 + Math.max(0, Number(markupPercent) || 0) / 100)
  );
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

/** Value for HTML time inputs from a DB TIME string (HH:MM[:SS]). */
export function toTimeInputValue(value: string | null | undefined) {
  if (value == null || value === "") return "";
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

/** Current local time for HTML time inputs (HH:MM). */
export function nowTimeInputValue() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
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

/** Format a DB TIME / HH:MM value for display (e.g. 2:30 PM). */
export function formatTime(value: string | null | undefined) {
  const hhmm = toTimeInputValue(value);
  if (!hhmm) return "—";
  const [hoursRaw, minutes] = hhmm.split(":");
  const hours = Number(hoursRaw);
  if (Number.isNaN(hours) || minutes == null) return "—";
  const date = new Date();
  date.setHours(hours, Number(minutes), 0, 0);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Date and optional time together for appointment lists. */
export function formatDateTime(
  dateValue: string | Date | null | undefined,
  timeValue?: string | null
) {
  const date = formatDate(dateValue);
  if (date === "—") return "—";
  const time = formatTime(timeValue);
  if (time === "—") return date;
  return `${date} · ${time}`;
}

export function purchaserFromEmail(email: string | undefined): "Jess" | "Molly" | null {
  if (!email) return null;
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.includes("jess")) return "Jess";
  if (local.includes("molly")) return "Molly";
  return null;
}

/** Checking register for the given purchaser (Jess / Molly). */
export function checkingAccountForPurchaser(
  purchaser: "Jess" | "Molly" | null | undefined
): "Checking - Jess" | "Checking - Molly" {
  return purchaser === "Molly" ? "Checking - Molly" : "Checking - Jess";
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
  wholesale_retail?: "wholesale" | "retail" | "service";
  balance_sheet?: boolean | null;
  income_statement?: boolean | null;
  clients?: { name?: string } | null;
  id?: string;
};

export function isSalesUseTaxPaid(entry: TaxDueEntry) {
  return Boolean(entry.sales_and_use_tax_paid ?? entry.sand_u_tax_paid);
}

/** Tax source for reporting: Bal Sheet - Personal vs Income Statement. */
export function salesUseTaxStatementType(
  entry: Pick<TaxDueEntry, "balance_sheet" | "income_statement">
): "Bal Sheet - Personal" | "Income Statement" {
  if (entry.balance_sheet) return "Bal Sheet - Personal";
  return "Income Statement";
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
        entry.wholesale_retail === "wholesale" && Number(entry.tax_amount) > 0
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
