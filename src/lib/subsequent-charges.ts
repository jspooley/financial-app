import type { SupabaseClient } from "@supabase/supabase-js";
import { COA_COGS_CATEGORY } from "./coa";
import { syncCostCompanions } from "./cost-companions";
import {
  isLedgerLineFullyPaid,
  isLedgerLineInvoiced,
  isLedgerLineUninvoiced,
  isPaidLedgerRecord,
} from "./invoice-utils";
import { normalizeLedgerRow, type LedgerDbRow } from "./ledger-db";
import type { LedgerEntry, Purchaser, PurchaserAccount } from "./types";
import { roundMoney } from "./utils";

export const LEDGER_DELIVERY_AND_ORIGIN_SETUP_SQL = `ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS delivery_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS origin_ledger_id UUID REFERENCES ledger(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_origin_ledger_id
  ON ledger(origin_ledger_id)
  WHERE origin_ledger_id IS NOT NULL;

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_origin_not_companion;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_origin_not_companion
  CHECK (origin_ledger_id IS NULL OR source_ledger_id IS NULL);

ALTER TABLE ledger DROP CONSTRAINT IF EXISTS ledger_companion_kind_check;
ALTER TABLE ledger
  ADD CONSTRAINT ledger_companion_kind_check
  CHECK (
    companion_kind IS NULL
    OR companion_kind IN (
      'payment',
      'tax',
      'shipping',
      'receiving',
      'delivery',
      'fee',
      'transfer',
      'card_reimburse'
    )
  );

NOTIFY pgrst, 'reload schema';`;

export function isMissingDeliveryOrOriginColumn(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("delivery_amount") ||
    lower.includes("origin_ledger_id") ||
    (lower.includes("companion_kind") && lower.includes("delivery"))
  );
}

/** Merchandise line this subsequent charge belongs to (itself if it is the origin). */
export function goodsLineOriginId(
  entry: Pick<LedgerEntry, "id" | "origin_ledger_id">
) {
  return entry.origin_ledger_id || entry.id;
}

export function isSubsequentChargeLine(
  entry: Pick<LedgerEntry, "origin_ledger_id" | "source_ledger_id">
) {
  return Boolean(entry.origin_ledger_id) && !entry.source_ledger_id;
}

export function canAddSubsequentCharges(entry: LedgerEntry) {
  if (entry.source_ledger_id) return false;
  if (entry.balance_sheet) return false;
  if (entry.credit_debit === "credit") return false;
  if (isSubsequentChargeLine(entry)) return false;
  if (isPaidLedgerRecord(entry) || isLedgerLineFullyPaid(entry)) return true;
  return Boolean(entry.invoiced || (entry.invoice_id ?? "").trim());
}

export function subsequentChargesForOrigin(
  entries: LedgerEntry[],
  originId: string
) {
  return entries.filter((row) => row.origin_ledger_id === originId);
}

export type SubsequentChargeAmounts = {
  shipping_receiving_amount: number;
  receiving_amount: number;
  delivery_amount: number;
  payment_fee: number;
};

export function subsequentChargeTotal(amounts: SubsequentChargeAmounts) {
  return roundMoney(
    Number(amounts.shipping_receiving_amount ?? 0) +
      Number(amounts.receiving_amount ?? 0) +
      Number(amounts.delivery_amount ?? 0) +
      Number(amounts.payment_fee ?? 0)
  );
}

export function subsequentChargeLineTotal(
  entry: Pick<
    LedgerEntry,
    | "shipping_receiving_amount"
    | "receiving_amount"
    | "delivery_amount"
    | "payment_fee"
  >
) {
  return subsequentChargeTotal({
    shipping_receiving_amount: Number(entry.shipping_receiving_amount ?? 0),
    receiving_amount: Number(entry.receiving_amount ?? 0),
    delivery_amount: Number(entry.delivery_amount ?? 0),
    payment_fee: Number(entry.payment_fee ?? 0),
  });
}

export function uninvoicedSubsequentChargeTotal(entries: LedgerEntry[]) {
  return roundMoney(
    entries
      .filter(
        (row) => isSubsequentChargeLine(row) && isLedgerLineUninvoiced(row)
      )
      .reduce((sum, row) => sum + subsequentChargeLineTotal(row), 0)
  );
}

