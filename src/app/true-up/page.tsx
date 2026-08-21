"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectField } from "@/components/ui/FormFields";
import { createClient } from "@/lib/supabase/client";
import { fetchAllLedgerRows, normalizeLedgerRow } from "@/lib/ledger-db";
import {
  buildTrueUpReport,
  partnerTotal,
  type PartnerAmounts,
  type TrueUpBlock,
  type TrueUpUntaggedTransfer,
  type TrueUpYtdTotals,
} from "@/lib/true-up-report";
import { formatCurrency, formatDate } from "@/lib/utils";

function money(value: number) {
  return formatCurrency(value);
}

function isSettled(amounts: PartnerAmounts) {
  return Math.abs(amounts.jess) < 0.005 && Math.abs(amounts.molly) < 0.005;
}

function amountClass(
  value: number,
  emphasize?: boolean,
  tone?: "danger" | "success"
) {
  const weight = emphasize ? "font-bold" : "font-normal";
  const color =
    tone === "danger"
      ? "text-red-700"
      : tone === "success"
        ? "text-emerald-700"
        : value < 0
          ? "text-red-700"
          : "text-slate-900";
  return `px-3 py-1.5 text-right tabular-nums ${weight} ${color}`;
}

function AmountCells({
  amounts,
  emphasize,
  tone,
}: {
  amounts: PartnerAmounts;
  emphasize?: boolean;
  tone?: "danger" | "success";
}) {
  const total = partnerTotal(amounts);
  return (
    <>
      <td className={amountClass(amounts.jess, emphasize, tone)}>
        {money(amounts.jess)}
      </td>
      <td className={amountClass(amounts.molly, emphasize, tone)}>
        {money(amounts.molly)}
      </td>
      <td className={amountClass(total, emphasize, tone)}>{money(total)}</td>
    </>
  );
}

function DiscrepancyRow({
  amounts,
  leadingCells,
}: {
  amounts: PartnerAmounts;
  leadingCells: number;
}) {
  const settled = isSettled(amounts);
  const labelClass = settled
    ? "px-3 py-1.5 font-bold text-emerald-700"
    : "px-3 py-1.5 font-bold text-red-700";
  return (
    <tr className="border-b border-slate-200">
      {Array.from({ length: leadingCells }, (_, index) => (
        <td key={index} />
      ))}
      <td className={labelClass}>Discrepancy</td>
      <AmountCells
        amounts={amounts}
        emphasize
        tone={settled ? "success" : "danger"}
      />
    </tr>
  );
}

function TransferYtdRows({
  groupLabel,
  totals,
  extraLeading = 0,
  grouped,
}: {
  groupLabel: string;
  totals: TrueUpYtdTotals;
  extraLeading?: number;
  grouped?: boolean;
}) {
  const rowClass = grouped
    ? "border-b border-slate-100 bg-slate-50"
    : "border-b border-slate-100";
  return (
    <>
      <tr className={rowClass}>
        <td className="px-3 py-1.5 font-bold text-slate-900">{groupLabel}</td>
        {Array.from({ length: extraLeading }, (_, index) => (
          <td key={index} />
        ))}
        <td className="px-3 py-1.5 font-bold text-slate-900">
          Required Transfer
        </td>
        <AmountCells amounts={totals.required} emphasize />
      </tr>
      <tr className="border-b border-slate-100">
        <td />
        {Array.from({ length: extraLeading }, (_, index) => (
          <td key={index} />
        ))}
        <td className="px-3 py-1.5 font-bold text-slate-900">
          Recorded Transfers
        </td>
        <AmountCells amounts={totals.recorded} emphasize />
      </tr>
      <DiscrepancyRow amounts={totals.discrepancy} leadingCells={1 + extraLeading} />
    </>
  );
}

