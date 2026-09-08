import { coaAccountNumber, isTaxesAndLicensesCoa } from "@/lib/coa";
import {
  isExcludedFromTrueUp,
  partnerFromEntry,
} from "@/lib/true-up-report";
import type { ChartOfAccount, LedgerEntry, Purchaser } from "@/lib/types";
import { isPendingPurchase } from "@/lib/types";
import { roundMoney } from "@/lib/utils";

export type ScheduleCTreatment =
  | "Gross receipts"
  | "Cost of goods sold"
  | "Other expense"
  | "Excluded from Schedule C";

export type ScheduleCSplit = {
  jess: number;
  molly: number;
  tbd: number;
  /** Each designer's share of the shared (true-up) pool. */
  perDesigner: number;
  sharedTotal: number;
  business: number;
};

export type ScheduleCCategoryRow = {
  category: string;
  treatment: ScheduleCTreatment;
  lineCount: number;
  debits: number;
  credits: number;
  jess: number;
  molly: number;
  tbd: number;
  perDesigner: number;
  scheduleCAmount: number;
};

export type ScheduleCReport = {
  rows: ScheduleCCategoryRow[];
  grossReceipts: ScheduleCSplit;
  cogs: ScheduleCSplit;
  otherExpenses: ScheduleCSplit;
  netProfit: ScheduleCSplit;
};

function emptySplit(): ScheduleCSplit {
  return {
    jess: 0,
    molly: 0,
    tbd: 0,
    perDesigner: 0,
    sharedTotal: 0,
    business: 0,
  };
}

function addSplit(left: ScheduleCSplit, right: ScheduleCSplit): ScheduleCSplit {
  return {
    jess: roundMoney(left.jess + right.jess),
    molly: roundMoney(left.molly + right.molly),
    tbd: roundMoney(left.tbd + right.tbd),
    perDesigner: roundMoney(left.perDesigner + right.perDesigner),
    sharedTotal: roundMoney(left.sharedTotal + right.sharedTotal),
    business: roundMoney(left.business + right.business),
  };
}

function subtractSplit(left: ScheduleCSplit, right: ScheduleCSplit): ScheduleCSplit {
  return {
    jess: roundMoney(left.jess - right.jess),
    molly: roundMoney(left.molly - right.molly),
    tbd: roundMoney(left.tbd - right.tbd),
    perDesigner: roundMoney(left.perDesigner - right.perDesigner),
    sharedTotal: roundMoney(left.sharedTotal - right.sharedTotal),
    business: roundMoney(left.business - right.business),
  };
}

export function scheduleCTreatment(category: string): ScheduleCTreatment {
  const accountNumber = coaAccountNumber(category);
  if (accountNumber === 100) return "Gross receipts";
  if (accountNumber === 101) return "Cost of goods sold";
  if (accountNumber != null && accountNumber >= 200 && accountNumber < 300) {
    return "Other expense";
  }
  return "Excluded from Schedule C";
}

function scheduleCLineAmount(
  treatment: ScheduleCTreatment,
  debits: number,
  credits: number
) {
  if (treatment === "Gross receipts") return roundMoney(credits - debits);
  if (treatment === "Cost of goods sold" || treatment === "Other expense") {
    return roundMoney(debits - credits);
  }
  return 0;
}

function addToParty(
  split: ScheduleCSplit,
  party: Purchaser,
  amount: number
) {
  if (!amount) return;
  if (party === "Molly") split.molly = roundMoney(split.molly + amount);
  else if (party === "TBD") split.tbd = roundMoney(split.tbd + amount);
  else split.jess = roundMoney(split.jess + amount);
}

function excludedParty(
  entry: LedgerEntry,
  treatment: ScheduleCTreatment
): Purchaser {
  if (treatment === "Gross receipts") {
    return partnerFromEntry(entry, "payee");
  }
  if (treatment === "Cost of goods sold" && isPendingPurchase(entry)) {
    return "TBD";
  }
  return partnerFromEntry(entry, "payer");
}

function staysWithPayer(entry: LedgerEntry) {
  const accountNumber = coaAccountNumber(entry.coa_category);
  return (
    isExcludedFromTrueUp(entry) ||
    isTaxesAndLicensesCoa(entry.coa_category) ||
    accountNumber === 203
  );
}

/**
 * 100, 101, and other 200-series split 50/50 unless excluded from true-up.
 * 203 commissions/fees and 214 taxes stay with who paid.
 */
