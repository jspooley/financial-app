import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accountMoveFields,
  isCheckingAccount,
  isCreditCardAccount,
  matchingCheckingAccount,
  matchingCreditCardAccount,
  wasMovedFromChecking,
} from "@/lib/account-move";
import {
  cashflowClassificationFlags,
  coaAccountNumber,
  COA_COGS_CATEGORY,
  COA_PERSONAL_CARD_REIMBURSE_CATEGORY,
  isBusinessLoanPaybackCoa,
  isCogsCoa,
  isInvoiceGoodsLine,
  isOwnerEquityCoa,
  isPartnerToPartnerTransferCoa,
  isPersonalCardReimbursementCoa,
} from "@/lib/coa";
import {
  isLedgerLineFullyPaid,
  normalizeInvoiceId,
} from "@/lib/invoice-utils";
import { normalizeLedgerRow } from "@/lib/ledger-db";
import type { CashflowAccount, LedgerEntry, Purchaser } from "@/lib/types";
import { roundMoney } from "@/lib/utils";

export const CARD_REIMBURSE_COMPANION_KIND = "card_reimburse" as const;

export function isCardReimburseMateRow(
  entry: Pick<LedgerEntry, "companion_kind" | "source_ledger_id">
) {
  return (
    entry.companion_kind === CARD_REIMBURSE_COMPANION_KIND &&
    Boolean(entry.source_ledger_id)
  );
}

function ownerFromAccount(
  account: string | null | undefined,
  fallback?: Purchaser | null
): Purchaser | null {
  if (account?.includes("Molly")) return "Molly";
  if (account?.includes("Jess")) return "Jess";
  return fallback === "Molly" || fallback === "Jess" ? fallback : null;
}

export function personalCardReimbursementCategory(
  chart: Array<{ category: string }>
): string {
  const found = chart.find((row) => coaAccountNumber(row.category) === 308);
  return found?.category ?? COA_PERSONAL_CARD_REIMBURSE_CATEGORY;
}

/** @deprecated Use personalCardReimbursementCategory — reimbursement is 308, not 302. */
export function cardBillPaymentCategory(chart: Array<{ category: string }>) {
  return personalCardReimbursementCategory(chart);
}

/** Moved checking rows stay unmatched until the user says charge vs reimbursement. */
export function needsPersonalCardIdentification(
  entry: Pick<
    LedgerEntry,
    | "account"
    | "moved_from_account"
    | "source_ledger_id"
    | "companion_kind"
    | "personal_card_role"
  >
) {
  if (!isCreditCardAccount(entry.account)) return false;
  if (!wasMovedFromChecking(entry)) return false;
  if (entry.source_ledger_id) return false;
  if (isCardReimburseMateRow(entry)) return false;
  return entry.personal_card_role == null;
}

export function isPersonalCardCharge(
  entry: Pick<
    LedgerEntry,
    | "account"
    | "moved_from_account"
    | "source_ledger_id"
    | "companion_kind"
    | "personal_card_role"
  >
) {
  if (!isCreditCardAccount(entry.account)) return false;
  if (entry.source_ledger_id) return false;
  if (isCardReimburseMateRow(entry)) return false;
  if (entry.personal_card_role === "reimbursement") return false;
  if (needsPersonalCardIdentification(entry)) return false;
  return true;
}

export function isCheckingCardReimbursement(
  entry: Pick<
    LedgerEntry,
    "account" | "coa_category" | "source_ledger_id"
  >
) {
  if (!isCheckingAccount(entry.account)) return false;
  if (entry.source_ledger_id) return false;
  return isPersonalCardReimbursementCoa(entry.coa_category);
}

function isOwnerDrawOrLoanOrPartnerCoa(category: string | null | undefined) {
  if (isOwnerEquityCoa(category)) return true;
  if (isBusinessLoanPaybackCoa(category)) return true;
  if (isPartnerToPartnerTransferCoa(category)) return true;
  const n = coaAccountNumber(category);
  return n != null && n >= 300 && n < 400 && n !== 308;
}

/** Checking 308 id that ties a card purchase to its card pay-down mate. */
export function cardReimburseClusterParentId(
  entry: Pick<
    LedgerEntry,
    | "id"
    | "account"
    | "coa_category"
    | "source_ledger_id"
    | "companion_kind"
    | "reimbursed_by_ledger_id"
    | "moved_from_account"
    | "personal_card_role"
  >
): string | null {
  if (isCardReimburseMateRow(entry) && entry.source_ledger_id) {
    return entry.source_ledger_id;
  }
  if (isPersonalCardCharge(entry) && entry.reimbursed_by_ledger_id) {
    return entry.reimbursed_by_ledger_id;
  }
  return null;
}