function BlockTable({
  sectionLabel,
  secondaryHeader,
  blocks,
  ytdTotals,
}: {
  sectionLabel: string;
  secondaryHeader: string;
  blocks: TrueUpBlock[];
  ytdTotals?: TrueUpYtdTotals;
}) {
  if (blocks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
        No {sectionLabel === "Sales&Revenue" ? "sales and revenue" : sectionLabel.toLowerCase()}{" "}
        activity for this year.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
            <th className="px-3 py-2 font-semibold">{sectionLabel}</th>
            <th className="px-3 py-2 font-semibold">{secondaryHeader}</th>
            <th className="px-3 py-2 font-semibold">COA Category</th>
            <th className="px-3 py-2 text-right font-semibold">Jess</th>
            <th className="px-3 py-2 text-right font-semibold">Molly</th>
            <th className="px-3 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((block, blockIndex) => (
            <BlockRows
              key={block.id}
              block={block}
              showDivider={blockIndex > 0}
            />
          ))}
          {ytdTotals ? (
            <>
              <tr>
                <td colSpan={6} className="h-3 bg-white p-0" />
              </tr>
              <TransferYtdRows
                groupLabel="YTD"
                totals={ytdTotals}
                extraLeading={1}
                grouped
              />
            </>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function CollapsibleSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {open ? (
            <p className="mt-1 text-sm text-slate-600">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="text-sm font-medium text-brand-700 hover:text-brand-900"
        >
          {open ? "Collapse" : "Expand"}
        </button>
      </div>
      {open ? children : null}
    </section>
  );
}

function BlockRows({
  block,
  showDivider,
}: {
  block: TrueUpBlock;
  showDivider: boolean;
}) {
  return (
    <>
      {showDivider ? (
        <tr>
          <td colSpan={6} className="h-3 bg-white p-0" />
        </tr>
      ) : null}
      {block.categoryRows.map((row, index) => (
        <tr
          key={`${block.id}-cat-${row.category}`}
          className={`border-b border-slate-100 ${index === 0 ? "bg-slate-50" : ""}`}
        >
          <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-900">
            {index === 0 ? block.groupLabel : ""}
          </td>
          <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">
            {index === 0 ? block.secondaryLabel : ""}
          </td>
          <td className="px-3 py-1.5 text-slate-800">{row.category}</td>
          <AmountCells amounts={row.amounts} />
        </tr>
      ))}
      {block.categoryRows.length === 0 ? (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td className="px-3 py-1.5 font-medium text-slate-900">{block.groupLabel}</td>
          <td className="px-3 py-1.5 text-slate-600">{block.secondaryLabel}</td>
          <td className="px-3 py-1.5 text-slate-500">No category activity</td>
          <AmountCells amounts={block.subtotal} />
        </tr>
      ) : null}
      <tr className="border-b border-slate-100">
        <td />
        <td />
        <td className="px-3 py-1.5 font-bold text-slate-900">Subtotal</td>
        <AmountCells amounts={block.subtotal} emphasize />
      </tr>
      <tr className="border-b border-slate-100">
        <td />
        <td />
        <td className="px-3 py-1.5 font-bold text-slate-900">Required Transfer</td>
        <AmountCells amounts={block.required} emphasize />
      </tr>
      <tr>
        <td colSpan={6} className="h-2 bg-white p-0" />
      </tr>
      {block.recordedRows.map((row) => (
        <tr key={`${block.id}-rec-${row.category}`} className="border-b border-slate-100">
          <td />
          <td />
          <td className="px-3 py-1.5 text-slate-800">{row.category}</td>
          <AmountCells amounts={row.amounts} />
        </tr>
      ))}
      <tr className="border-b border-slate-100">
        <td />
        <td />
        <td className="px-3 py-1.5 font-bold text-slate-900">Recorded Transfers</td>
        <AmountCells amounts={block.recorded} emphasize />
      </tr>
      <DiscrepancyRow amounts={block.discrepancy} leadingCells={2} />
    </>
  );
}

function UntaggedTransfersTable({ rows }: { rows: TrueUpUntaggedTransfer[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-slate-900">
        Untagged transfers ({rows.length})
      </h2>
      <p className="mb-3 text-sm text-slate-600">
        Cashflow 203 / 302–399 rows with no Paid To and a CoA that does not
        name both partners. Set <strong>Paid To</strong> to Jess or Molly, or
        use a CoA such as 304 Jess to Molly. Paying your own credit card or
        personal account (Paid To is the same person) is tagged and will not
        appear here.
      </p>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Description</th>
                <th className="px-3 py-2 font-semibold">CoA Category</th>
                <th className="px-3 py-2 font-semibold">Account</th>
                <th className="px-3 py-2 font-semibold">Invoice ID</th>
                <th className="px-3 py-2 font-semibold">Paid To</th>
                <th className="px-3 py-2 font-semibold">On books for</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">
                    {formatDate(row.date)}
                  </td>
                  <td className="px-3 py-1.5 text-slate-800">{row.description}</td>
                  <td className="px-3 py-1.5 text-slate-700">{row.category}</td>
                  <td className="px-3 py-1.5 text-slate-700">{row.account}</td>
                  <td className="px-3 py-1.5 text-slate-700">
                    {row.invoiceId || "—"}
                  </td>
                  <td className="px-3 py-1.5 text-slate-500">
                    {row.paidTo || "—"}
                  </td>
                  <td className="px-3 py-1.5 text-slate-700">{row.party}</td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      row.amount < 0 ? "text-red-700" : "text-slate-900"
                    }`}
                  >
                    {money(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
    </section>
  );
}

export default function TrueUpReportPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ReturnType<typeof normalizeLedgerRow>[]>(
    []
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await fetchAllLedgerRows(
      supabase,
      "*, clients(name)"
    );
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

  const report = useMemo(() => buildTrueUpReport(entries, year), [entries, year]);
  const yearOptions = useMemo(() => {
    const years = new Set<number>([currentYear, currentYear - 1, currentYear - 2]);
    for (const entry of entries) {
      const date = entry.entry_date || entry.date_paid;
      if (date && date.length >= 4) years.add(Number(date.slice(0, 4)));
    }
    return [...years].filter((value) => Number.isFinite(value)).sort((a, b) => b - a);
  }, [entries, currentYear]);

  return (
    <AppShell>
      <PageHeader
        title="True Up Report"
        description="Cash-basis 50/50 split between Jess and Molly. Deposits and money received are positive; payments and money sent are negative. If you send money to Molly, your column is negative and hers is positive. Discrepancy is required minus recorded transfers."
        action={
          <SelectField
            label="Year"
            value={String(year)}
            onChange={(event) => setYear(Number(event.target.value))}
          >
            {yearOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>
        }
      />

      {loadError ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Could not load ledger data: {loadError}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading true-up report...</p>
      ) : (
        <div className="space-y-8">
          <CollapsibleSection
            title="Sales and Revenue"
            description="Cash in and out by invoice. Sales income is net of tax, shipping, and fees (pass-through, not shared). COGS is negative (money out). Required transfer splits that net 50/50: send is negative, receive is positive."
          >
            <BlockTable
              sectionLabel="Sales&Revenue"
              secondaryHeader="Invoice"
              blocks={report.sales}
              ytdTotals={report.ytdSales}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="Expenses"
            description="Operating cash by month and COA category. Expenses (debits) are negative. Required transfer splits that month's cash 50/50: send is negative, receive is positive."
          >
            <BlockTable
              sectionLabel="Expenses"
              secondaryHeader="Date"
              blocks={report.expenses}
              ytdTotals={report.ytdExpenses}
            />
          </CollapsibleSection>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">YTD</h2>
            <p className="mb-3 text-sm text-slate-600">
              Year-to-date Required, Recorded, and Discrepancy for Goods and
              Services and for Expenses, then Grand Total YTD for both.
              Recorded is 303/304 (or Paid To the other partner). Paying your
              own credit card or personal account is not included. Positive =
              received; negative = sent. Discrepancy is required minus recorded.
            </p>
            <div className="mb-3 space-y-1 text-sm">
              <p className="font-semibold text-slate-900">
                Molly to Jess YTD {money(report.ytdMollyToJess)}
                <span className="ml-2 font-normal text-slate-600">
                  = total amount sent to Jess
                </span>
              </p>
              <p className="font-semibold text-slate-900">
                Jess to Molly YTD {money(report.ytdJessToMolly)}
                <span className="ml-2 font-normal text-slate-600">
                  = total amount sent to Molly
                </span>
              </p>
              <p className="text-slate-600">
                Recorded Transfers in the table is the net of those two (Jess to
                Molly minus Molly to Jess), not the gross sent in one direction.
              </p>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                    <th className="px-3 py-2 font-semibold">YTD</th>
                    <th className="px-3 py-2 font-semibold">COA Category</th>
                    <th className="px-3 py-2 text-right font-semibold">Jess</th>
                    <th className="px-3 py-2 text-right font-semibold">Molly</th>
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <TransferYtdRows
                    groupLabel="Goods and Services"
                    totals={report.ytdSales}
                  />
                  <TransferYtdRows
                    groupLabel="Expenses"
                    totals={report.ytdExpenses}
                  />
                  <TransferYtdRows
                    groupLabel="Grand Total YTD"
                    totals={report.ytdGrandTotal}
                    grouped
                  />
                </tbody>
              </table>
            </div>
          </section>

          <UntaggedTransfersTable rows={report.untaggedTransfers} />
        </div>
      )}
    </AppShell>
  );
}