export function groupSubsequentChargesByOrigin(entries: LedgerEntry[]) {
  const byOrigin = new Map<string, LedgerEntry[]>();
  for (const row of entries) {
    const originId = row.origin_ledger_id;
    if (!originId || row.source_ledger_id) continue;
    const list = byOrigin.get(originId) ?? [];
    list.push(row);
    byOrigin.set(originId, list);
  }
  return byOrigin;
}

export function subsequentChargeDescription(
  origin: Pick<LedgerEntry, "description" | "clients">,
  amounts: SubsequentChargeAmounts
) {
  const base = origin.description?.trim() || origin.clients?.name || "Line";
  const parts: string[] = [];
  if (roundMoney(amounts.shipping_receiving_amount) > 0) parts.push("shipping");
  if (roundMoney(amounts.receiving_amount) > 0) parts.push("receiving");
  if (roundMoney(amounts.delivery_amount) > 0) parts.push("delivery");
  if (roundMoney(amounts.payment_fee) > 0) parts.push("card fee");
  return parts.length ? `${base} (${parts.join(", ")})` : `${base} (charges)`;
}

export async function createSubsequentCharge(
  supabase: SupabaseClient,
  origin: LedgerEntry,
  values: SubsequentChargeAmounts & {
    entry_date: string;
    purchaser: Purchaser;
    account: PurchaserAccount;
  }
): Promise<{ error: string | null; missingColumn: boolean }> {
  const amounts: SubsequentChargeAmounts = {
    shipping_receiving_amount: roundMoney(values.shipping_receiving_amount),
    receiving_amount: roundMoney(values.receiving_amount),
    delivery_amount: roundMoney(values.delivery_amount),
    payment_fee: roundMoney(values.payment_fee),
  };
  if (subsequentChargeTotal(amounts) < 0.005) {
    return {
      error: "Enter at least one shipping, receiving, delivery, or card fee amount.",
      missingColumn: false,
    };
  }

  const originId = goodsLineOriginId(origin);
  const payload = {
    entry_date: values.entry_date,
    designer_cost: 0,
    quantity: 1,
    credit_debit: "debit" as const,
    description: subsequentChargeDescription(origin, amounts),
    wholesale_retail: origin.wholesale_retail ?? "retail",
    trade_partner_id: origin.trade_partner_id,
    discount_percent: 0,
    customer_price: 0,
    shipping_receiving_amount: amounts.shipping_receiving_amount,
    receiving_amount: amounts.receiving_amount,
    delivery_amount: amounts.delivery_amount,
    retail_price: 0,
    tax_amount: 0,
    client_id: origin.client_id,
    po_number: origin.po_number,
    purchaser: values.purchaser,
    account: values.account,
    department: origin.department ?? "Interior Design",
    coa_category: COA_COGS_CATEGORY,
    debit_amount: 0,
    credit_amount: 0,
    invoiced: false,
    invoice_id: null,
    paid: false,
    date_paid: null,
    paid_to: null,
    payment_type: null,
    payment_fee: amounts.payment_fee,
    payment_amount: 0,
    expense: false,
    expense_amount: 0,
    income_statement: true,
    balance_sheet: false,
    variance_accepted: false,
    variance_amount: 0,
    variance_notes: "",
    origin_ledger_id: originId,
    source_ledger_id: null,
    companion_kind: null,
  };

  const { data, error } = await supabase
    .from("ledger")
    .insert(payload)
    .select("*, clients(name)")
    .single();

  if (error) {
    return {
      error: error.message,
      missingColumn: isMissingDeliveryOrOriginColumn(error.message),
    };
  }

  const saved = normalizeLedgerRow(data as LedgerDbRow & Record<string, unknown>);
  const companionError = await syncCostCompanions(supabase, saved, {
    paymentFee: amounts.payment_fee,
  });
  if (companionError) {
    return {
      error: companionError,
      missingColumn: isMissingDeliveryOrOriginColumn(companionError),
    };
  }

  return { error: null, missingColumn: false };
}

export async function deleteSubsequentCharge(
  supabase: SupabaseClient,
  entry: LedgerEntry
): Promise<{ error: string | null }> {
  if (!isSubsequentChargeLine(entry)) {
    return { error: "This is not a subsequent charge line." };
  }
  if (isLedgerLineInvoiced(entry)) {
    return { error: "Invoiced charges cannot be deleted here." };
  }
  const { error } = await supabase.from("ledger").delete().eq("id", entry.id);
  return { error: error?.message ?? null };
}
