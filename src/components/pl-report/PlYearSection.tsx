"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { GoalGauge } from "@/components/pl-report/GoalGauge";
import {
  PlTotalsCards,
  type PlExpenseDetailRow,
} from "@/components/pl-report/PlTotalsCards";
import type { PlTotals } from "@/lib/pl-report";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatPercent } from "@/lib/utils";

const MARGIN_GOAL_STORAGE_KEY = "maison-joy-gp-margin-goal";
const GROSS_PROFIT_GOAL_STORAGE_KEY = "maison-joy-gp-goal";
const NET_PROFIT_GOAL_STORAGE_KEY = "maison-joy-np-goal";
const NET_MARGIN_GOAL_STORAGE_KEY = "maison-joy-np-margin-goal";

const GOAL_FIELDS = [
  {
    column: "gross_profit_margin",
    storageKey: MARGIN_GOAL_STORAGE_KEY,
  },
  {
    column: "gross_profit",
    storageKey: GROSS_PROFIT_GOAL_STORAGE_KEY,
  },
  {
    column: "net_profit",
    storageKey: NET_PROFIT_GOAL_STORAGE_KEY,
  },
  {
    column: "net_profit_margin",
    storageKey: NET_MARGIN_GOAL_STORAGE_KEY,
  },
] as const;

export type SavedBusinessGoals = {
  grossProfitMargin: number | null;
  grossProfit: number | null;
  netProfit: number | null;
  netProfitMargin: number | null;
};

function parseGoal(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const goal = Number(trimmed);
  return Number.isFinite(goal) ? goal : null;
}

function draftFromSaved(value: number | null) {
  return value == null ? "" : String(value);
}

function readStoredGoal(storageKey: string) {
  const stored = window.localStorage.getItem(storageKey);
  if (stored == null) return null;
  return parseGoal(stored);
}

