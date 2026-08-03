import { roundMoney } from "@/lib/utils";

/** Signed amount: + money in (deposit / cashflow credit), − money out (withdrawal / debit). */
export type CompareTransaction = {
  id: string;
  date: string; // YYYY-MM-DD when parseable, else ""
  description: string;
  amount: number;
  raw: string;
};

export type PasteParseResult = {
  transactions: CompareTransaction[];
  detectedBalance: number | null;
  warnings: string[];
};

export type CompareMatch = {
  bank: CompareTransaction;
  cashflow: CompareTransaction;
  matchKind: "exact" | "near-date" | "amount-only";
};

export type BankCashflowComparison = {
  matches: CompareMatch[];
  bankOnly: CompareTransaction[];
  cashflowOnly: CompareTransaction[];
  bankTotal: number;
  cashflowTotal: number;
  transactionGap: number;
  bankBalance: number | null;
  cashflowBalance: number | null;
  balanceGap: number | null;
};

const DATE_HEADER = /^(date|posted|posting date|transaction date|trans date|entry date)$/i;
const DESC_HEADER =
  /^(description|desc|memo|payee|name|details|transaction|particulars)$/i;
const AMOUNT_HEADER = /^(amount|amt|value|sum)$/i;
const DEBIT_HEADER = /^(debit|debits|withdrawal|withdrawals|out|paid out|charge|charges)$/i;
const CREDIT_HEADER = /^(credit|credits|deposit|deposits|in|paid in|payment)$/i;
const BALANCE_HEADER = /^(balance|running balance|ending balance|available)$/i;

