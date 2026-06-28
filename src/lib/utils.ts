export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
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

/** Sales/use tax: retail price × quantity × 0.06 */
export function calculateTaxFromRetailPrice(retailPrice: number, quantity: number) {
  const qty = Math.max(1, Math.round(Number(quantity) || 1));
  return roundMoney(Number(retailPrice) * qty * 0.06);
}

/** Discounted retail subtotal: (retail × qty) − (discount% × retail × qty) */
export function getLedgerMerchandiseAmount(entry: {
  retail_price: number;
  quantity: number;
  discount_percent: number;
}) {
  const qty = Math.max(1, Math.round(Number(entry.quantity) || 1));
  const retailSubtotal = Number(entry.retail_price) * qty;
  const discountAmount = (Number(entry.discount_percent) / 100) * retailSubtotal;
  return roundMoney(retailSubtotal - discountAmount);
}

/** Discounted retail only: (retail × qty) − (discount% × retail × qty) */
export function getLedgerCustomerPrice(entry: {
  retail_price: number;
  quantity: number;
  discount_percent: number;
}) {
  return getLedgerMerchandiseAmount(entry);
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

/** Customer price + tax + shipping + payment fee. */
export function getLedgerInvoicedAmount(entry: {
  retail_price: number;
  quantity: number;
  discount_percent: number;
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
  const qty = Math.max(1, Math.round(Number(entry.quantity) || 1));
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

export function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
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

export function groupTaxDueByMonth(entries: TaxDueEntry[]): MonthlyTaxDue[] {
  const byMonth = new Map<string, { amount: number; jess: number; molly: number }>();

  for (const entry of entries) {
    if (!isUnpaidSalesUseTax(entry)) continue;
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
