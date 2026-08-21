import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cashflowClassificationFlags,
  isPartnerToPartnerTransferCoa,
} from "@/lib/coa";
import type { CashflowAccount, LedgerEntry, Purchaser } from "@/lib/types";
import { checkingAccountForPurchaser, roundMoney } from "@/lib/utils";

export const TRANSFER_COMPANION_KIND = "transfer" as const;

export function isPartnerTransferMateRow(
  entry: Pick<LedgerEntry, "companion_kind" | "source_ledger_id">
) {
  return (
    entry.companion_kind === TRANSFER_COMPANION_KIND &&
    Boolean(entry.source_ledger_id)
  );
}

export function isPartnerTransferParentRow(
  entry: Pick<
    LedgerEntry,
    "account" | "purchaser" | "paid_to" | "coa_category" | "source_ledger_id"
  >
) {
  return !entry.source_ledger_id && partnerTransferCounterparty(entry) != null;
}

function otherPartner(party: Purchaser): Purchaser {
  return party === "Molly" ? "Jess" : "Molly";
}

function ownerFromEntry(
  entry: Pick<LedgerEntry, "account" | "purchaser">
): Purchaser {
  const account = entry.account ?? "";
  if (account.includes("Molly")) return "Molly";
  if (account.includes("Jess")) return "Jess";
  return entry.purchaser === "Molly" ? "Molly" : "Jess";
}

/** Other partner on a 303/304 (or Paid To) transfer, if this row should have a mate. */
export function partnerTransferCounterparty(
  entry: Pick<LedgerEntry, "account" | "purchaser" | "paid_to" | "coa_category">
): Purchaser | null {
  const owner = ownerFromEntry(entry);
  if (isPartnerToPartnerTransferCoa(entry.coa_category)) {
    return otherPartner(owner);
  }
  if (
    (entry.paid_to === "Jess" || entry.paid_to === "Molly") &&
    entry.paid_to !== owner
  ) {
    return entry.paid_to;
  }
  return null;
}

export function buildPartnerTransferMatePayload(
  parent: LedgerEntry,
  counterparty: Purchaser
) {
  const debit = roundMoney(Number(parent.credit_amount ?? 0));
  const credit = roundMoney(Number(parent.debit_amount ?? 0));
  const account = checkingAccountForPurchaser(counterparty) as CashflowAccount;
  return {
    entry_date: parent.entry_date,
    designer_cost: 0,
    quantity: 1,
    credit_debit: credit >= debit ? ("credit" as const) : ("debit" as const),
    description: parent.description,
    wholesale_retail: parent.wholesale_retail ?? "retail",
    trade_partner_id: null,
    discount_percent: 0,
    shipping_receiving_amount: 0,
    retail_price: 0,
    tax_amount: 0,
    customer_price: 0,
    client_id: parent.client_id,
    po_number: parent.po_number,
    purchaser: counterparty,
    department: parent.department ?? "Interior Design",
    coa_category: parent.coa_category,
    debit_amount: debit,
    credit_amount: credit,
    account,
    expense_type: null,
    invoiced: false,
    invoice_id: parent.invoice_id,
    paid: false,
    date_paid: null,
    paid_to: ownerFromEntry(parent),
    payment_type: null,
    payment_fee: 0,
    payment_amount: 0,
    expense_amount: 0,
    ...cashflowClassificationFlags(parent.coa_category ?? ""),
    variance_accepted: false,
    variance_amount: 0,
    variance_notes: "",
    source_ledger_id: parent.id,
    companion_kind: TRANSFER_COMPANION_KIND,
  };
}

/** Display-only mate so Cashflow filters can show the other checking account. */
export function partnerTransferDisplayRow(
  parent: LedgerEntry,
  counterparty: Purchaser
): LedgerEntry {
  const debit = roundMoney(Number(parent.credit_amount ?? 0));
  const credit = roundMoney(Number(parent.debit_amount ?? 0));
  return {
    ...parent,
    id: `transfer-mate:${parent.id}`,
    source_ledger_id: parent.id,
    companion_kind: TRANSFER_COMPANION_KIND,
    purchaser: counterparty,
    paid_to: ownerFromEntry(parent),
    account: checkingAccountForPurchaser(counterparty),
    debit_amount: debit,
    credit_amount: credit,
    credit_debit: credit >= debit ? "credit" : "debit",
    designer_cost: 0,
    payment_amount: 0,
    payment_fee: 0,
  };
}

/**
 * Jess→Molly (and the reverse) is stored as one ledger row. Append the other
 * checking side in memory when a persisted transfer companion is not already
 * in the list, so account + CoA filters can see both registers.
 */
export function mergePartnerTransferDisplayMates(
  entries: LedgerEntry[]
): LedgerEntry[] {
  const hasMate = new Set<string>();
  for (const entry of entries) {
    if (isPartnerTransferMateRow(entry) && entry.source_ledger_id) {
      hasMate.add(entry.source_ledger_id);
    }
  }

  const extras: LedgerEntry[] = [];
  for (const entry of entries) {
    if (entry.source_ledger_id) continue;
    const counterparty = partnerTransferCounterparty(entry);
    if (!counterparty) continue;
    if (hasMate.has(entry.id)) continue;
    extras.push(partnerTransferDisplayRow(entry, counterparty));
  }
  return extras.length === 0 ? entries : [...entries, ...extras];
}

export async function syncPartnerTransferMate(
  supabase: SupabaseClient,
  parent: LedgerEntry
): Promise<string | null> {
  const counterparty = partnerTransferCounterparty(parent);
  const { data: existing, error: loadError } = await supabase
    .from("ledger")
    .select("id")
    .eq("source_ledger_id", parent.id)
    .eq("companion_kind", TRANSFER_COMPANION_KIND)
    .maybeSingle();
  if (loadError) return loadError.message;

  if (!counterparty) {
    if (existing?.id) {
      const { error } = await supabase.from("ledger").delete().eq("id", existing.id);
      if (error) return error.message;
    }
    return null;
  }

  const payload = buildPartnerTransferMatePayload(parent, counterparty);
  const { error } = existing?.id
    ? await supabase.from("ledger").update(payload).eq("id", existing.id)
    : await supabase.from("ledger").insert(payload);
  return error?.message ?? null;
}

export async function deletePartnerTransferMate(
  supabase: SupabaseClient,
  parentId: string
): Promise<string | null> {
  const { error } = await supabase
    .from("ledger")
    .delete()
    .eq("source_ledger_id", parentId)
    .eq("companion_kind", TRANSFER_COMPANION_KIND);
  return error?.message ?? null;
}
