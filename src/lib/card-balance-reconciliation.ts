import { isCreditCardAccount } from "@/lib/account-move";
import {
  isCashflowOperatingCoa,
  isInvoiceGoodsLine,
  isOperatingExpenseEntry,
} from "@/lib/coa";
import {
  cardReimburseNet,
  isCardReimburseMateRow,
  isPersonalCardCharge,
  isUnreimbursedBusinessPersonalCardCharge,
  needsPersonalCardIdentification,
} from "@/lib/card-reimbursement";
import type { PersonalFundsPartnerFilter } from "@/lib/personal-funds-report";
import { isPaymentCompanionRow } from "@/lib/payment-companions";
import { partnerFromEntry } from "@/lib/true-up-report";
import type { CashflowAccount, LedgerEntry, KnownPurchaser } from "@/lib/types";
import { roundMoney } from "@/lib/utils";

export type CardBalanceBucketKey =
  | "unreimbursed"
  | "reimbursed-charge"
  | "card-paydown"
  | "needs-identification"
  | "other";

export type CardBalanceReconciliationLine = {
  id: string;
  date: string;
  account: string;
  description: string;
  category: string;
  partner: KnownPurchaser;
  bucket: CardBalanceBucketKey;
  amount: number;
};

export type CardBalanceBucketSummary = {
  key: CardBalanceBucketKey;
  label: string;
  hint: string;
  total: number;
  lines: CardBalanceReconciliationLine[];
};

export type CardBalanceReconciliation = {
  partner: PersonalFundsPartnerFilter;
  buckets: CardBalanceBucketSummary[];
  creditCardBalance: number;
  byAccount: Partial<Record<CashflowAccount, number>>;
};

const BUCKET_META: Record<
  CardBalanceBucketKey,
  { label: string; hint: string }
> = {
  unreimbursed: {
    label: "Unreimbursed business purchases",
    hint: "Same total as Business Debt. Checking has not reimbursed these yet.",
  },
  "reimbursed-charge": {
    label: "Reimbursed purchases (still on card)",
    hint: "Linked to a checking 308 but the charge debit is still on the card register.",
  },
  "card-paydown": {
    label: "308 card paydowns",
    hint: "Credits that offset checking 308 reimbursements (“Pays the card back”).",
  },
  "needs-identification": {
    label: "Needs charge or reimbursement ID",
    hint: "Moved from checking — mark each row as a charge or a reimbursement on Cashflow.",
  },
  other: {
    label: "Other register activity",
    hint: "COGS, expenses, and other card rows that are not personal-card purchases.",
  },
};

function isExcludedPersonalUseCashflowRow(
  entry: LedgerEntry,
  parentById: Map<string, LedgerEntry>
) {
  if (!entry.source_ledger_id && Boolean(entry.balance_sheet)) {
    if (
      isOperatingExpenseEntry(entry) ||
      isCashflowOperatingCoa(entry.coa_category)
    ) {
      return false;
    }
    if (isInvoiceGoodsLine(entry)) return true;
  }
  if (isPaymentCompanionRow(entry) && entry.source_ledger_id) {
    const parent = parentById.get(entry.source_ledger_id);
    if (
      parent &&
      Boolean(parent.balance_sheet) &&
      isInvoiceGoodsLine(parent)
    ) {
      return true;
    }
  }
  return false;
}

function matchesPartnerAccount(
  entry: LedgerEntry,
  partner: PersonalFundsPartnerFilter
) {
  if (!isCreditCardAccount(entry.account)) return false;
  if (partner === "Both") return true;
  return entry.account.includes(partner);
}

function classifyCardRow(
  entry: LedgerEntry,
  parentById: Map<string, LedgerEntry>
): CardBalanceBucketKey {
  if (needsPersonalCardIdentification(entry)) return "needs-identification";
  if (isUnreimbursedBusinessPersonalCardCharge(entry, parentById)) {
    return "unreimbursed";
  }
  if (isCardReimburseMateRow(entry)) return "card-paydown";
  if (isPersonalCardCharge(entry) && entry.reimbursed_by_ledger_id) {
    return "reimbursed-charge";
  }
  return "other";
}

function emptyBuckets(): Record<CardBalanceBucketKey, CardBalanceReconciliationLine[]> {
  return {
    unreimbursed: [],
    "reimbursed-charge": [],
    "card-paydown": [],
    "needs-identification": [],
    other: [],
  };
}

function sortLines(lines: CardBalanceReconciliationLine[]) {
  return [...lines].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return a.id.localeCompare(b.id);
  });
}

export function buildCardBalanceReconciliation(
  entries: LedgerEntry[],
  partner: PersonalFundsPartnerFilter = "Both",
  options?: {
    resolveNetAmount?: (entry: LedgerEntry) => number;
  }
): CardBalanceReconciliation {
  const parentById = new Map(entries.map((entry) => [entry.id, entry]));
  const resolveNetAmount =
    options?.resolveNetAmount ??
    ((entry: LedgerEntry) => cardReimburseNet(entry));
  const grouped = emptyBuckets();
  const byAccount: Partial<Record<CashflowAccount, number>> = {};

  for (const entry of entries) {
    if (!matchesPartnerAccount(entry, partner)) continue;
    if (isExcludedPersonalUseCashflowRow(entry, parentById)) continue;

    const amount = roundMoney(resolveNetAmount(entry));
    if (Math.abs(amount) < 0.005) continue;

    const bucket = classifyCardRow(entry, parentById);
    const line: CardBalanceReconciliationLine = {
      id: entry.id,
      date: entry.entry_date,
      account: entry.account ?? "—",
      description: entry.description?.trim() || "—",
      category: entry.coa_category?.trim() || "—",
      partner: partnerFromEntry(entry),
      bucket,
      amount,
    };
    grouped[bucket].push(line);

    if (isCreditCardAccount(entry.account)) {
      byAccount[entry.account] = roundMoney(
        (byAccount[entry.account] ?? 0) + amount
      );
    }
  }

  const bucketOrder: CardBalanceBucketKey[] = [
    "unreimbursed",
    "reimbursed-charge",
    "card-paydown",
    "needs-identification",
    "other",
  ];

  const buckets = bucketOrder.map((key) => {
    const lines = sortLines(grouped[key]);
    return {
      key,
      label: BUCKET_META[key].label,
      hint: BUCKET_META[key].hint,
      total: roundMoney(lines.reduce((sum, line) => sum + line.amount, 0)),
      lines,
    };
  });

  const creditCardBalance = roundMoney(
    buckets.reduce((sum, bucket) => sum + bucket.total, 0)
  );

  return { partner, buckets, creditCardBalance, byAccount };
}