export function withCardReimburseCluster(
  matched: LedgerEntry[],
  pool: LedgerEntry[]
) {
  const parentIds = new Set<string>();
  for (const entry of matched) {
    const parentId = cardReimburseClusterParentId(entry);
    if (parentId) parentIds.add(parentId);
  }
  if (parentIds.size === 0) return matched;

  const included = new Set(matched.map((entry) => entry.id));
  const extras = pool.filter((entry) => {
    if (included.has(entry.id)) return false;
    if (isCheckingCardReimbursement(entry)) return false;
    const parentId = cardReimburseClusterParentId(entry);
    return parentId != null && parentIds.has(parentId);
  });
  return extras.length === 0 ? matched : [...matched, ...extras];
}

export function cardReimburseClusterRank(entry: LedgerEntry) {
  if (isPersonalCardCharge(entry)) return 0;
  if (isCardReimburseMateRow(entry)) return 1;
  return 2;
}

export function cardReimburseNet(entry: Pick<LedgerEntry, "debit_amount" | "credit_amount">) {
  return roundMoney(Number(entry.debit_amount ?? 0) - Number(entry.credit_amount ?? 0));
}

function sortOldest(a: LedgerEntry, b: LedgerEntry) {
  const byDate = a.entry_date.localeCompare(b.entry_date);
  if (byDate !== 0) return byDate;
  const byCreated = (a.created_at ?? "").localeCompare(b.created_at ?? "");
  if (byCreated !== 0) return byCreated;
  return a.id.localeCompare(b.id);
}

function rowsWithStolenReimbursementLinks(entries: LedgerEntry[]) {
  return entries.filter(
    (entry) => Boolean(entry.reimbursed_by_ledger_id) && !isPersonalCardCharge(entry)
  );
}

/** New 1:1 pairs only. Existing links on confirmed charges are left alone. */
export function proposeOldestFirstReimbursements(entries: LedgerEntry[]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const usedPaymentIds = new Set<string>();
  for (const entry of entries) {
    const paymentId = entry.reimbursed_by_ledger_id;
    if (paymentId && byId.has(paymentId)) usedPaymentIds.add(paymentId);
  }

  const chargesByOwner = new Map<Purchaser, LedgerEntry[]>();
  const paymentsByOwner = new Map<Purchaser, LedgerEntry[]>();
  const add = (
    map: Map<Purchaser, LedgerEntry[]>,
    owner: Purchaser,
    entry: LedgerEntry
  ) => {
    const list = map.get(owner) ?? [];
    list.push(entry);
    map.set(owner, list);
  };

  for (const entry of entries) {
    if (isPersonalCardCharge(entry)) {
      const owner = ownerFromAccount(entry.account, entry.purchaser);
      if (!owner) continue;
      if (entry.reimbursed_by_ledger_id && byId.has(entry.reimbursed_by_ledger_id)) {
        continue;
      }
      add(chargesByOwner, owner, entry);
    } else if (isCheckingCardReimbursement(entry)) {
      const owner = ownerFromAccount(entry.account, entry.purchaser);
      if (!owner) continue;
      if (usedPaymentIds.has(entry.id)) continue;
      add(paymentsByOwner, owner, entry);
    }
  }

  const pairs: Array<{ chargeId: string; paymentId: string }> = [];
  for (const owner of ["Jess", "Molly"] as const) {
    const charges = (chargesByOwner.get(owner) ?? []).slice().sort(sortOldest);
    const payments = (paymentsByOwner.get(owner) ?? []).slice().sort(sortOldest);
    const count = Math.min(charges.length, payments.length);
    for (let i = 0; i < count; i += 1) {
      pairs.push({ chargeId: charges[i].id, paymentId: payments[i].id });
    }
  }
  return pairs;
}

export function reimbursementAmountKey(
  entry: Pick<LedgerEntry, "debit_amount" | "credit_amount">
) {
  return roundMoney(Math.abs(cardReimburseNet(entry))).toFixed(2);
}

const DESCRIPTION_STOP_WORDS = new Set([
  "pay",
  "paid",
  "house",
  "back",
  "for",
  "the",
  "and",
  "to",
  "of",
  "a",
  "an",
  "jm",
  "cogs",
  "from",
  "with",
  "card",
  "credit",
  "reimburse",
  "reimbursement",
  "refund",
  "checking",
  "monthly",
  "month",
  "subscription",
  "charge",
  "charges",
  "repay",
  "personal",
  "jan",
  "january",
  "feb",
  "february",
  "mar",
  "march",
  "apr",
  "april",
  "may",
  "jun",
  "june",
  "jul",
  "july",
  "aug",
  "august",
  "sep",
  "sept",
  "september",
  "oct",
  "october",
  "nov",
  "november",
  "dec",
  "december",
]);

