import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanionKind, LedgerEntry } from "./types";
import { roundMoney } from "./utils";

export const COA_TAXES_CATEGORY = "214 Taxes and licenses";
export const COA_FEES_CATEGORY = "203 commissions and fees";

/**
 * Cost companions mirror a parent cost so it carries its own CoA Category.
 * S&U tax is deliberately absent: it is collected from the client and remitted
 * to the state later, so it is entered on Cashflow as one monthly payment
 * rather than as a purchase-dated debit (migration 063).
 */
export const COST_COMPANION_KINDS = ["shipping", "fee"] as const;

export type CostCompanionKind = (typeof COST_COMPANION_KINDS)[number];

const COST_COMPANION_CONFIG: Record<
  CostCompanionKind,
  { coaCategory: string; suffix: string }
> = {
  shipping: { coaCategory: COA_FEES_CATEGORY, suffix: "shipping" },
  fee: { coaCategory: COA_FEES_CATEGORY, suffix: "payment fee" },
};

export function isCostCompanionRow(
  entry: Pick<LedgerEntry, "companion_kind">
): boolean {
  return (COST_COMPANION_KINDS as readonly string[]).includes(
    entry.companion_kind ?? ""
  );
}

export function isPaymentCompanionKind(kind: CompanionKind | null | undefined) {
  return kind === "payment";
}

/**
 * Cost amounts owed a companion row. Fees can arrive from the payment
 * companion, so the caller passes the effective fee for the parent.
 */
export function costCompanionAmounts(
  parent: Pick<LedgerEntry, "shipping_receiving_amount">,
  paymentFee: number
): Record<CostCompanionKind, number> {
  return {
    shipping: roundMoney(Number(parent.shipping_receiving_amount ?? 0)),
    fee: roundMoney(Number(paymentFee) || 0),
  };
}

/**
 * Companion payload. The amount lives in debit_amount only — tax_amount,
 * shipping_receiving_amount, and payment_fee stay zero here so invoiced totals
 * and S&U tax reporting keep reading the parent.
 */
export function buildCostCompanionPayload(
  parent: LedgerEntry,
  kind: CostCompanionKind,
  amount: number,
  entryDate?: string | null
) {
  const config = COST_COMPANION_CONFIG[kind];
  const descriptionBase =
    parent.description?.trim() || parent.clients?.name || "Line";

  return {
    entry_date: entryDate || parent.entry_date,
    designer_cost: 0,
    quantity: 1,
    credit_debit: "debit" as const,
    description: `${descriptionBase} (${config.suffix})`,
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
    coa_category: config.coaCategory,
    // Personal use costs are funded personally — no business cash moves.
    debit_amount: parent.balance_sheet ? 0 : roundMoney(amount),
    credit_amount: 0,
    account: parent.account,
    expense_type: null,
    invoiced: false,
    invoice_id: parent.invoice_id,
    paid: false,
    date_paid: null,
    paid_to: null,
    payment_type: null,
    payment_fee: 0,
    payment_amount: 0,
    expense: false,
    expense_amount: 0,
    income_statement: true,
    balance_sheet: Boolean(parent.balance_sheet),
    variance_accepted: false,
    variance_amount: 0,
    variance_notes: "",
    source_ledger_id: parent.id,
    companion_kind: kind,
  };
}

/**
 * Creates, updates, or removes tax / shipping / fee companions so they match
 * the parent's current costs. Returns an error message when a write fails.
 */
export async function syncCostCompanions(
  supabase: SupabaseClient,
  parent: LedgerEntry,
  options?: { paymentFee?: number; entryDateByKind?: Partial<Record<CostCompanionKind, string | null>> }
): Promise<string | null> {
  // Personal-use purchases are funded outside the business — no cost companions.
  const paymentFee = parent.balance_sheet
    ? 0
    : (options?.paymentFee ?? Number(parent.payment_fee ?? 0));
  const amounts = parent.balance_sheet
    ? { shipping: 0, fee: 0 }
    : costCompanionAmounts(parent, paymentFee);

  const { data: existing, error: loadError } = await supabase
    .from("ledger")
    .select("id, companion_kind, debit_amount")
    .eq("source_ledger_id", parent.id)
    .in("companion_kind", [...COST_COMPANION_KINDS]);

  if (loadError) return loadError.message;

  const byKind = new Map<string, { id: string; debit_amount: number }>();
  for (const row of (existing ?? []) as Array<{
    id: string;
    companion_kind: string;
    debit_amount: number | null;
  }>) {
    byKind.set(row.companion_kind, {
      id: row.id,
      debit_amount: Number(row.debit_amount ?? 0),
    });
  }

  for (const kind of COST_COMPANION_KINDS) {
    const amount = amounts[kind];
    const current = byKind.get(kind);

    if (amount <= 0) {
      if (current) {
        const { error } = await supabase
          .from("ledger")
          .delete()
          .eq("id", current.id);
        if (error) return error.message;
      }
      continue;
    }

    const payload = buildCostCompanionPayload(
      parent,
      kind,
      amount,
      options?.entryDateByKind?.[kind] ?? null
    );

    const { error } = current
      ? await supabase.from("ledger").update(payload).eq("id", current.id)
      : await supabase.from("ledger").insert(payload);
    if (error) return error.message;
  }

  return null;
}
