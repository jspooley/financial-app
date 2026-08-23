import {
  isBusinessLoanPaybackCoa,
  isOwnerContributionCoa,
  partnerFromOwnerCapitalCoa,
} from "@/lib/coa";
import {
  cardReimburseNet,
  isUnreimbursedBusinessPersonalCardCharge,
} from "@/lib/card-reimbursement";
import { partnerFromEntry } from "@/lib/true-up-report";
import type { LedgerEntry, Purchaser } from "@/lib/types";
import { roundMoney } from "@/lib/utils";

export type PersonalFundsPartnerFilter = Purchaser | "Both";

export type PersonalFundsLine = {
  id: string;
  date: string;
  account: string;
  description: string;
  category: string;
  partner: Purchaser;
  amount: number;
};

export type PersonalFundsReport = {
  partner: PersonalFundsPartnerFilter;
  unreimbursedCardCharges: PersonalFundsLine[];
  unreimbursedTotal: number;
  contributions: PersonalFundsLine[];
  contributionTotal: number;
  loanPaybacks: PersonalFundsLine[];
  loanPaybackTotal: number;
  capitalNet: number;
  personalFundsUsed: number;
  /** Signed: unreimbursed (neg) + business loans (neg) + repayments (pos). */
  netBusinessDebt: number;
};

function matchesPartner(
  partner: Purchaser,
  filter: PersonalFundsPartnerFilter
) {
  return filter === "Both" || partner === filter;
}

function isParentRow(entry: LedgerEntry) {
  return !entry.source_ledger_id;
}

function cashIn(entry: LedgerEntry) {
  return roundMoney(
    Number(entry.credit_amount ?? 0) - Number(entry.debit_amount ?? 0)
  );
}

function cashOut(entry: LedgerEntry) {
  return roundMoney(
    Number(entry.debit_amount ?? 0) - Number(entry.credit_amount ?? 0)
  );
}

function lineFromEntry(
  entry: LedgerEntry,
  amount: number,
  categoryFallback: string,
  partner = partnerFromOwnerCapitalCoa(entry.coa_category) ??
    partnerFromEntry(entry)
): PersonalFundsLine {
  return {
    id: entry.id,
    date: entry.entry_date,
    account: entry.account ?? "—",
    description: entry.description?.trim() || "—",
    category: entry.coa_category?.trim() || categoryFallback,
    partner,
    amount,
  };
}

function sortLines(lines: PersonalFundsLine[]) {
  return [...lines].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return a.id.localeCompare(b.id);
  });
}

function sumLines(lines: PersonalFundsLine[]) {
  return roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
}

export function isOwnerContributionRow(entry: LedgerEntry) {
  return isParentRow(entry) && isOwnerContributionCoa(entry.coa_category);
}

export function isBusinessLoanPaybackRow(entry: LedgerEntry) {
  return isParentRow(entry) && isBusinessLoanPaybackCoa(entry.coa_category);
}

export function buildPersonalFundsReport(
  entries: LedgerEntry[],
  partner: PersonalFundsPartnerFilter = "Both"
): PersonalFundsReport {
  const parentById = new Map(entries.map((entry) => [entry.id, entry]));
  const unreimbursedCardCharges = sortLines(
    entries
      .filter((entry) =>
        isUnreimbursedBusinessPersonalCardCharge(entry, parentById)
      )
      .map((entry) =>
        lineFromEntry(
          entry,
          cardReimburseNet(entry),
          entry.coa_category ?? "Card charge",
          partnerFromEntry(entry)
        )
      )
      .filter((line) => matchesPartner(line.partner, partner))
  );

  const contributions = sortLines(
    entries
      .filter(isOwnerContributionRow)
      .map((entry) =>
        lineFromEntry(entry, cashIn(entry), "Owner's Contribution")
      )
      .filter((line) => matchesPartner(line.partner, partner))
  );

  const loanPaybacks = sortLines(
    entries
      .filter(isBusinessLoanPaybackRow)
      .map((entry) =>
        lineFromEntry(entry, cashOut(entry), "Biz Loan Payback")
      )
      .filter((line) => matchesPartner(line.partner, partner))
  );

  const unreimbursedTotal = sumLines(unreimbursedCardCharges);
  const contributionTotal = sumLines(contributions);
  const loanPaybackTotal = sumLines(loanPaybacks);
  const capitalNet = roundMoney(contributionTotal - loanPaybackTotal);
  const netBusinessDebt = roundMoney(
    -unreimbursedTotal - contributionTotal + loanPaybackTotal
  );

  return {
    partner,
    unreimbursedCardCharges,
    unreimbursedTotal,
    contributions,
    contributionTotal,
    loanPaybacks,
    loanPaybackTotal,
    capitalNet,
    personalFundsUsed: roundMoney(unreimbursedTotal + capitalNet),
    netBusinessDebt,
  };
}

/** Positive when the business owes; opposite sign of netBusinessDebt. */
export function businessDebtCostFromReport(report: PersonalFundsReport) {
  return roundMoney(-report.netBusinessDebt);
}