export function PlYearSection({
  reportYear,
  totals,
  expenseRows,
  initialGoal,
  savedGoals,
  goalsReady,
  overviewChart,
}: {
  reportYear: number;
  totals: PlTotals;
  expenseRows: PlExpenseDetailRow[];
  initialGoal: number;
  savedGoals: SavedBusinessGoals;
  goalsReady: boolean;
  overviewChart?: ReactNode;
}) {
  const [marginDraft, setMarginDraft] = useState(
    savedGoals.grossProfitMargin != null
      ? draftFromSaved(savedGoals.grossProfitMargin)
      : initialGoal > 0
        ? String(initialGoal)
        : ""
  );
  const [grossProfitDraft, setGrossProfitDraft] = useState(
    draftFromSaved(savedGoals.grossProfit)
  );
  const [netProfitDraft, setNetProfitDraft] = useState(
    draftFromSaved(savedGoals.netProfit)
  );
  const [netMarginDraft, setNetMarginDraft] = useState(
    draftFromSaved(savedGoals.netProfitMargin)
  );
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!goalsReady) {
      const storedMargin = window.localStorage.getItem(MARGIN_GOAL_STORAGE_KEY);
      if (storedMargin != null) setMarginDraft(storedMargin);
      const storedGrossProfit = window.localStorage.getItem(GROSS_PROFIT_GOAL_STORAGE_KEY);
      if (storedGrossProfit != null) setGrossProfitDraft(storedGrossProfit);
      const storedNetProfit = window.localStorage.getItem(NET_PROFIT_GOAL_STORAGE_KEY);
      if (storedNetProfit != null) setNetProfitDraft(storedNetProfit);
      const storedNetMargin = window.localStorage.getItem(NET_MARGIN_GOAL_STORAGE_KEY);
      if (storedNetMargin != null) setNetMarginDraft(storedNetMargin);
      return;
    }

    const savedByColumn: Record<string, number | null> = {
      gross_profit_margin: savedGoals.grossProfitMargin,
      gross_profit: savedGoals.grossProfit,
      net_profit: savedGoals.netProfit,
      net_profit_margin: savedGoals.netProfitMargin,
    };
    const setters: Record<string, (value: string) => void> = {
      gross_profit_margin: setMarginDraft,
      gross_profit: setGrossProfitDraft,
      net_profit: setNetProfitDraft,
      net_profit_margin: setNetMarginDraft,
    };
    const patch: Record<string, number> = {};

    for (const field of GOAL_FIELDS) {
      if (savedByColumn[field.column] != null) {
        window.localStorage.removeItem(field.storageKey);
        continue;
      }
      const stored = readStoredGoal(field.storageKey);
      if (stored == null) continue;
      patch[field.column] = stored;
      setters[field.column](String(stored));
    }

    if (Object.keys(patch).length === 0) return;

    let cancelled = false;
    const supabase = createClient();
    void supabase
      .from("business_goals")
      .upsert({ id: "default", ...patch }, { onConflict: "id" })
      .then(({ error }) => {
        if (cancelled || error) return;
        for (const field of GOAL_FIELDS) {
          if (field.column in patch) window.localStorage.removeItem(field.storageKey);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [goalsReady, savedGoals]);

  async function persistGoal(column: string, storageKey: string, value: string) {
    if (!goalsReady) {
      window.localStorage.setItem(storageKey, value);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("business_goals")
      .upsert({ id: "default", [column]: parseGoal(value) }, { onConflict: "id" });

    if (error) {
      window.localStorage.setItem(storageKey, value);
      setSaveError("This goal is still only saved in this browser.");
      return;
    }

    window.localStorage.removeItem(storageKey);
    setSaveError("");
  }

  function updateMarginGoal(value: string) {
    setMarginDraft(value);
    void persistGoal("gross_profit_margin", MARGIN_GOAL_STORAGE_KEY, value);
  }

  function updateGrossProfitGoal(value: string) {
    setGrossProfitDraft(value);
    void persistGoal("gross_profit", GROSS_PROFIT_GOAL_STORAGE_KEY, value);
  }

  function updateNetProfitGoal(value: string) {
    setNetProfitDraft(value);
    void persistGoal("net_profit", NET_PROFIT_GOAL_STORAGE_KEY, value);
  }

  function updateNetMarginGoal(value: string) {
    setNetMarginDraft(value);
    void persistGoal("net_profit_margin", NET_MARGIN_GOAL_STORAGE_KEY, value);
  }

  const grossProfitGoal = parseGoal(marginDraft);
  const grossProfitAmountGoal = parseGoal(grossProfitDraft);
  const netProfitGoal = parseGoal(netProfitDraft);
  const netProfitMarginGoal = parseGoal(netMarginDraft);

  return (
    <>
      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">Business Goals</h2>
        {saveError ? (
          <p className="mt-2 text-sm text-red-700">{saveError}</p>
        ) : null}
        <div className="mt-4 grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="gp-margin-goal" className="text-sm font-medium text-slate-700">
                Gross Profit Margin Goal
              </label>
              <div className="mt-2 flex max-w-xs items-center gap-2">
                <input
                  id="gp-margin-goal"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.01"
                  value={marginDraft}
                  onChange={(event) => updateMarginGoal(event.target.value)}
                  className="min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900"
                />
                <span className="text-sm font-medium text-slate-600">%</span>
              </div>
            </div>
            <GoalGauge
              title="Gross Profit Margin"
              actual={totals.grossProfitMargin}
              goal={grossProfitGoal}
              formatValue={formatPercent}
              scaleMax={Math.max(
                100,
                grossProfitGoal ?? 0,
                Math.max(0, totals.grossProfitMargin)
              )}
            />
          </div>
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="gp-goal" className="text-sm font-medium text-slate-700">
                Gross Profit Goal
              </label>
              <div className="mt-2 flex max-w-xs items-center gap-2">
                <span className="text-sm font-medium text-slate-600">$</span>
                <input
                  id="gp-goal"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={grossProfitDraft}
                  onChange={(event) => updateGrossProfitGoal(event.target.value)}
                  className="min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900"
                />
              </div>
            </div>
            <GoalGauge
              title="Gross Profit"
              actual={totals.grossProfit}
              goal={grossProfitAmountGoal}
              formatValue={formatCurrency}
              scaleMax={Math.max(
                grossProfitAmountGoal ?? 0,
                Math.max(0, totals.grossProfit)
              )}
            />
          </div>
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="np-goal" className="text-sm font-medium text-slate-700">
                Net Profit Goal
              </label>
              <div className="mt-2 flex max-w-xs items-center gap-2">
                <span className="text-sm font-medium text-slate-600">$</span>
                <input
                  id="np-goal"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={netProfitDraft}
                  onChange={(event) => updateNetProfitGoal(event.target.value)}
                  className="min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900"
                />
              </div>
            </div>
            <GoalGauge
              title="Net Profit"
              actual={totals.netProfit}
              goal={netProfitGoal}
              formatValue={formatCurrency}
              scaleMax={Math.max(
                netProfitGoal ?? 0,
                Math.max(0, totals.netProfit)
              )}
            />
          </div>
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="np-margin-goal" className="text-sm font-medium text-slate-700">
                Net Profit Margin Goal
              </label>
              <div className="mt-2 flex max-w-xs items-center gap-2">
                <input
                  id="np-margin-goal"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.01"
                  value={netMarginDraft}
                  onChange={(event) => updateNetMarginGoal(event.target.value)}
                  className="min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900"
                />
                <span className="text-sm font-medium text-slate-600">%</span>
              </div>
            </div>
            <GoalGauge
              title="Net Profit Margin"
              actual={totals.netProfitMargin}
              goal={netProfitMarginGoal}
              formatValue={formatPercent}
              scaleMax={Math.max(
                100,
                netProfitMarginGoal ?? 0,
                Math.max(0, totals.netProfitMargin)
              )}
            />
          </div>
        </div>
      </section>

      {overviewChart}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          Year to Date — {reportYear}
        </h2>
        <div className="mt-4">
          <PlTotalsCards
            totals={totals}
            expenseLineCount={expenseRows.length}
            grossProfitGoal={grossProfitGoal}
            grossProfitAmountGoal={grossProfitAmountGoal}
            netProfitGoal={netProfitGoal}
            netProfitMarginGoal={netProfitMarginGoal}
            expenseRows={expenseRows}
          />
        </div>
        <p className="mt-4 text-sm">
          <Link
            href="/reconciliation"
            className="font-medium text-brand-700 hover:text-brand-800 hover:underline"
          >
            View reconciliation report →
          </Link>
          <span className="text-slate-500">
            {" "}
            — compare Invoice History, Payments, Revenue, and accepted underpayment variances
          </span>
        </p>
      </section>
    </>
  );
}
