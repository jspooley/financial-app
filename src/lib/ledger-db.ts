import type {
  CreditDebit,
  LedgerDbRow,
  LedgerEntry,
  LedgerInsert,
  PaymentType,
  Purchaser,
  WholesaleRetail,
} from "./types";
import { deriveLedgerPaidFlag } from "./invoice-utils";
import { calculateTaxFromCustomerPrice, calculateCustomerPrice, normalizeQuantity } from "./utils";

export type { LedgerDbRow, LedgerInsert };

type LedgerUpdateClient = {
  from: (table: string) => {
    update: (payload: Record<string, boolean>) => {
      eq: (
        column: string,
        value: string
      ) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

export const PAYMENTS_DB_SETUP_SQL = `ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS date_paid DATE;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS paid_to purchaser_type;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS payment_type TEXT;

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_payment_type_check;

ALTER TABLE ledger
  ADD CONSTRAINT ledger_payment_type_check
  CHECK (payment_type IS NULL OR payment_type IN ('Cash', 'Check', 'CC', 'Venmo', 'Other'));

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS payment_fee NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS expense BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS expense_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ledger_paid ON ledger(paid);
CREATE INDEX IF NOT EXISTS idx_ledger_expense ON ledger(expense);

NOTIFY pgrst, 'reload schema';`;

export const EXPENSE_DB_SETUP_SQL = `ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS expense BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS expense_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ledger_expense ON ledger(expense);

NOTIFY pgrst, 'reload schema';`;

export function normalizeLedgerRow(
  row: LedgerDbRow | Record<string, unknown>
): LedgerEntry {
  const r = row as LedgerDbRow & Record<string, unknown>;
  return {
    id: r.id as string,
    entry_date: r.entry_date,
    designer_cost: Number(r.cost ?? r.designer_cost ?? 0),
    quantity: normalizeQuantity(Number(r.quantity ?? 1)),
    credit_debit: r.credit_debit,
    description: r.description,
    wholesale_retail: r.wholesale_retail,
    trade_partner_id: r.trade_partner_id,
    discount_percent: Number(r.discount_percent ?? r.discount_amount ?? 0),
    shipping_receiving_amount: Number(r.shipping_receiving_amount ?? 0),
    retail_price: Number(r.retail_price ?? 0),
    tax_amount: Number(r.tax_amount ?? 0),
    customer_price: Number(r.customer_price ?? 0),
    invoiced: Boolean(r.invoiced ?? false),
    sales_and_use_tax_paid: Boolean(
      r.sand_u_tax_paid ?? r.sales_and_use_tax_paid ?? false
    ),
    client_id: r.client_id,
    po_number: (r.po_number as string | null)?.trim() || null,
    invoice_id: ((r.invoice_id as string | null) ?? "").trim() || null,
    purchaser: r.purchaser,
    paid: Boolean(r.paid ?? false),
    date_paid: (r.date_paid as string | null) ?? null,
    paid_to: (r.paid_to as Purchaser | null) ?? null,
    payment_type: (r.payment_type as PaymentType | null) ?? null,
    payment_fee: Number(r.payment_fee ?? 0),
    payment_amount: Number(r.payment_amount ?? 0),
    expense: Boolean(r.expense ?? false),
    expense_amount: Number(r.expense_amount ?? 0),
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    clients: r.clients ?? null,
    trade_partners: r.trade_partners ?? null,
  };
}

/** Update sales/use tax paid flag; tries both possible column names in the DB. */
export async function updateLedgerSalesUseTaxPaid(
  supabase: LedgerUpdateClient,
  id: string,
  paid: boolean
): Promise<{ error: { message: string } | null }> {
  const payloads = [
    { sales_and_use_tax_paid: paid },
    { sand_u_tax_paid: paid },
  ] as Record<string, boolean>[];
  for (const payload of payloads) {
    const { error } = await supabase.from("ledger").update(payload).eq("id", id);
    if (!error) return { error: null };
    const msg = error.message.toLowerCase();
    if (msg.includes("column") || msg.includes("schema cache")) continue;
    return { error };
  }
  return {
    error: {
      message:
        "Could not update Sales and Use Tax Paid. Run migration 019 or 006 in Supabase.",
    },
  };
}

/** Maps editable form values to DB columns for insert/update. */
export function ledgerFormToDb(values: {
  entry_date: string;
  designer_cost: number;
  quantity: number;
  credit_debit: CreditDebit;
  description?: string;
  wholesale_retail: WholesaleRetail;
  trade_partner_id?: string;
  discount_percent: number;
  shipping_receiving_amount: number;
  retail_price: number;
  tax_amount: number;
  client_id: string;
  po_number: string;
  purchaser: Purchaser;
}): LedgerInsert & { customer_price: number } {
  const quantity = normalizeQuantity(Number(values.quantity) || 1);
  const designerCost = Number(values.designer_cost) || 0;
  const discountPercent = Number(values.discount_percent) || 0;
  const retailPrice = Number(values.retail_price) || 0;
  const merchandise = calculateCustomerPrice(retailPrice, quantity, discountPercent);
  const tax =
    values.wholesale_retail === "wholesale"
      ? calculateTaxFromCustomerPrice(retailPrice, quantity, discountPercent)
      : 0;

  return {
    entry_date: values.entry_date,
    designer_cost: designerCost,
    quantity,
    credit_debit: values.credit_debit,
    description: values.description || null,
    wholesale_retail: values.wholesale_retail,
    trade_partner_id: values.trade_partner_id || null,
    discount_percent: discountPercent,
    customer_price: merchandise,
    shipping_receiving_amount: values.shipping_receiving_amount,
    retail_price: retailPrice,
    tax_amount: tax,
    client_id: values.client_id,
    po_number: values.po_number.trim(),
    purchaser: values.purchaser,
  };
}

type LedgerPaidSyncClient = {
  from: (table: string) => {
    select: (columns: string) => PromiseLike<{
      data: Array<Record<string, unknown>> | null;
      error: { message: string } | null;
    }>;
    update: (payload: { paid: boolean }) => {
      eq: (
        column: string,
        value: string
      ) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

/** Recompute and persist paid flags from balance math for all debit lines. */
export async function syncAllLedgerPaidFlags(
  supabase: LedgerPaidSyncClient
): Promise<{ updated: number; error: string | null }> {
  const { data, error } = await supabase.from("ledger").select("*");
  if (error) return { updated: 0, error: error.message };

  let updated = 0;
  for (const row of data ?? []) {
    const entry = normalizeLedgerRow(row);
    if (entry.credit_debit !== "debit") continue;
    const paid = deriveLedgerPaidFlag(entry);
    if (paid === entry.paid) continue;
    const { error: updateError } = await supabase
      .from("ledger")
      .update({ paid })
      .eq("id", entry.id);
    if (updateError) return { updated, error: updateError.message };
    updated += 1;
  }
  return { updated, error: null };
}
