import type {
  CreditDebit,
  LedgerDbRow,
  LedgerEntry,
  LedgerInsert,
  PaymentType,
  Purchaser,
  WholesaleRetail,
} from "./types";
import { calculateTaxFromCustomerPrice } from "./utils";

export type { LedgerDbRow, LedgerInsert };

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
  ADD COLUMN IF NOT EXISTS write_off BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS write_off_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ledger_paid ON ledger(paid);
CREATE INDEX IF NOT EXISTS idx_ledger_write_off ON ledger(write_off);

NOTIFY pgrst, 'reload schema';`;

export const WRITE_OFF_DB_SETUP_SQL = `ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS write_off BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS write_off_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ledger_write_off ON ledger(write_off);

NOTIFY pgrst, 'reload schema';`;

export function normalizeLedgerRow(
  row: LedgerDbRow | Record<string, unknown>
): LedgerEntry {
  const r = row as LedgerDbRow & Record<string, unknown>;
  return {
    id: r.id as string,
    entry_date: r.entry_date,
    designer_cost: Number(r.cost ?? r.designer_cost ?? 0),
    quantity: Number(r.quantity ?? 1),
    credit_debit: r.credit_debit,
    description: r.description,
    wholesale_retail: r.wholesale_retail,
    trade_partner_id: r.trade_partner_id,
    discount_percent: Number(r.discount_amount ?? r.discount_percent ?? 0),
    shipping_receiving_amount: Number(r.shipping_receiving_amount ?? 0),
    retail_price: Number(r.retail_price ?? 0),
    tax_amount: Number(r.tax_amount ?? 0),
    invoiced: Boolean(r.invoiced ?? false),
    sales_and_use_tax_paid: Boolean(
      r.sand_u_tax_paid ?? r.sales_and_use_tax_paid ?? false
    ),
    client_id: r.client_id,
    po_number: (r.po_number as string | null)?.trim() || null,
    invoice_id: (r.invoice_id as string | null) ?? null,
    purchaser: r.purchaser,
    paid: Boolean(r.paid ?? false),
    date_paid: (r.date_paid as string | null) ?? null,
    paid_to: (r.paid_to as Purchaser | null) ?? null,
    payment_type: (r.payment_type as PaymentType | null) ?? null,
    payment_fee: Number(r.payment_fee ?? 0),
    payment_amount: Number(r.payment_amount ?? 0),
    write_off: Boolean(r.write_off ?? false),
    write_off_amount: Number(r.write_off_amount ?? 0),
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    clients: r.clients ?? null,
    trade_partners: r.trade_partners ?? null,
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
  tax_manually_edited?: boolean;
}): LedgerInsert {
  const quantity = Math.max(1, Math.round(Number(values.quantity) || 1));
  const designerCost = Number(values.designer_cost) || 0;
  const discountPercent = Number(values.discount_percent) || 0;
  const retailPrice = Number(values.retail_price) || 0;
  const tax =
    values.wholesale_retail === "wholesale"
      ? values.tax_manually_edited
        ? Number(values.tax_amount) || 0
        : calculateTaxFromCustomerPrice(retailPrice, quantity, discountPercent)
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
    shipping_receiving_amount: values.shipping_receiving_amount,
    retail_price: retailPrice,
    tax_amount: tax,
    client_id: values.client_id,
    po_number: values.po_number.trim(),
    purchaser: values.purchaser,
  };
}
