import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CashflowAccount,
  KnownPurchaser,
  LedgerEntry,
  PaymentType,
} from "./types";
import { COA_SALES_INCOME_CATEGORY } from "./coa";
import { checkingAccountForPurchaser, getLedgerTotalDesignerCost, roundMoney } from "./utils";

export {
  COA_COGS_CATEGORY,
  COA_SALES_INCOME_CATEGORY,
  isInvoiceGoodsLine,
} from "./coa";

export type PaymentCompanionFields = {
  date_paid: string | null;
  paid_to: KnownPurchaser;
  payment_type: PaymentType;
  payment_amount: number;
  payment_fee: number;
};

/** True when this row is a Sales Income companion created from an invoice payment. */
export function isPaymentCompanionRow(
  entry: Pick<LedgerEntry, "source_ledger_id" | "companion_kind">
) {
  if (!entry.source_ledger_id) return false;
  return (entry.companion_kind ?? "payment") === "payment";
}

/**
 * Goods debit is designer cost only; tax lives on its own companion row.
 * Personal use lines are bought with personal funds, so no business cash moves.
 */
export function designerCostDebitAmount(
  entry: Pick<LedgerEntry, "designer_cost" | "quantity" | "balance_sheet">
) {
  if (entry.balance_sheet) return 0;
  return getLedgerTotalDesignerCost({
    designer_cost: Number(entry.designer_cost ?? 0),
    quantity: Number(entry.quantity ?? 1),
  });
}

/** Overlay companion payment fields onto invoice lines for Payments UI / settlement. */
export function mergePaymentCompanionsOntoEntries(
  entries: LedgerEntry[],
  companions: LedgerEntry[]
): LedgerEntry[] {
  const bySource = new Map<string, LedgerEntry>();
  for (const companion of companions) {
    const sourceId = companion.source_ledger_id;
    if (!sourceId) continue;
    if (!isPaymentCompanionRow(companion)) continue;
    bySource.set(sourceId, companion);
  }

  return entries.map((entry) => {
    const companion = bySource.get(entry.id);
    if (!companion) return entry;
    return {
      ...entry,
      date_paid: companion.date_paid,
      paid_to: companion.paid_to,
      payment_type: companion.payment_type,
      payment_amount: companion.payment_amount,
      payment_fee: companion.payment_fee,
      // Keep parent paid/variance; companion cash makes balance math match Payments.
      paid:
        entry.paid ||
        roundMoney(Number(companion.payment_amount) || 0) > 0 ||
        entry.variance_accepted,
      payment_companion_id: companion.id,
    };
  });
}

export function defaultCheckingAccountForPaidTo(
  paidTo: KnownPurchaser | null | undefined
): CashflowAccount {
  return checkingAccountForPurchaser(paidTo);
}

export function buildPaymentCompanionPayload(
  parent: LedgerEntry,
  fields: PaymentCompanionFields,
  existing?: Pick<LedgerEntry, "coa_category"> | null
) {
  const paymentAmount = roundMoney(Number(fields.payment_amount) || 0);
  const paymentFee = roundMoney(Number(fields.payment_fee) || 0);
  const datePaid =
    paymentAmount > 0 ? fields.date_paid || parent.entry_date : null;
  const descriptionBase =
    parent.description?.trim() ||
    parent.clients?.name ||
    parent.invoice_id ||
    "Payment";
  const preservedCoa = existing?.coa_category?.trim() || null;

  return {
    entry_date: datePaid ?? parent.entry_date,
    designer_cost: 0,
    quantity: 1,
    credit_debit: "credit" as const,
    description: `${descriptionBase} (payment)`,
    wholesale_retail: parent.wholesale_retail ?? "retail",
    trade_partner_id: null,
    discount_percent: 0,
    shipping_receiving_amount: 0,
    receiving_amount: 0,
    retail_price: 0,
    tax_amount: 0,
    customer_price: 0,
    client_id: parent.client_id,
    po_number: parent.po_number,
    purchaser: parent.purchaser,
    department: parent.department ?? "Interior Design",
    // Keep a cashflow CoA edit (e.g. 300 Owner's Contribution) on re-save.
    coa_category: preservedCoa || COA_SALES_INCOME_CATEGORY,
    debit_amount: 0,
    credit_amount: paymentAmount,
    // Client payments hit checking for who was paid — not the purchase account
    // (which may be a credit card).
    account: defaultCheckingAccountForPaidTo(fields.paid_to),
    expense_type: null,
    invoiced: false,
    invoice_id: parent.invoice_id,
    paid: paymentAmount > 0,
    date_paid: datePaid,
    paid_to: fields.paid_to,
    payment_type: fields.payment_type,
    payment_fee: paymentFee,
    payment_amount: paymentAmount,
    expense: false,
    expense_amount: 0,
    income_statement: true,
    balance_sheet: false,
    variance_accepted: false,
    variance_amount: 0,
    variance_notes: "",
    source_ledger_id: parent.id,
    companion_kind: "payment" as const,
  };
}

/**
 * Keep payment companion description (and invoice link fields) aligned with the
 * goods parent after the parent is edited.
 */
export async function syncPaymentCompanionFromParent(
  supabase: SupabaseClient,
  parent: LedgerEntry
): Promise<string | null> {
  const descriptionBase =
    parent.description?.trim() ||
    parent.clients?.name ||
    parent.invoice_id ||
    "Payment";

  const { error } = await supabase
    .from("ledger")
    .update({
      description: `${descriptionBase} (payment)`,
      invoice_id: parent.invoice_id,
      po_number: parent.po_number,
      client_id: parent.client_id,
      purchaser: parent.purchaser,
    })
    .eq("source_ledger_id", parent.id)
    .eq("companion_kind", "payment");

  return error?.message ?? null;
}

/**
 * Remove Sales Income payment companion row(s) for a goods/services parent.
 * Used when payment is cleared or written off via variance (no cash to record).
 */
export async function deletePaymentCompanionsForParent(
  supabase: SupabaseClient,
  parentId: string,
  paymentCompanionId?: string | null
): Promise<string | null> {
  if (paymentCompanionId) {
    const { error } = await supabase
      .from("ledger")
      .delete()
      .eq("id", paymentCompanionId);
    if (error) return error.message;
  }

  // Also clear by source id in case companion_kind was never backfilled (null)
  // or payment_companion_id was missing from the merged entry.
  const { error: byKindError } = await supabase
    .from("ledger")
    .delete()
    .eq("source_ledger_id", parentId)
    .eq("companion_kind", "payment");
  if (byKindError) return byKindError.message;

  const { error: nullKindError } = await supabase
    .from("ledger")
    .delete()
    .eq("source_ledger_id", parentId)
    .is("companion_kind", null)
    .eq("credit_debit", "credit");
  if (nullKindError) return nullKindError.message;

  return null;
}