const DATE_PATTERNS: RegExp[] = [
  /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/,
  /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/,
  /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/,
  /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/,
];

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function normalizeYear(year: number) {
  if (year < 100) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

export function parseFlexibleDate(value: string): string | null {
  const raw = value.trim().replace(/\u00a0/g, " ");
  if (!raw) return null;

  for (const pattern of DATE_PATTERNS) {
    const match = raw.match(pattern);
    if (!match) continue;

    if (pattern === DATE_PATTERNS[0]) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }

    if (pattern === DATE_PATTERNS[1] || pattern === DATE_PATTERNS[2]) {
      const month = Number(match[1]);
      const day = Number(match[2]);
      const year = normalizeYear(Number(match[3]));
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }

    if (pattern === DATE_PATTERNS[3]) {
      const month = MONTHS[match[1].toLowerCase()];
      const day = Number(match[2]);
      const year = normalizeYear(Number(match[3]));
      if (!month || day < 1 || day > 31) return null;
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }

    if (pattern === DATE_PATTERNS[4]) {
      const day = Number(match[1]);
      const month = MONTHS[match[2].toLowerCase()];
      const year = normalizeYear(Number(match[3]));
      if (!month || day < 1 || day > 31) return null;
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  return null;
}

export function parseFlexibleAmount(value: string): number | null {
  let raw = value.trim().replace(/\u00a0/g, " ");
  if (!raw || raw === "—" || raw === "-" || raw === "–") return null;

  let negative = false;
  if (/^\(.*\)$/.test(raw)) {
    negative = true;
    raw = raw.slice(1, -1);
  }
  if (/^-/.test(raw)) {
    negative = true;
    raw = raw.replace(/^-/, "");
  }
  if (/\bDR\b/i.test(raw) || /\bDEB\b/i.test(raw)) {
    negative = true;
  }
  if (/\bCR\b/i.test(raw)) {
    // credit marker; keep positive unless already negative from parentheses
  }

  raw = raw.replace(/[$,\s]/g, "").replace(/DR|CR|DEB/gi, "");
  if (!raw || !/^-?\d+(\.\d+)?$/.test(raw.replace(/^-/, ""))) {
    const numeric = raw.match(/-?\d+(\.\d+)?/);
    if (!numeric) return null;
    raw = numeric[0];
  }

  const amount = Number(raw);
  if (!Number.isFinite(amount)) return null;
  const signed = negative ? -Math.abs(amount) : amount;
  return roundMoney(signed);
}

function splitLine(line: string): string[] {
  if (line.includes("\t")) {
    return line.split("\t").map((cell) => cell.trim());
  }
  // Prefer CSV when quotes/commas look structured.
  if (/,"|",/.test(line) || (line.includes(",") && /\$?\d/.test(line))) {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    cells.push(current.trim());
    if (cells.length >= 2) return cells;
  }
  // Multi-space columns (copied plain text).
  return line.split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
}

function looksLikeHeader(cells: string[]) {
  const joined = cells.join(" ").toLowerCase();
  return (
    DATE_HEADER.test(cells[0] ?? "") ||
    cells.some((cell) => DATE_HEADER.test(cell)) ||
    cells.some((cell) => AMOUNT_HEADER.test(cell)) ||
    cells.some((cell) => DEBIT_HEADER.test(cell)) ||
    cells.some((cell) => CREDIT_HEADER.test(cell)) ||
    /\bdate\b/.test(joined)
  );
}

type ColumnMap = {
  date?: number;
  description?: number;
  amount?: number;
  debit?: number;
  credit?: number;
  balance?: number;
};

function mapHeaders(cells: string[]): ColumnMap {
  const map: ColumnMap = {};
  cells.forEach((cell, index) => {
    const value = cell.trim();
    if (DATE_HEADER.test(value) && map.date === undefined) map.date = index;
    else if (DESC_HEADER.test(value) && map.description === undefined) {
      map.description = index;
    } else if (DEBIT_HEADER.test(value) && map.debit === undefined) map.debit = index;
    else if (CREDIT_HEADER.test(value) && map.credit === undefined) map.credit = index;
    else if (AMOUNT_HEADER.test(value) && map.amount === undefined) map.amount = index;
    else if (BALANCE_HEADER.test(value) && map.balance === undefined) map.balance = index;
  });
  return map;
}

function inferColumns(rows: string[][]): ColumnMap {
  const map: ColumnMap = {};
  const sample = rows.slice(0, 12);
  const width = Math.max(...sample.map((row) => row.length), 0);

  for (let col = 0; col < width; col += 1) {
    let dates = 0;
    let amounts = 0;
    let texts = 0;
    for (const row of sample) {
      const cell = row[col] ?? "";
      if (!cell) continue;
      if (parseFlexibleDate(cell)) dates += 1;
      else if (parseFlexibleAmount(cell) != null) amounts += 1;
      else if (/[A-Za-z]/.test(cell)) texts += 1;
    }
    if (map.date === undefined && dates >= Math.max(1, Math.floor(sample.length / 3))) {
      map.date = col;
    } else if (amounts >= Math.max(1, Math.floor(sample.length / 3))) {
      if (map.debit === undefined && map.amount === undefined) map.debit = col;
      else if (map.credit === undefined && map.debit !== undefined && map.amount === undefined) {
        map.credit = col;
      } else if (map.amount === undefined && map.debit === undefined) {
        map.amount = col;
      } else if (map.balance === undefined) {
        map.balance = col;
      }
    } else if (map.description === undefined && texts >= Math.max(1, Math.floor(sample.length / 3))) {
      map.description = col;
    }
  }

  // If we inferred debit+credit, treat as D/C pair (not amount+balance).
  if (map.debit !== undefined && map.credit !== undefined) {
    delete map.amount;
  } else if (map.debit !== undefined && map.credit === undefined && map.amount === undefined) {
    // Single money column inferred as debit → treat as signed amount column.
    map.amount = map.debit;
    delete map.debit;
  }

  return map;
}

function lineLooksLikeBalance(line: string) {
  return /\b(ending|available|current|ledger|closing)?\s*balance\b/i.test(line);
}

function cents(amount: number) {
  return Math.round(amount * 100);
}

function dayDistance(a: string, b: string) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const aParts = a.split("-").map(Number);
  const bParts = b.split("-").map(Number);
  if (aParts.length !== 3 || bParts.length !== 3) return Number.POSITIVE_INFINITY;
  const aDate = Date.UTC(aParts[0], aParts[1] - 1, aParts[2]);
  const bDate = Date.UTC(bParts[0], bParts[1] - 1, bParts[2]);
  return Math.abs(aDate - bDate) / (24 * 60 * 60 * 1000);
}

/**
 * Parse a bank or cashflow paste (TSV / CSV / multi-space).
 * Signed amounts: deposits/credits positive, withdrawals/debits negative.
 * For debit+credit columns, credit − debit (checking-style net contribution).
 */
export function parseTransactionPaste(
  text: string,
  idPrefix: string
): PasteParseResult {
  const warnings: string[] = [];
  const transactions: CompareTransaction[] = [];
  let detectedBalance: number | null = null;

  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { transactions, detectedBalance, warnings };
  }

  // Standalone balance lines (any row mentioning balance + one amount).
  for (const line of lines) {
    if (!lineLooksLikeBalance(line)) continue;
    const amounts = line
      .split(/[\t,]/)
      .map((part) => parseFlexibleAmount(part))
      .filter((value): value is number => value != null);
    // Also try whole-line amount scrape.
    const moneyMatches = [...line.matchAll(/-?\$?\(?\d[\d,]*\.?\d*\)?(?:\s*(?:CR|DR))?/gi)]
      .map((match) => parseFlexibleAmount(match[0]))
      .filter((value): value is number => value != null);
    const candidates = amounts.length ? amounts : moneyMatches;
    if (candidates.length) {
      detectedBalance = candidates[candidates.length - 1];
    }
  }

  const rows = lines.map(splitLine).filter((row) => row.some((cell) => cell.trim()));
  if (rows.length === 0) {
    return { transactions, detectedBalance, warnings };
  }

  let startIndex = 0;
  let columns: ColumnMap = {};
  if (looksLikeHeader(rows[0])) {
    columns = mapHeaders(rows[0]);
    startIndex = 1;
  }
  if (
    columns.date === undefined &&
    columns.amount === undefined &&
    columns.debit === undefined
  ) {
    columns = { ...inferColumns(rows.slice(startIndex)), ...columns };
  }

  if (
    columns.date === undefined &&
    columns.amount === undefined &&
    columns.debit === undefined &&
    columns.credit === undefined
  ) {
    warnings.push(
      "Could not detect date/amount columns. Use a header row (Date, Description, Amount) or Debit/Credit columns."
    );
    return { transactions, detectedBalance, warnings };
  }

  let skipped = 0;
  for (let i = startIndex; i < rows.length; i += 1) {
    const row = rows[i];
    const raw = lines[i] ?? row.join("\t");
    if (lineLooksLikeBalance(raw) && row.length <= 3) {
      continue;
    }

    const dateCell =
      columns.date !== undefined ? (row[columns.date] ?? "") : row.find((cell) => parseFlexibleDate(cell)) ?? "";
    const date = parseFlexibleDate(dateCell) ?? "";

    let description = "";
    if (columns.description !== undefined) {
      description = row[columns.description] ?? "";
    } else {
      description =
        row
          .filter((cell, index) => {
            if (index === columns.date) return false;
            if (index === columns.amount) return false;
            if (index === columns.debit) return false;
            if (index === columns.credit) return false;
            if (index === columns.balance) return false;
            return /[A-Za-z]/.test(cell);
          })
          .sort((a, b) => b.length - a.length)[0] ?? "";
    }

    let amount: number | null = null;
    if (columns.debit !== undefined || columns.credit !== undefined) {
      const debit =
        columns.debit !== undefined
          ? parseFlexibleAmount(row[columns.debit] ?? "")
          : null;
      const credit =
        columns.credit !== undefined
          ? parseFlexibleAmount(row[columns.credit] ?? "")
          : null;
      const debitAbs = debit != null ? Math.abs(debit) : 0;
      const creditAbs = credit != null ? Math.abs(credit) : 0;
      if (debitAbs < 0.005 && creditAbs < 0.005) {
        skipped += 1;
        continue;
      }
      // Checking-style: credits increase cash, debits decrease cash.
      amount = roundMoney(creditAbs - debitAbs);
    } else if (columns.amount !== undefined) {
      amount = parseFlexibleAmount(row[columns.amount] ?? "");
    } else {
      const moneyCells = row
        .map((cell) => parseFlexibleAmount(cell))
        .filter((value): value is number => value != null);
      amount = moneyCells.length ? moneyCells[0] : null;
    }

    if (amount == null || Math.abs(amount) < 0.005) {
      skipped += 1;
      continue;
    }

    if (columns.balance !== undefined) {
      const balance = parseFlexibleAmount(row[columns.balance] ?? "");
      if (balance != null) detectedBalance = balance;
    }

    transactions.push({
      id: `${idPrefix}-${transactions.length + 1}`,
      date,
      description: description.trim() || "(no description)",
      amount: roundMoney(amount),
      raw,
    });
  }

  if (skipped > 0) {
    warnings.push(`Skipped ${skipped} row${skipped === 1 ? "" : "s"} without a usable amount.`);
  }
  if (transactions.some((txn) => !txn.date)) {
    warnings.push("Some rows are missing a parseable date; those can only match by amount.");
  }

  return { transactions, detectedBalance, warnings };
}