function normalizeDescription(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function descriptionTokens(value: string | null | undefined) {
  return new Set(
    normalizeDescription(value)
      .split(" ")
      .filter((word) => word.length > 2 && !DESCRIPTION_STOP_WORDS.has(word))
  );
}

export function cardChargeDescriptionsOverlap(
  a: string | null | undefined,
  b: string | null | undefined
) {
  const left = normalizeDescription(a);
  const right = normalizeDescription(b);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftTokens = descriptionTokens(a);
  const rightTokens = descriptionTokens(b);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap >= 1 && overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.4;
}

function looksLikeExtraCardChargeCopy(entry: LedgerEntry) {
  return (
    looksLikeIdentifiedReimbursementCopy(entry) ||
    coaAccountNumber(entry.coa_category) === 308
  );
}

function independentlyReimbursed(a: LedgerEntry, b: LedgerEntry) {
  const left = a.reimbursed_by_ledger_id;
  const right = b.reimbursed_by_ledger_id;
  return Boolean(left && right && left !== right);
}

function sameCalendarMonth(a: LedgerEntry, b: LedgerEntry) {
  const left = (a.entry_date ?? "").slice(0, 7);
  const right = (b.entry_date ?? "").slice(0, 7);
  return Boolean(left) && left === right;
}

export function cardChargesLookLikeDuplicates(a: LedgerEntry, b: LedgerEntry) {
  if (a.id === b.id) return false;
  if (!isPersonalCardCharge(a) || !isPersonalCardCharge(b)) return false;
  if (a.account !== b.account) return false;
  if (reimbursementAmountKey(a) !== reimbursementAmountKey(b)) return false;
  if (independentlyReimbursed(a, b)) return false;
  if (!cardChargeDescriptionsOverlap(a.description, b.description)) return false;
  if (looksLikeExtraCardChargeCopy(a) || looksLikeExtraCardChargeCopy(b)) {
    return true;
  }
  return sameCalendarMonth(a, b);
}

/** Extra card row inserted when a moved checking reimbursement was identified. */
export function looksLikeIdentifiedReimbursementCopy(charge: LedgerEntry) {
  return (
    isPersonalCardCharge(charge) &&
    charge.personal_card_role === "charge" &&
    !charge.moved_from_account
  );
}

export function cardChargeOriginNote(charge: LedgerEntry) {
  if (looksLikeIdentifiedReimbursementCopy(charge)) {
    return "Added when a reimbursement was identified";
  }
  if (wasMovedFromChecking(charge)) {
    return "Moved from checking and marked as a charge";
  }
  return "Existing card charge";
}

export function duplicateCardChargeGroups(entries: LedgerEntry[]) {
  const charges = entries.filter(isPersonalCardCharge);
  const assigned = new Set<string>();
  const groups: Array<{
    account: string;
    amountKey: string;
    charges: LedgerEntry[];
  }> = [];

  for (const charge of charges) {
    if (assigned.has(charge.id)) continue;
    const peers = charges.filter(
      (other) =>
        !assigned.has(other.id) && cardChargesLookLikeDuplicates(charge, other)
    );
    if (peers.length === 0) continue;
    const group = [charge, ...peers].sort(sortOldest);
    for (const row of group) assigned.add(row.id);
    groups.push({
      account: charge.account ?? "",
      amountKey: reimbursementAmountKey(charge),
      charges: group,
    });
  }
  return groups;
}

export async function deletePersonalCardCharge(
  supabase: SupabaseClient,
  entry: LedgerEntry,
  all: LedgerEntry[]
): Promise<string | null> {
  const children = all.filter((row) => row.source_ledger_id === entry.id);
  for (const row of children) {
    const { error } = await supabase.from("ledger").delete().eq("id", row.id);
    if (error) return error.message;
  }
  const { data, error } = await supabase
    .from("ledger")
    .delete()
    .eq("id", entry.id)
    .select("id");
  if (error) return error.message;
  if (!data?.length) {
    return "This row was not deleted. It may be protected by another record, or the delete did not reach the database.";
  }
  return null;
}

/** 1:1 pairs that share the same amount. Existing links are left alone. */
export function proposeAmountMatchedReimbursements(entries: LedgerEntry[]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const usedPaymentIds = new Set<string>();
  const usedChargeIds = new Set<string>();
  for (const entry of entries) {
    const paymentId = entry.reimbursed_by_ledger_id;
    if (paymentId && byId.has(paymentId) && isPersonalCardCharge(entry)) {
      usedPaymentIds.add(paymentId);
      usedChargeIds.add(entry.id);
    }
  }

  const chargesByOwner = new Map<Purchaser, LedgerEntry[]>();
  const paymentsByOwner = new Map<Purchaser, LedgerEntry[]>();
  const add = (
    map: Map<Purchaser, LedgerEntry[]>,
    owner: Purchaser,
    entry: LedgerEntry
  ) => {
    const list = map.get(owner) ?? [];
    list.push(entry);
    map.set(owner, list);
  };

  for (const entry of entries) {
    const owner = ownerFromAccount(entry.account, entry.purchaser);
    if (!owner) continue;
    if (isPersonalCardCharge(entry) && !usedChargeIds.has(entry.id)) {
      add(chargesByOwner, owner, entry);
    } else if (
      isCheckingCardReimbursement(entry) &&
      !usedPaymentIds.has(entry.id)
    ) {
      add(paymentsByOwner, owner, entry);
    }
  }

  const pairs: Array<{ chargeId: string; paymentId: string }> = [];
  for (const owner of ["Jess", "Molly"] as const) {
    const charges = (chargesByOwner.get(owner) ?? []).slice().sort(sortOldest);
    const payments = (paymentsByOwner.get(owner) ?? []).slice().sort(sortOldest);
    const paymentsByAmount = new Map<string, LedgerEntry[]>();
    for (const payment of payments) {
      const key = reimbursementAmountKey(payment);
      const list = paymentsByAmount.get(key) ?? [];
      list.push(payment);
      paymentsByAmount.set(key, list);
    }
    for (const charge of charges) {
      const key = reimbursementAmountKey(charge);
      const bucket = paymentsByAmount.get(key);
      const payment = bucket?.shift();
      if (!payment) continue;
      pairs.push({ chargeId: charge.id, paymentId: payment.id });
    }
  }
  return pairs;
}

export async function persistOldestFirstReimbursements(
  supabase: SupabaseClient,
  entries: LedgerEntry[]
): Promise<{ updated: number; error: string | null }> {
  let updated = 0;
  const stolen = rowsWithStolenReimbursementLinks(entries);
  for (const entry of stolen) {
    const { error } = await supabase
      .from("ledger")
      .update({ reimbursed_by_ledger_id: null })
      .eq("id", entry.id);
    if (error) return { updated, error: error.message };
    updated += 1;
  }
  return { updated, error: null };
}

export async function persistAmountMatchedReimbursements(
  supabase: SupabaseClient,
  entries: LedgerEntry[]
): Promise<{ updated: number; error: string | null }> {
  const pairs = proposeAmountMatchedReimbursements(entries);
  let updated = 0;
  for (const pair of pairs) {
    const { error } = await supabase
      .from("ledger")
      .update({ reimbursed_by_ledger_id: pair.paymentId })
      .eq("id", pair.chargeId);
    if (error) return { updated, error: error.message };
    updated += 1;
  }
  return { updated, error: null };
}

export function outstandingPersonalCardCharges(entries: LedgerEntry[]) {
  return entries.filter(
    (entry) => isPersonalCardCharge(entry) && !entry.reimbursed_by_ledger_id
  );
}

export function unmatchedCheckingReimbursements(entries: LedgerEntry[]) {
  const used = new Set(
    entries
      .filter(isPersonalCardCharge)
      .map((entry) => entry.reimbursed_by_ledger_id)
      .filter((id): id is string => Boolean(id))
  );
  return entries.filter(
    (entry) => isCheckingCardReimbursement(entry) && !used.has(entry.id)
  );
}

export type ReimbursementLinkCandidate = {
  payment: LedgerEntry;
  linkedCharge: LedgerEntry | null;
  duplicateCharge: LedgerEntry | null;
  amountMatch: boolean;
  needsCoa308: boolean;
  hasCardPaydown: boolean;
};

export function reimbursementCandidatesForCharge(
  entries: LedgerEntry[],
  charge: LedgerEntry
): ReimbursementLinkCandidate[] {
  const owner = ownerFromAccount(charge.account, charge.purchaser);
  const amountKey = reimbursementAmountKey(charge);
  const linkedByPayment = reimbursementByPaymentId(entries);
  const paydownParentIds = new Set(
    entries
      .filter(isCardReimburseMateRow)
      .map((entry) => entry.source_ledger_id)
      .filter((id): id is string => Boolean(id))
  );
  const seen = new Set<string>();
  const candidates: ReimbursementLinkCandidate[] = [];

  const push = (payment: LedgerEntry, needsCoa308: boolean) => {
    if (seen.has(payment.id) || payment.id === charge.id) return;
    if (payment.source_ledger_id) return;
    if (!isCheckingAccount(payment.account)) return;
    seen.add(payment.id);
    const linkedCharge = linkedByPayment.get(payment.id) ?? null;
    if (linkedCharge?.id === charge.id) return;
    candidates.push({
      payment,
      linkedCharge,
      duplicateCharge:
        linkedCharge && cardChargesLookLikeDuplicates(charge, linkedCharge)
          ? linkedCharge
          : null,
      amountMatch: reimbursementAmountKey(payment) === amountKey,
      needsCoa308,
      hasCardPaydown: paydownParentIds.has(payment.id),
    });
  };

  for (const entry of entries) {
    if (isCheckingCardReimbursement(entry)) push(entry, false);
  }
  for (const entry of entries) {
    if (isCheckingCardReimbursement(entry)) continue;
    if (!isCheckingAccount(entry.account) || entry.source_ledger_id) continue;
    if (isOwnerDrawOrLoanOrPartnerCoa(entry.coa_category)) continue;
    if (reimbursementAmountKey(entry) !== amountKey) continue;
    const entryOwner = ownerFromAccount(entry.account, entry.purchaser);
    if (owner && entryOwner && entryOwner !== owner) continue;
    push(entry, true);
  }

  return candidates.sort((a, b) => {
    const amountDelta = Number(b.amountMatch) - Number(a.amountMatch);
    if (amountDelta !== 0) return amountDelta;
    const duplicateDelta =
      Number(Boolean(b.duplicateCharge)) - Number(Boolean(a.duplicateCharge));
    if (duplicateDelta !== 0) return duplicateDelta;
    const unusedDelta = Number(!a.linkedCharge) - Number(!b.linkedCharge);
    if (unusedDelta !== 0) return unusedDelta;
    const aOwner = ownerFromAccount(a.payment.account, a.payment.purchaser);
    const bOwner = ownerFromAccount(b.payment.account, b.payment.purchaser);
    const ownerDelta = Number(bOwner === owner) - Number(aOwner === owner);
    if (ownerDelta !== 0) return ownerDelta;
    return sortOldest(a.payment, b.payment);
  });
}

export function chargeCandidatesForPayment(
  entries: LedgerEntry[],
  payment: LedgerEntry
) {
  const owner = ownerFromAccount(payment.account, payment.purchaser);
  const amountKey = reimbursementAmountKey(payment);
  return outstandingPersonalCardCharges(entries)
    .map((charge) => ({
      charge,
      amountMatch: reimbursementAmountKey(charge) === amountKey,
      sameOwner: ownerFromAccount(charge.account, charge.purchaser) === owner,
    }))
    .sort((a, b) => {
      const amountDelta = Number(b.amountMatch) - Number(a.amountMatch);
      if (amountDelta !== 0) return amountDelta;
      const ownerDelta = Number(b.sameOwner) - Number(a.sameOwner);
      if (ownerDelta !== 0) return ownerDelta;
      return sortOldest(a.charge, b.charge);
    });
}

export async function linkCardChargeToReimbursement(
  supabase: SupabaseClient,
  charge: LedgerEntry,
  payment: LedgerEntry,
  coa308: string
): Promise<string | null> {
  if (!isPersonalCardCharge(charge)) {
    return "Only a confirmed credit-card charge can be linked to a 308.";
  }
  if (!isCheckingAccount(payment.account) || payment.source_ledger_id) {
    return "Pick a checking reimbursement, not a card row.";
  }

  let paymentRow = payment;
  if (!isCheckingCardReimbursement(paymentRow)) {
    const flags = cashflowClassificationFlags(coa308);
    const { error } = await supabase
      .from("ledger")
      .update({
        coa_category: coa308,
        personal_card_role: "reimbursement",
        ...flags,
      })
      .eq("id", paymentRow.id);
    if (error) return error.message;
    paymentRow = {
      ...paymentRow,
      coa_category: coa308,
      personal_card_role: "reimbursement",
      ...flags,
    };
  }

  const { error: clearError } = await supabase
    .from("ledger")
    .update({ reimbursed_by_ledger_id: null })
    .eq("reimbursed_by_ledger_id", paymentRow.id);
  if (clearError) return clearError.message;

  const { error: linkError } = await supabase
    .from("ledger")
    .update({ reimbursed_by_ledger_id: paymentRow.id })
    .eq("id", charge.id);
  if (linkError) return linkError.message;

  return syncCardReimburseMate(supabase, paymentRow);
}

export async function unlinkCardChargeReimbursement(
  supabase: SupabaseClient,
  charge: LedgerEntry
): Promise<string | null> {
  if (!charge.reimbursed_by_ledger_id) return null;
  const { error } = await supabase
    .from("ledger")
    .update({ reimbursed_by_ledger_id: null })
    .eq("id", charge.id);
  return error?.message ?? null;
}

function buildPersonalCardChargeDuplicate(
  parent: LedgerEntry,
  cardAccount: CashflowAccount
) {
  const debit = roundMoney(Number(parent.debit_amount ?? 0));
  const credit = roundMoney(Number(parent.credit_amount ?? 0));
  const coa = parent.coa_category ?? "";
  return {
    entry_date: parent.entry_date,
    designer_cost: 0,
    quantity: 1,
    credit_debit: debit >= credit ? ("debit" as const) : ("credit" as const),
    description: parent.description,
    wholesale_retail: parent.wholesale_retail ?? "retail",
    trade_partner_id: parent.trade_partner_id,
    discount_percent: parent.discount_percent ?? 0,
    shipping_receiving_amount: 0,
    retail_price: 0,
    tax_amount: 0,
    customer_price: 0,
    client_id: parent.client_id,
    po_number: parent.po_number,
    purchaser: parent.purchaser,
    department: parent.department ?? "Interior Design",
    coa_category: parent.coa_category,
    debit_amount: debit,
    credit_amount: credit,
    account: cardAccount,
    moved_from_account: null,
    personal_card_role: "charge" as const,
    reimbursed_by_ledger_id: parent.id,
    expense_type: null,
    invoiced: false,
    invoice_id: parent.invoice_id,
    paid: false,
    date_paid: null,
    paid_to: parent.paid_to,
    payment_type: null,
    payment_fee: 0,
    payment_amount: 0,
    expense_amount: 0,
    ...cashflowClassificationFlags(coa),
    variance_accepted: false,
    variance_amount: 0,
    variance_notes: "",
    source_ledger_id: null,
    companion_kind: null,
  };
}

export async function identifyMovedRowAsCharge(
  supabase: SupabaseClient,
  entry: LedgerEntry
): Promise<string | null> {
  if (!needsPersonalCardIdentification(entry)) {
    return "This row does not need charge vs reimbursement identification.";
  }
  const { error } = await supabase
    .from("ledger")
    .update({ personal_card_role: "charge" })
    .eq("id", entry.id);
  return error?.message ?? null;
}

export async function identifyMovedRowAsReimbursement(
  supabase: SupabaseClient,
  entry: LedgerEntry,
  coa308: string
): Promise<string | null> {
  if (!needsPersonalCardIdentification(entry)) {
    return "This row does not need charge vs reimbursement identification.";
  }
  const cardAccount = isCreditCardAccount(entry.account) ? entry.account : null;
  const checkingAccount =
    matchingCheckingAccount(entry.account) ??
    (isCheckingAccount(entry.moved_from_account)
      ? entry.moved_from_account
      : null);
  if (!cardAccount || !checkingAccount) {
    return "This row is not on a personal credit card that maps to checking.";
  }

  const move = accountMoveFields(entry, checkingAccount);
  const flags = cashflowClassificationFlags(coa308);
  const { error: updateError } = await supabase
    .from("ledger")
    .update({
      ...move,
      coa_category: coa308,
      personal_card_role: "reimbursement",
      reimbursed_by_ledger_id: null,
      ...flags,
    })
    .eq("id", entry.id);
  if (updateError) return updateError.message;

  const { error: insertError } = await supabase
    .from("ledger")
    .insert(buildPersonalCardChargeDuplicate(entry, cardAccount));
  if (insertError) return insertError.message;

  const payment: LedgerEntry = {
    ...entry,
    ...move,
    coa_category: coa308,
    personal_card_role: "reimbursement",
    reimbursed_by_ledger_id: null,
    ...flags,
  };
  return syncCardReimburseMate(supabase, payment);
}

export async function recodeCheckingPaymentToPersonalCardReimburse(
  supabase: SupabaseClient,
  payment: LedgerEntry,
  coa308: string
): Promise<string | null> {
  if (!isCheckingAccount(payment.account) || payment.source_ledger_id) {
    return "Pick a checking repayment row.";
  }
  const flags = cashflowClassificationFlags(coa308);
  const { error } = await supabase
    .from("ledger")
    .update({
      coa_category: coa308,
      personal_card_role: "reimbursement",
      ...flags,
    })
    .eq("id", payment.id);
  if (error) return error.message;
  return syncCardReimburseMate(supabase, {
    ...payment,
    coa_category: coa308,
    personal_card_role: "reimbursement",
    ...flags,
  });
}

export function cogsCategoryFromChart(chart: Array<{ category: string }>) {
  const found = chart.find((row) => isCogsCoa(row.category));
  return found?.category ?? COA_COGS_CATEGORY;
}

export function canBillCardChargeOnInvoice(entry: LedgerEntry) {
  if (!isPersonalCardCharge(entry)) return false;
  if (!normalizeInvoiceId(entry.invoice_id)) return false;
  if (isInvoiceGoodsLine(entry) && !entry.balance_sheet) return false;
  return true;
}

export async function billCardChargeOnInvoice(
  supabase: SupabaseClient,
  entry: LedgerEntry,
  cogsCategory: string
): Promise<string | null> {
  const invoiceId = normalizeInvoiceId(entry.invoice_id);
  if (!canBillCardChargeOnInvoice(entry) || !invoiceId) {
    return "Set an invoice on this card purchase first.";
  }
  const cost = roundMoney(Math.abs(cardReimburseNet(entry)));
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoicing")
    .select("client_id, po_number")
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (invoiceError) return invoiceError.message;
  const { data: siblingRows, error: siblingError } = await supabase
    .from("ledger")
    .select("*")
    .eq("invoice_id", invoiceId)
    .is("source_ledger_id", null)
    .neq("id", entry.id);
  if (siblingError) return siblingError.message;
  const siblingDebits = (siblingRows ?? [])
    .map((row) => normalizeLedgerRow(row))
    .filter(
      (line) =>
        line.credit_debit === "debit" &&
        isInvoiceGoodsLine(line) &&
        !line.balance_sheet
    );
  const inheritWriteOff =
    siblingDebits.length > 0 &&
    siblingDebits.every(
      (line) =>
        isLedgerLineFullyPaid(line) &&
        roundMoney(Number(line.payment_amount ?? 0)) < 0.005
    );
  const flags = cashflowClassificationFlags(cogsCategory);
  const { error } = await supabase
    .from("ledger")
    .update({
      coa_category: cogsCategory,
      designer_cost: cost,
      quantity: 1,
      retail_price: cost,
      customer_price: cost,
      invoiced: true,
      invoice_id: invoiceId,
      client_id: invoice?.client_id ?? entry.client_id,
      po_number: invoice?.po_number ?? entry.po_number,
      wholesale_retail: "retail",
      personal_card_role: "charge",
      variance_accepted: inheritWriteOff,
      variance_amount: inheritWriteOff ? roundMoney(-cost) : 0,
      paid: inheritWriteOff,
      ...flags,
    })
    .eq("id", entry.id);
  return error?.message ?? null;
}

export function reimbursementByPaymentId(entries: LedgerEntry[]) {
  const chargesByPayment = new Map<string, LedgerEntry>();
  for (const entry of entries) {
    if (!entry.reimbursed_by_ledger_id || !isPersonalCardCharge(entry)) {
      continue;
    }
    chargesByPayment.set(entry.reimbursed_by_ledger_id, entry);
  }
  return chargesByPayment;
}

export function isCardReimbursementParent(
  entry: Pick<LedgerEntry, "account" | "coa_category" | "source_ledger_id">
) {
  return isCheckingCardReimbursement(entry);
}

export function buildCardReimburseMatePayload(parent: LedgerEntry) {
  const debit = roundMoney(Number(parent.credit_amount ?? 0));
  const credit = roundMoney(Number(parent.debit_amount ?? 0));
  const account = matchingCreditCardAccount(parent.account) as CashflowAccount;
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
    purchaser: parent.purchaser,
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
    paid_to: parent.paid_to,
    payment_type: null,
    payment_fee: 0,
    payment_amount: 0,
    expense_amount: 0,
    ...cashflowClassificationFlags(parent.coa_category ?? ""),
    variance_accepted: false,
    variance_amount: 0,
    variance_notes: "",
    source_ledger_id: parent.id,
    companion_kind: CARD_REIMBURSE_COMPANION_KIND,
  };
}