function allocateLine(
  split: ScheduleCSplit,
  entry: LedgerEntry,
  treatment: ScheduleCTreatment,
  amount: number
) {
  if (!amount || treatment === "Excluded from Schedule C") return;
  if (staysWithPayer(entry)) {
    addToParty(split, excludedParty(entry, treatment), amount);
    return;
  }
  split.sharedTotal = roundMoney(split.sharedTotal + amount);
}

function finalizeSplit(split: ScheduleCSplit): ScheduleCSplit {
  const perDesigner = roundMoney(split.sharedTotal / 2);
  return {
    jess: roundMoney(split.jess),
    molly: roundMoney(split.molly),
    tbd: roundMoney(split.tbd),
    perDesigner,
    sharedTotal: roundMoney(split.sharedTotal),
    business: roundMoney(
      split.jess + split.molly + split.tbd + split.sharedTotal
    ),
  };
}

export function buildScheduleCReport(
  entries: LedgerEntry[],
  chartOfAccounts: ChartOfAccount[],
  year: string
): ScheduleCReport {
  const yearEntries = entries.filter((entry) =>
    entry.entry_date.startsWith(`${year}-`)
  );
  const categories = new Set(
    chartOfAccounts.map((account) => account.category.trim()).filter(Boolean)
  );
  for (const entry of yearEntries) {
    categories.add(entry.coa_category?.trim() || "Uncategorized");
  }

  const rows: ScheduleCCategoryRow[] = [...categories]
    .map((category) => {
      const treatment = scheduleCTreatment(category);
      const categoryEntries = yearEntries.filter(
        (entry) => (entry.coa_category?.trim() || "Uncategorized") === category
      );
      const debits = roundMoney(
        categoryEntries.reduce(
          (sum, entry) => sum + Number(entry.debit_amount ?? 0),
          0
        )
      );
      const credits = roundMoney(
        categoryEntries.reduce(
          (sum, entry) => sum + Number(entry.credit_amount ?? 0),
          0
        )
      );
      const split = emptySplit();
      if (treatment !== "Excluded from Schedule C") {
        for (const entry of categoryEntries) {
          if (entry.balance_sheet) continue;
          const amount = scheduleCLineAmount(
            treatment,
            Number(entry.debit_amount ?? 0),
            Number(entry.credit_amount ?? 0)
          );
          allocateLine(split, entry, treatment, amount);
        }
      }
      const finalized = finalizeSplit(split);
      return {
        category,
        treatment,
        lineCount: categoryEntries.length,
        debits,
        credits,
        jess: finalized.jess,
        molly: finalized.molly,
        tbd: finalized.tbd,
        perDesigner: finalized.perDesigner,
        scheduleCAmount: finalized.business,
      };
    })
    .sort((a, b) => {
      const aNumber = coaAccountNumber(a.category) ?? Number.MAX_SAFE_INTEGER;
      const bNumber = coaAccountNumber(b.category) ?? Number.MAX_SAFE_INTEGER;
      return aNumber - bNumber || a.category.localeCompare(b.category);
    });

  const grossReceipts = emptySplit();
  const cogs = emptySplit();
  const otherExpenses = emptySplit();
  for (const row of rows) {
    const piece: ScheduleCSplit = {
      jess: row.jess,
      molly: row.molly,
      tbd: row.tbd,
      perDesigner: row.perDesigner,
      sharedTotal: roundMoney(
        row.scheduleCAmount - row.jess - row.molly - row.tbd
      ),
      business: row.scheduleCAmount,
    };
    if (row.treatment === "Gross receipts") {
      Object.assign(grossReceipts, addSplit(grossReceipts, piece));
    } else if (row.treatment === "Cost of goods sold") {
      Object.assign(cogs, addSplit(cogs, piece));
    } else if (row.treatment === "Other expense") {
      Object.assign(otherExpenses, addSplit(otherExpenses, piece));
    }
  }

  const finalizedGross = finalizeSplit(grossReceipts);
  const finalizedCogs = finalizeSplit(cogs);
  const finalizedOpex = finalizeSplit(otherExpenses);
  const netProfit = subtractSplit(
    subtractSplit(finalizedGross, finalizedCogs),
    finalizedOpex
  );

  return {
    rows,
    grossReceipts: finalizedGross,
    cogs: finalizedCogs,
    otherExpenses: finalizedOpex,
    netProfit,
  };
}