function takeMatch(
  bankPool: CompareTransaction[],
  cashflowPool: CompareTransaction[],
  predicate: (bank: CompareTransaction, cashflow: CompareTransaction) => boolean,
  matchKind: CompareMatch["matchKind"]
): CompareMatch[] {
  const matches: CompareMatch[] = [];
  const usedCashflow = new Set<string>();

  for (const bank of [...bankPool]) {
    const cashflow = cashflowPool.find(
      (row) => !usedCashflow.has(row.id) && predicate(bank, row)
    );
    if (!cashflow) continue;
    usedCashflow.add(cashflow.id);
    matches.push({ bank, cashflow, matchKind });
    const bankIndex = bankPool.findIndex((row) => row.id === bank.id);
    const cashIndex = cashflowPool.findIndex((row) => row.id === cashflow.id);
    if (bankIndex >= 0) bankPool.splice(bankIndex, 1);
    if (cashIndex >= 0) cashflowPool.splice(cashIndex, 1);
  }

  return matches;
}

export function compareBankAndCashflow(options: {
  bankTransactions: CompareTransaction[];
  cashflowTransactions: CompareTransaction[];
  bankBalance?: number | null;
  cashflowBalance?: number | null;
}): BankCashflowComparison {
  const bankPool = [...options.bankTransactions];
  const cashflowPool = [...options.cashflowTransactions];

  const matches: CompareMatch[] = [
    ...takeMatch(
      bankPool,
      cashflowPool,
      (bank, cashflow) =>
        bank.date !== "" &&
        bank.date === cashflow.date &&
        cents(bank.amount) === cents(cashflow.amount),
      "exact"
    ),
    ...takeMatch(
      bankPool,
      cashflowPool,
      (bank, cashflow) =>
        cents(bank.amount) === cents(cashflow.amount) &&
        dayDistance(bank.date, cashflow.date) <= 3,
      "near-date"
    ),
    ...takeMatch(
      bankPool,
      cashflowPool,
      (bank, cashflow) => cents(bank.amount) === cents(cashflow.amount),
      "amount-only"
    ),
  ];

  const bankTotal = roundMoney(
    options.bankTransactions.reduce((sum, row) => sum + row.amount, 0)
  );
  const cashflowTotal = roundMoney(
    options.cashflowTransactions.reduce((sum, row) => sum + row.amount, 0)
  );
  const bankBalance =
    options.bankBalance == null || !Number.isFinite(options.bankBalance)
      ? null
      : roundMoney(options.bankBalance);
  const cashflowBalance =
    options.cashflowBalance == null || !Number.isFinite(options.cashflowBalance)
      ? null
      : roundMoney(options.cashflowBalance);

  return {
    matches,
    bankOnly: bankPool,
    cashflowOnly: cashflowPool,
    bankTotal,
    cashflowTotal,
    transactionGap: roundMoney(bankTotal - cashflowTotal),
    bankBalance,
    cashflowBalance,
    balanceGap:
      bankBalance == null || cashflowBalance == null
        ? null
        : roundMoney(bankBalance - cashflowBalance),
  };
}