export function cardReimburseDisplayRow(parent: LedgerEntry): LedgerEntry {
  const debit = roundMoney(Number(parent.credit_amount ?? 0));
  const credit = roundMoney(Number(parent.debit_amount ?? 0));
  const account = matchingCreditCardAccount(parent.account);
  return {
    ...parent,
    id: `card-reimburse:${parent.id}`,
    source_ledger_id: parent.id,
    companion_kind: CARD_REIMBURSE_COMPANION_KIND,
    account,
    debit_amount: debit,
    credit_amount: credit,
    credit_debit: credit >= debit ? "credit" : "debit",
    designer_cost: 0,
    payment_amount: 0,
    payment_fee: 0,
    moved_from_account: null,
    reimbursed_by_ledger_id: null,
    personal_card_role: null,
  };
}

export function mergeCardReimburseDisplayMates(entries: LedgerEntry[]) {
  const hasMate = new Set<string>();
  for (const entry of entries) {
    if (isCardReimburseMateRow(entry) && entry.source_ledger_id) {
      hasMate.add(entry.source_ledger_id);
    }
  }
  const extras: LedgerEntry[] = [];
  for (const entry of entries) {
    if (!isCardReimbursementParent(entry)) continue;
    if (hasMate.has(entry.id)) continue;
    if (!matchingCreditCardAccount(entry.account)) continue;
    extras.push(cardReimburseDisplayRow(entry));
  }
  return extras.length === 0 ? entries : [...entries, ...extras];
}

