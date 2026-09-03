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

export type CardPaydownPairStatus =
  | "matched"
  | "cluster"
  | "missing-paydown"
  | "missing-charge"
  | "amount-mismatch";

export type CardPaydownPairRow = {
  key: string;
  status: CardPaydownPairStatus;
  paymentId: string | null;
  paymentLabel: string | null;
  charge: CardBalanceReconciliationLine | null;
  paydown: CardBalanceReconciliationLine | null;
  netOnCard: number;
};

export type CardPaydownPairingReport = {
  rows: CardPaydownPairRow[];
  matchedCount: number;
  unmatchedChargeCount: number;
  unmatchedPaydownCount: number;
  unmatchedChargeTotal: number;
  unmatchedPaydownTotal: number;
};

export type CardBalanceReconciliation = {
  partner: PersonalFundsPartnerFilter;
  buckets: CardBalanceBucketSummary[];
  creditCardBalance: number;
  byAccount: Partial<Record<CashflowAccount, number>>;
  paydownPairing: CardPaydownPairingReport;
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
    label: "Paid by checking",
    hint: "Linked to a checking 308. Not in the unpaid card balance.",
  },
  "card-paydown": {
    label: "Old card paydown credits",
    hint: "Leftover hidden credits from the previous card-offset approach. Run migration 082 to remove them.",
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

function reconciliationLineFromEntry(
  entry: LedgerEntry,
  amount: number,
  bucket: CardBalanceBucketKey
): CardBalanceReconciliationLine {
  return {
    id: entry.id,
    date: entry.entry_date,
    account: entry.account ?? "—",
    description: entry.description?.trim() || "—",
    category: entry.coa_category?.trim() || "—",
    partner: partnerFromEntry(entry),
    bucket,
    amount,
  };
}

function paymentLabel(
  paymentId: string | null,
  parentById: Map<string, LedgerEntry>
) {
  if (!paymentId) return null;
  const payment = parentById.get(paymentId);
  if (!payment) return `308 ${paymentId.slice(0, 8)}…`;
  const description = payment.description?.trim();
  const date = payment.entry_date;
  return description ? `${date} · ${description}` : date;
}

function buildCardPaydownPairing(
  entries: LedgerEntry[],
  partner: PersonalFundsPartnerFilter,
  parentById: Map<string, LedgerEntry>,
  resolveNetAmount: (entry: LedgerEntry) => number
): CardPaydownPairingReport {
  const reimbursedCharges: LedgerEntry[] = [];
  const cardPaydowns: LedgerEntry[] = [];

  for (const entry of entries) {
    if (!matchesPartnerAccount(entry, partner)) continue;
    if (isExcludedPersonalUseCashflowRow(entry, parentById)) continue;
    if (isPersonalCardCharge(entry) && entry.reimbursed_by_ledger_id) {
      reimbursedCharges.push(entry);
      continue;
    }
    if (isCardReimburseMateRow(entry)) {
      cardPaydowns.push(entry);
    }
  }

  const paydownByPaymentId = new Map<string, LedgerEntry>();
  for (const paydown of cardPaydowns) {
    if (!paydown.source_ledger_id) continue;
    paydownByPaymentId.set(paydown.source_ledger_id, paydown);
  }

  const chargesByPaymentId = new Map<string, LedgerEntry[]>();
  const orphanCharges: LedgerEntry[] = [];
  for (const charge of reimbursedCharges) {
    const paymentId = charge.reimbursed_by_ledger_id;
    if (!paymentId) {
      orphanCharges.push(charge);
      continue;
    }
    const list = chargesByPaymentId.get(paymentId) ?? [];
    list.push(charge);
    chargesByPaymentId.set(paymentId, list);
  }

  const paymentIds = new Set<string>([
    ...paydownByPaymentId.keys(),
    ...chargesByPaymentId.keys(),
  ]);

  const rows: CardPaydownPairRow[] = [];
  const usedPaydownIds = new Set<string>();

  for (const paymentId of [...paymentIds].sort()) {
    const clusterCharges = (chargesByPaymentId.get(paymentId) ?? []).slice().sort(
      (a, b) => {
        const byDate = a.entry_date.localeCompare(b.entry_date);
        if (byDate !== 0) return byDate;
        return a.id.localeCompare(b.id);
      }
    );
    const paydown = paydownByPaymentId.get(paymentId);
    const label = paymentLabel(paymentId, parentById);
    const chargeTotal = roundMoney(
      clusterCharges.reduce((sum, charge) => sum + resolveNetAmount(charge), 0)
    );
    const paydownAmount = paydown ? resolveNetAmount(paydown) : 0;
    const clusterNet = roundMoney(chargeTotal + paydownAmount);
    const clusterBalanced = Math.abs(clusterNet) < 0.005;

    if (clusterCharges.length === 0 && paydown) {
      rows.push({
        key: `paydown:${paydown.id}`,
        status: "missing-charge",
        paymentId,
        paymentLabel: label,
        charge: null,
        paydown: reconciliationLineFromEntry(
          paydown,
          paydownAmount,
          "card-paydown"
        ),
        netOnCard: paydownAmount,
      });
      usedPaydownIds.add(paydown.id);
      continue;
    }

    if (clusterCharges.length > 0 && !paydown) {
      for (const charge of clusterCharges) {
        const amount = resolveNetAmount(charge);
        rows.push({
          key: `charge:${charge.id}`,
          status: "missing-paydown",
          paymentId,
          paymentLabel: label,
          charge: reconciliationLineFromEntry(
            charge,
            amount,
            "reimbursed-charge"
          ),
          paydown: null,
          netOnCard: amount,
        });
      }
      continue;
    }

    if (clusterCharges.length === 1 && paydown) {
      const charge = clusterCharges[0];
      const chargeAmount = resolveNetAmount(charge);
      const netOnCard = roundMoney(chargeAmount + paydownAmount);
      rows.push({
        key: `pair:${charge.id}:${paydown.id}`,
        status:
          Math.abs(netOnCard) < 0.005 ? "matched" : "amount-mismatch",
        paymentId,
        paymentLabel: label,
        charge: reconciliationLineFromEntry(
          charge,
          chargeAmount,
          "reimbursed-charge"
        ),
        paydown: reconciliationLineFromEntry(
          paydown,
          paydownAmount,
          "card-paydown"
        ),
        netOnCard,
      });
      usedPaydownIds.add(paydown.id);
      continue;
    }

    for (const [index, charge] of clusterCharges.entries()) {
      const chargeAmount = resolveNetAmount(charge);
      rows.push({
        key: `cluster:${paymentId}:${charge.id}`,
        status: clusterBalanced ? "cluster" : "amount-mismatch",
        paymentId,
        paymentLabel: label,
        charge: reconciliationLineFromEntry(
          charge,
          chargeAmount,
          "reimbursed-charge"
        ),
        paydown:
          index === 0 && paydown
            ? reconciliationLineFromEntry(
                paydown,
                paydownAmount,
                "card-paydown"
              )
            : null,
        netOnCard: index === 0 ? clusterNet : chargeAmount,
      });
      if (index === 0 && paydown) usedPaydownIds.add(paydown.id);
    }
  }

  for (const charge of orphanCharges) {
    const amount = resolveNetAmount(charge);
    rows.push({
      key: `orphan-charge:${charge.id}`,
      status: "missing-paydown",
      paymentId: charge.reimbursed_by_ledger_id ?? null,
      paymentLabel: paymentLabel(charge.reimbursed_by_ledger_id ?? null, parentById),
      charge: reconciliationLineFromEntry(charge, amount, "reimbursed-charge"),
      paydown: null,
      netOnCard: amount,
    });
  }

  for (const paydown of cardPaydowns) {
    if (usedPaydownIds.has(paydown.id)) continue;
    const amount = resolveNetAmount(paydown);
    rows.push({
      key: `orphan-paydown:${paydown.id}`,
      status: "missing-charge",
      paymentId: paydown.source_ledger_id ?? null,
      paymentLabel: paymentLabel(paydown.source_ledger_id ?? null, parentById),
      charge: null,
      paydown: reconciliationLineFromEntry(paydown, amount, "card-paydown"),
      netOnCard: amount,
    });
  }

  const matchedCount = rows.filter((row) => row.status === "matched").length;
  const unmatchedChargeRows = rows.filter(
    (row) =>
      row.status === "missing-paydown" ||
      (row.status === "amount-mismatch" && row.charge)
  );
  const unmatchedPaydownRows = rows.filter(
    (row) => row.status === "missing-charge"
  );

  return {
    rows,
    matchedCount,
    unmatchedChargeCount: unmatchedChargeRows.length,
    unmatchedPaydownCount: unmatchedPaydownRows.length,
    unmatchedChargeTotal: roundMoney(
      unmatchedChargeRows.reduce((sum, row) => sum + (row.charge?.amount ?? 0), 0)
    ),
    unmatchedPaydownTotal: roundMoney(
      unmatchedPaydownRows.reduce(
        (sum, row) => sum + (row.paydown?.amount ?? 0),
        0
      )
    ),
  };
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
    const line = reconciliationLineFromEntry(entry, amount, bucket);
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

  const unpaidTotal = roundMoney(
    grouped.unreimbursed.reduce((sum, line) => sum + line.amount, 0) +
      grouped["needs-identification"].reduce(
        (sum, line) => sum + line.amount,
        0
      )
  );
  const creditCardBalance = roundMoney(-unpaidTotal);

  const paydownPairing = buildCardPaydownPairing(
    entries,
    partner,
    parentById,
    resolveNetAmount
  );

  return { partner, buckets, creditCardBalance, byAccount, paydownPairing };
}
