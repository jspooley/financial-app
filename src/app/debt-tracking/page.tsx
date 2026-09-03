"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CardBalanceReconciliationPanel } from "@/components/debt/CardBalanceReconciliationPanel";
import { DataTable } from "@/components/ui/DataTable";
import { selectFieldClass } from "@/components/ui/FormFields";
import { PageHeader } from "@/components/ui/PageHeader";
import { buildCardBalanceReconciliation } from "@/lib/card-balance-reconciliation";
import { fetchAllLedgerRows, normalizeLedgerRow } from "@/lib/ledger-db";
import {
  buildPersonalFundsReport,
  type PersonalFundsLine,
  type PersonalFundsPartnerFilter,
} from "@/lib/personal-funds-report";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";

function moneyClass(value: number, emphasize = false) {
  const weight = emphasize ? "font-semibold" : "font-medium";
  const color =
    value < 0 ? "text-red-700" : value > 0 ? "text-emerald-700" : "text-slate-900";
  return `${weight} ${color}`;
}

function SummaryCard({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string;
  value: number;
  hint?: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        emphasize ? "border-brand-200" : "border-slate-200"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-xl tabular-nums ${moneyClass(value, true)}`}>
        {formatCurrency(value)}
      </p>
      {hint ? <p className="mt-1 text-xs leading-snug text-slate-500">{hint}</p> : null}
    </div>
  );
}

function LinesTable({
  title,
  hint,
  lines,
  emptyMessage,
}: {
  title: string;
  hint: string;
  lines: PersonalFundsLine[];
  emptyMessage: string;
}) {
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">{hint}</p>
      </div>
      <DataTable
        emptyMessage={emptyMessage}
        columns={[
          { key: "date", label: "Date" },
          { key: "partner", label: "Partner" },
          { key: "account", label: "Account" },
          { key: "description", label: "Description" },
          { key: "category", label: "CoA" },
          { key: "amount", label: "Amount", className: "text-right" },
        ]}
        rows={lines.map((line) => ({
          date: formatDate(line.date),
          partner: line.partner,
          account: line.account,
          description: line.description,
          category: line.category,
          amount: (
            <span className={`tabular-nums ${moneyClass(line.amount)}`}>
              {formatCurrency(line.amount)}
            </span>
          ),
        }))}
        footerRow={
          lines.length > 0
            ? {
                date: "Total",
                partner: "",
                account: "",
                description: "",
                category: "",
                amount: (
                  <span className={`tabular-nums ${moneyClass(total, true)}`}>
                    {formatCurrency(total)}
                  </span>
                ),
              }
            : undefined
        }
      />
    </section>
  );
}

export default function DebtTrackingPage() {
  const [partner, setPartner] = useState<PersonalFundsPartnerFilter>("Both");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ReturnType<typeof normalizeLedgerRow>[]>(
    []
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await fetchAllLedgerRows(supabase, "*");
    if (error) {
      setLoadError(error);
      setEntries([]);
    } else {
      setEntries(data.map((row) => normalizeLedgerRow(row)));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const report = useMemo(
    () => buildPersonalFundsReport(entries, partner),
    [entries, partner]
  );

  const cardReconciliation = useMemo(() => {
    return buildCardBalanceReconciliation(entries, partner);
  }, [entries, partner]);

  const unreimbursedDisplay = -report.unreimbursedTotal;
  const businessLoanDisplay = -report.capitalNet;
  const netBusinessDebt = report.netBusinessDebt;

  return (
    <AppShell>
      <PageHeader
        title="Business Debt"
        description="Unreimbursed credit card charges plus remaining business loans."
        action={
          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap text-sm font-medium text-slate-700">
              View
            </span>
            <select
              className={`${selectFieldClass} w-auto min-w-40`}
              value={partner}
              onChange={(event) =>
                setPartner(event.target.value as PersonalFundsPartnerFilter)
              }
            >
              <option value="Both">Jess and Molly</option>
              <option value="Jess">Jess</option>
              <option value="Molly">Molly</option>
            </select>
          </label>
        }
      />

      {loadError ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Could not load ledger data: {loadError}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading business debt report...</p>
      ) : (
        <div className="space-y-8">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <SummaryCard
              label="Unreimbursed credit card charges"
              value={unreimbursedDisplay}
            />
            <SummaryCard
              label="Business Loan"
              value={businessLoanDisplay}
              hint="Owner contributions minus repayments to date"
            />
            <SummaryCard
              label="Net Business Debt"
              value={netBusinessDebt}
              emphasize
            />
          </div>

          <CardBalanceReconciliationPanel reconciliation={cardReconciliation} />

          <LinesTable
            title="Business Loan"
            hint="300 Owner's Contribution - Jes and 310 Owner's Contribution - Molly."
            lines={report.contributions.map((line) => ({
              ...line,
              amount: -line.amount,
            }))}
            emptyMessage="No business loan rows for this partner."
          />
          <LinesTable
            title="Business loan paybacks"
            hint="306 Biz Loan Payback - Jess and 305 Biz Loan Payback - Molly."
            lines={report.loanPaybacks}
            emptyMessage="No business loan paybacks for this partner."
          />
        </div>
      )}
    </AppShell>
  );
}