export async function syncCardReimburseMate(
  supabase: SupabaseClient,
  parent: LedgerEntry
): Promise<string | null> {
  const { data: existing, error: loadError } = await supabase
    .from("ledger")
    .select("id")
    .eq("source_ledger_id", parent.id)
    .eq("companion_kind", CARD_REIMBURSE_COMPANION_KIND)
    .maybeSingle();
  if (loadError) return loadError.message;

  const shouldHaveMate =
    isCardReimbursementParent(parent) &&
    matchingCreditCardAccount(parent.account) != null;

  if (!shouldHaveMate) {
    if (existing?.id) {
      const { error } = await supabase.from("ledger").delete().eq("id", existing.id);
      if (error) return error.message;
    }
    return null;
  }

  const payload = buildCardReimburseMatePayload(parent);
  const { error } = existing?.id
    ? await supabase.from("ledger").update(payload).eq("id", existing.id)
    : await supabase.from("ledger").insert(payload);
  return error?.message ?? null;
}

export async function deleteCardReimburseMate(
  supabase: SupabaseClient,
  parentId: string
): Promise<string | null> {
  const { error } = await supabase
    .from("ledger")
    .delete()
    .eq("source_ledger_id", parentId)
    .eq("companion_kind", CARD_REIMBURSE_COMPANION_KIND);
  return error?.message ?? null;
}

