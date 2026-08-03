"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { InputField, TextareaField } from "@/components/ui/FormFields";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  compareBankAndCashflow,
  parseFlexibleAmount,
  parseTransactionPaste,
  type BankCashflowComparison,
  type CompareTransaction,
} from "@/lib/bank-cashflow-compare";
import { formatCurrency, formatDate } from "@/lib/utils";

function SummaryCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok" | "warn";
}) {
  const valueClass =
    tone === "ok"
      ? "text-emerald-800"
      : tone === "warn"
        ? "text-amber-800"
        : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${valueClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function formatTxnDate(date: string) {
  return date ? formatDate(date) : "—";
}

function txnRows(transactions: CompareTransaction[]) {
  return transactions.map((txn) => ({
    date: formatTxnDate(txn.date),
    description: txn.description,
    amount: formatCurrency(txn.amount),
  }));
}

function parseOptionalBalance(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return parseFlexibleAmount(trimmed);
}

export default function BankCashflowComparisonPage() {
  const [bankPaste, setBankPaste] = useState("");
  const [cashflowPaste, setCashflowPaste] = useState("");
  const [bankBalanceInput, setBankBalanceInput] = useState("");
  const [cashflowBalanceInput, setCashflowBalanceInput] = useState("");
  const [comparison, setComparison] = useState<BankCashflowComparison | null>(
    null
  );
  const [bankWarnings, setBankWarnings] = useState<string[]>([]);
  const [cashflowWarnings, setCashflowWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const hasResult = comparison != null;

  const gapTone = (amount: number | null) => {
    if (amount == null) return "default" as const;
    return Math.abs(amount) < 0.005 ? ("ok" as const) : ("warn" as const);
  };

  function handleCompare() {
    setError(null);
    const bankParsed = parseTransactionPaste(bankPaste, "bank");
    const cashflowParsed = parseTransactionPaste(cashflowPaste, "cashflow");
    setBankWarnings(bankParsed.warnings);
    setCashflowWarnings(cashflowParsed.warnings);

    if (
      bankParsed.transactions.length === 0 &&
      cashflowParsed.transactions.length === 0
    ) {
      setComparison(null);
      setError(
        "Paste bank and cashflow transactions (with dates and amounts), then run the comparison."
      );
      return;
    }

    const bankBalance =
      parseOptionalBalance(bankBalanceInput) ?? bankParsed.detectedBalance;
    const cashflowBalance =
      parseOptionalBalance(cashflowBalanceInput) ??
      cashflowParsed.detectedBalance;

    if (bankParsed.detectedBalance != null && !bankBalanceInput.trim()) {
      setBankBalanceInput(String(bankParsed.detectedBalance));
    }
    if (cashflowParsed.detectedBalance != null && !cashflowBalanceInput.trim()) {
      setCashflowBalanceInput(String(cashflowParsed.detectedBalance));
    }

    setComparison(
      compareBankAndCashflow({
        bankTransactions: bankParsed.transactions,
        cashflowTransactions: cashflowParsed.transactions,
        bankBalance,
        cashflowBalance,
      })
    );
  }

  function handleClear() {
    setBankPaste("");
    setCashflowPaste("");
    setBankBalanceInput("");
    setCashflowBalanceInput("");
    setComparison(null);
    setBankWarnings([]);
    setCashflowWarnings([]);
    setError(null);
  }

  const matchRows = useMemo(() => {
    if (!comparison) return [];
    return comparison.matches.map((match) => ({
      kind:
        match.matchKind === "exact"
          ? "Exact"
          : match.matchKind === "near-date"
            ? "Near date"
            : "Amount only",
      date: formatTxnDate(match.bank.date || match.cashflow.date),
      amount: formatCurrency(match.bank.amount),
      bank: match.bank.description,
      cashflow: match.cashflow.description,
    }));
  }, [comparison]);

  return (
    <AppShell>
      <PageHeader
        title="Bank vs Cashflow Comparison"
        description="Paste transactions (and optional ending balances) from your bank and from Cashflow, then run a comparison to surface differences."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleClear}>
              Clear
            </Button>
            <Button onClick={handleCompare}>Run comparison</Button>
          </div>
        }
      />

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
        <p className="font-medium text-slate-800">Paste tips</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Copy rows from Excel, your bank site, or Cashflow (tab-separated works
            best). Include a header row when you can:{" "}
            <span className="font-medium">Date</span>,{" "}
            <span className="font-medium">Description</span>,{" "}
            <span className="font-medium">Amount</span> — or Debit / Credit
            columns.
          </li>
          <li>
            Amounts are normalized as{" "}
            <span className="font-medium">+ deposits / credits</span> and{" "}
            <span className="font-medium">− withdrawals / debits</span> (Cashflow
            Debit/Credit columns use credit − debit).
          </li>
          <li>
            Matching prefers same date + amount, then amount within 3 days, then
            amount only.
          </li>
        </ul>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <TextareaField
            label="Bank transactions"
            value={bankPaste}
            onChange={(event) => setBankPaste(event.target.value)}
            rows={12}
            className="min-h-48 font-mono text-xs"
            placeholder={"Date\tDescription\tAmount\n8/1/2026\tDeposit\t1500.00\n8/3/2026\tOffice supply\t-42.18"}
            hint="Paste bank register / statement lines here."
          />
          <InputField
            label="Bank ending balance (optional)"
            value={bankBalanceInput}
            onChange={(event) => setBankBalanceInput(event.target.value)}
            placeholder="e.g. 12,450.22"
            hint="Leave blank to use a Balance column / balance line from the paste when detected."
          />
          {bankWarnings.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-800">
              {bankWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <TextareaField
            label="Cashflow transactions"
            value={cashflowPaste}
            onChange={(event) => setCashflowPaste(event.target.value)}
            rows={12}
            className="min-h-48 font-mono text-xs"
            placeholder={"Date\tDescription\tDebit\tCredit\nAug 1, 2026\tClient payment\t\t1500.00\nAug 3, 2026\tSupplies\t42.18\t"}
            hint="Paste Cashflow rows here (Debit and Credit columns are supported)."
          />
          <InputField
            label="Cashflow ending balance (optional)"
            value={cashflowBalanceInput}
            onChange={(event) => setCashflowBalanceInput(event.target.value)}
            placeholder="e.g. 12,372.67"
            hint="Use the Checking balance from Cashflow for the same period when possible."
          />
          {cashflowWarnings.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-800">
              {cashflowWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {hasResult && comparison && (
        <div className="mt-6 space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="Matched"
              value={String(comparison.matches.length)}
              hint="Same amount found on both sides"
              tone="ok"
            />
            <SummaryCard
              label="Bank only"
              value={String(comparison.bankOnly.length)}
              hint="On bank paste, not in cashflow"
              tone={comparison.bankOnly.length ? "warn" : "ok"}
            />
            <SummaryCard
              label="Cashflow only"
              value={String(comparison.cashflowOnly.length)}
              hint="In cashflow paste, not on bank"
              tone={comparison.cashflowOnly.length ? "warn" : "ok"}
            />
            <SummaryCard
              label="Txn total gap (bank − cashflow)"
              value={formatCurrency(comparison.transactionGap)}
              hint={`Bank ${formatCurrency(comparison.bankTotal)} vs Cashflow ${formatCurrency(comparison.cashflowTotal)}`}
              tone={gapTone(comparison.transactionGap)}
            />
          </div>

          {(comparison.bankBalance != null ||
            comparison.cashflowBalance != null) && (
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryCard
                label="Bank balance"
                value={
                  comparison.bankBalance == null
                    ? "—"
                    : formatCurrency(comparison.bankBalance)
                }
              />
              <SummaryCard
                label="Cashflow balance"
                value={
                  comparison.cashflowBalance == null
                    ? "—"
                    : formatCurrency(comparison.cashflowBalance)
                }
              />
              <SummaryCard
                label="Balance gap (bank − cashflow)"
                value={
                  comparison.balanceGap == null
                    ? "—"
                    : formatCurrency(comparison.balanceGap)
                }
                tone={gapTone(comparison.balanceGap)}
              />
            </div>
          )}

          {comparison.bankOnly.length > 0 && (
            <section>
              <h2 className="mb-2 text-base font-bold text-slate-900">
                On bank, missing from cashflow
              </h2>
              <DataTable
                columns={[
                  { key: "date", label: "Date" },
                  { key: "description", label: "Description" },
                  { key: "amount", label: "Amount" },
                ]}
                rows={txnRows(comparison.bankOnly)}
                emptyMessage="None"
              />
            </section>
          )}

          {comparison.cashflowOnly.length > 0 && (
            <section>
              <h2 className="mb-2 text-base font-bold text-slate-900">
                In cashflow, missing from bank
              </h2>
              <DataTable
                columns={[
                  { key: "date", label: "Date" },
                  { key: "description", label: "Description" },
                  { key: "amount", label: "Amount" },
                ]}
                rows={txnRows(comparison.cashflowOnly)}
                emptyMessage="None"
              />
            </section>
          )}

          <section>
            <h2 className="mb-2 text-base font-bold text-slate-900">
              Matched transactions
            </h2>
            <DataTable
              columns={[
                { key: "kind", label: "Match" },
                { key: "date", label: "Date" },
                { key: "amount", label: "Amount" },
                { key: "bank", label: "Bank" },
                { key: "cashflow", label: "Cashflow" },
              ]}
              rows={matchRows}
              emptyMessage="No matching amounts between the pastes."
            />
          </section>
        </div>
      )}
    </AppShell>
  );
}
