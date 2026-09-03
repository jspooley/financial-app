import { isPersonalCardReimbursementCoa } from "@/lib/coa";
import type { CashflowAccount, LedgerEntry } from "@/lib/types";
import { CASHFLOW_ACCOUNTS } from "@/lib/types";

export function isCheckingAccount(
  account: string | null | undefined
): account is CashflowAccount {
  return Boolean(account?.startsWith("Checking"));
}

export function isCreditCardAccount(
  account: string | null | undefined
): account is CashflowAccount {
  return Boolean(
    account?.startsWith("Credit Card") || account?.startsWith("Lowes CC")
  );
}

export function wasMovedFromChecking(
  entry: Pick<LedgerEntry, "moved_from_account">
) {
  return isCheckingAccount(entry.moved_from_account);
}

/** 308 is the checking-side personal-card reimbursement — leave it on checking. */
export function isCardBillPaymentCoa(category: string | null | undefined) {
  return isPersonalCardReimbursementCoa(category);
}

export function matchingCreditCardAccount(
  account: string | null | undefined
): CashflowAccount | null {
  if (account === "Lowes CC - Jess") {
    return "Lowes CC - Jess";
  }
  if (account === "Checking - Jess" || account === "Credit Card - Jess") {
    return "Credit Card - Jess";
  }
  if (account === "Checking - Molly" || account === "Credit Card - Molly") {
    return "Credit Card - Molly";
  }
  return null;
}

export function matchingCheckingAccount(
  account: string | null | undefined
): CashflowAccount | null {
  if (
    account === "Credit Card - Jess" ||
    account === "Checking - Jess" ||
    account === "Lowes CC - Jess"
  ) {
    return "Checking - Jess";
  }
  if (account === "Credit Card - Molly" || account === "Checking - Molly") {
    return "Checking - Molly";
  }
  return null;
}

export function isCashflowAccount(
  value: string | null | undefined
): value is CashflowAccount {
  return (
    typeof value === "string" &&
    (CASHFLOW_ACCOUNTS as readonly string[]).includes(value)
  );
}

/**
 * First move remembers the origin. Restoring to that origin clears the stamp.
 * Later hops keep the original register so the cleanup trail stays intact.
 */
export function accountMoveFields(
  entry: Pick<LedgerEntry, "account" | "moved_from_account">,
  nextAccount: CashflowAccount
): {
  account: CashflowAccount;
  moved_from_account: CashflowAccount | null;
} {
  const current = isCashflowAccount(entry.account) ? entry.account : null;
  if (current === nextAccount) {
    return {
      account: nextAccount,
      moved_from_account: isCashflowAccount(entry.moved_from_account)
        ? entry.moved_from_account
        : null,
    };
  }
  const origin = isCashflowAccount(entry.moved_from_account)
    ? entry.moved_from_account
    : current;
  if (!origin) {
    return { account: nextAccount, moved_from_account: null };
  }
  if (nextAccount === origin) {
    return { account: nextAccount, moved_from_account: null };
  }
  return { account: nextAccount, moved_from_account: origin };
}

/** Stamp charge only on a checking → card move. Restoring to checking clears the role. */
export function personalCardRoleFields(
  entry: Pick<LedgerEntry, "account">,
  nextAccount: CashflowAccount
): {
  personal_card_role?: "charge" | null;
  reimbursed_by_ledger_id?: null;
} {
  if (isCheckingAccount(nextAccount)) {
    return { personal_card_role: null, reimbursed_by_ledger_id: null };
  }
  if (isCreditCardAccount(nextAccount) && isCheckingAccount(entry.account)) {
    return { personal_card_role: "charge" };
  }
  return {};
}

function isPurchaseCompanion(
  entry: Pick<LedgerEntry, "source_ledger_id" | "companion_kind">
) {
  if (!entry.source_ledger_id) return false;
  return (
    entry.companion_kind !== "payment" && entry.companion_kind !== "transfer"
  );
}

/** Parent plus shipping/tax/fee companions; never payment or transfer mates. */
export function relatedRowsForAccountMove(
  entry: LedgerEntry,
  all: LedgerEntry[]
): LedgerEntry[] {
  const parentId =
    isPurchaseCompanion(entry) && entry.source_ledger_id
      ? entry.source_ledger_id
      : entry.id;
  const parent = all.find((row) => row.id === parentId) ?? entry;
  const byId = new Map<string, LedgerEntry>();
  byId.set(parent.id, parent);
  for (const row of all) {
    if (row.source_ledger_id === parent.id && isPurchaseCompanion(row)) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}