export function reimbursementStatus(
  entry: LedgerEntry,
  byId: Map<string, LedgerEntry>,
  chargeByPaymentId: Map<string, LedgerEntry>
):
  | { kind: "na" }
  | { kind: "needs-identification" }
  | { kind: "charge-outstanding" }
  | { kind: "charge-reimbursed"; payment: LedgerEntry; mismatch: boolean }
  | { kind: "payment-unmatched" }
  | { kind: "payment-matched"; charge: LedgerEntry; mismatch: boolean }
  | { kind: "card-mate"; parent?: LedgerEntry } {
  if (needsPersonalCardIdentification(entry)) {
    return { kind: "needs-identification" };
  }
  if (isCardReimburseMateRow(entry)) {
    const parent = entry.source_ledger_id
      ? byId.get(entry.source_ledger_id)
      : undefined;
    return { kind: "card-mate", parent };
  }
  if (isPersonalCardCharge(entry)) {
    const payment = entry.reimbursed_by_ledger_id
      ? byId.get(entry.reimbursed_by_ledger_id)
      : undefined;
    if (!payment) return { kind: "charge-outstanding" };
    const mismatch =
      Math.abs(cardReimburseNet(entry) - cardReimburseNet(payment)) >= 0.005;
    return { kind: "charge-reimbursed", payment, mismatch };
  }
  if (
    isCheckingCardReimbursement(entry) ||
    (isCheckingAccount(entry.account) &&
      !entry.source_ledger_id &&
      chargeByPaymentId.has(entry.id))
  ) {
    const charge = chargeByPaymentId.get(entry.id);
    if (!charge) return { kind: "payment-unmatched" };
    const mismatch =
      Math.abs(cardReimburseNet(entry) - cardReimburseNet(charge)) >= 0.005;
    return { kind: "payment-matched", charge, mismatch };
  }
  return { kind: "na" };
}

export function outstandingPersonalCardTotal(entries: LedgerEntry[]) {
  return roundMoney(
    entries
      .filter(
        (entry) =>
          isPersonalCardCharge(entry) && !entry.reimbursed_by_ledger_id
      )
      .reduce((sum, entry) => sum + cardReimburseNet(entry), 0)
  );
}
