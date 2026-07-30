import type {
  CashflowAccount,
  LedgerEntry,
  PaymentType,
  Purchaser,
} from "./types";
import { COA_SALES_INCOME_CATEGORY } from "./coa";
import { getLedgerTotalDesignerCost, roundMoney } from "./utils";

export {
  COA_COGS_CATEGORY,
  COA_SALES_INCOME_CATEGORY,
  isInvoiceGoodsLine,
} from "./coa";

export type PaymentCompanionFields = {
  date_paid: string | null;
  paid_to: Purchaser;
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
      payment_companion_id: companion.id,
    };
  });
}

export function defaultCheckingAccountForPaidTo(
  paidTo: Purchaser | null | undefined
): CashflowAccount {
  return paidTo === "Molly" ? "Checking - Molly" : "Checking - Jess";
}

export function buildPaymentCompanionPayload(
  parent: LedgerEntry,
  fields: PaymentCompanionFields
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
    retail_price: 0,
    tax_amount: 0,
    customer_price: 0,
    client_id: parent.client_id,
    po_number: parent.po_number,
    purchaser: parent.purchaser,
    department: parent.department ?? "Interior Design",
    coa_category: COA_SALES_INCOME_CATEGORY,
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
