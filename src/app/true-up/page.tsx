"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectField } from "@/components/ui/FormFields";
import { createClient } from "@/lib/supabase/client";
import { fetchAllLedgerRows, normalizeLedgerRow } from "@/lib/ledger-db";
import {
  addPartnerAmount,
  buildTrueUpReport,
  emptyPartnerAmounts,
  partnerTotal,
  TRUE_UP_EXCLUSIONS,
  type PartnerAmounts,
  type TrueUpBlock,
  type TrueUpTransaction,
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
  expandableCategories = false,
}: {
  sectionLabel: string;
  secondaryHeader: string;
  blocks: TrueUpBlock[];
  ytdTotals?: TrueUpYtdTotals;
  expandableCategories?: boolean;
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
              expandableCategories={expandableCategories}
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
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="mb-3 flex w-full items-start gap-2 rounded text-left hover:bg-slate-50"
      >
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center text-brand-700"
        >
          <span
            className={`inline-block text-lg leading-none transition-transform ${
              open ? "rotate-90" : ""
            }`}
          >
            ▶
          </span>
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {open ? (
            <p className="mt-1 text-sm text-slate-600">{description}</p>
          ) : null}
        </div>
      </button>
      {open ? children : null}
    </section>
  );
}

function CategoryExpandArrow({ expanded }: { expanded: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center text-brand-700"
    >
      <span
        className={`inline-block text-sm leading-none transition-transform ${
          expanded ? "rotate-90" : ""
        }`}
      >
        ▶
      </span>
    </span>
  );
}

function transactionAmounts(txn: TrueUpTransaction): PartnerAmounts {
  return addPartnerAmount(emptyPartnerAmounts(), txn.party, txn.amount);
}

function BlockRows({
  block,
  showDivider,
  expandableCategories = false,
}: {
  block: TrueUpBlock;
  showDivider: boolean;
  expandableCategories?: boolean;
}) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set()
  );

  function toggleCategory(category: string) {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  if (block.status === "pending" && block.pendingReason !== "awaiting_payment") {
    return (
      <>
        {showDivider ? (
          <tr>
            <td colSpan={6} className="h-3 bg-white p-0" />
          </tr>
        ) : null}
        <tr className="border-b border-slate-100 bg-amber-50/60">
          <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-900">
            {block.groupLabel}
          </td>
          <td className="whitespace-nowrap px-3 py-1.5 font-medium text-amber-800">
            Pending
          </td>
          <td
            colSpan={4}
            className="px-3 py-1.5 text-sm text-amber-900/80"
          >
            Open job with no purchases or client payments recorded yet.
          </td>
        </tr>
      </>
    );
  }

  const isAwaitingPayment =
    block.status === "pending" && block.pendingReason === "awaiting_payment";

  return (
    <>
      {showDivider ? (
        <tr>
          <td colSpan={6} className="h-3 bg-white p-0" />
        </tr>
      ) : null}
      {isAwaitingPayment ? (
        <tr className="border-b border-slate-100 bg-amber-50/60">
          <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-900">
            {block.groupLabel}
          </td>
          <td className="whitespace-nowrap px-3 py-1.5 font-medium text-amber-800">
            Pending
          </td>
          <td
            colSpan={4}
            className="px-3 py-1.5 text-sm text-amber-900/80"
          >
            Purchases recorded; awaiting client payment before true-up. COGS is
            not shared — the payee will reimburse whoever bought the goods once
            payment is received.
          </td>
        </tr>
      ) : null}
      {block.categoryRows.map((row, index) => {
        const transactions = row.transactions ?? [];
        const canExpand = expandableCategories && transactions.length > 0;
        const isOpen = expandedCategories.has(row.category);
        return (
          <Fragment key={`${block.id}-cat-${row.category}`}>
            <tr
              className={`border-b border-slate-100 ${index === 0 ? "bg-slate-50" : ""}`}
            >
              <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-900">
                {index === 0 && !isAwaitingPayment ? block.groupLabel : ""}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">
                {index === 0 ? block.secondaryLabel : ""}
              </td>
              <td className="px-3 py-1.5 text-slate-800">
                {canExpand ? (
                  <button
                    type="button"
                    onClick={() => toggleCategory(row.category)}
                    aria-expanded={isOpen}
                    aria-label={
                      isOpen
                        ? `Collapse ${row.category}`
                        : `Expand ${row.category} (${transactions.length} transactions)`
                    }
                    className="-ml-1 flex w-full items-center gap-1 rounded px-1 text-left hover:bg-slate-100"
                  >
                    <CategoryExpandArrow expanded={isOpen} />
                    <span>
                      {row.category}
                      <span className="ml-1 text-xs font-normal text-slate-500">
                        ({transactions.length})
                      </span>
                    </span>
                  </button>
                ) : (
                  row.category
                )}
              </td>
              <AmountCells amounts={row.amounts} />
            </tr>
            {canExpand && isOpen
              ? transactions.map((txn) => (
                  <tr
                    key={`${block.id}-txn-${row.category}-${txn.id}`}
                    className="border-b border-slate-50 bg-slate-50/60"
                  >
                    <td />
                    <td className="whitespace-nowrap px-3 py-1 text-slate-500">
                      {formatDate(txn.date)}
                    </td>
                    <td className="px-3 py-1 pl-8 text-slate-600">
                      <span className="block">{txn.description}</span>
                      {txn.account !== "—" || txn.invoiceId ? (
                        <span className="block text-xs text-slate-400">
                          {[txn.account !== "—" ? txn.account : null, txn.invoiceId]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </td>
                    <AmountCells amounts={transactionAmounts(txn)} />
                  </tr>
                ))
              : null}
          </Fragment>
        );
      })}
      {block.categoryRows.length === 0 && !isAwaitingPayment ? (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td className="px-3 py-1.5 font-medium text-slate-900">{block.groupLabel}</td>
          <td className="px-3 py-1.5 text-slate-600">{block.secondaryLabel}</td>
          <td className="px-3 py-1.5 text-slate-500">No category activity</td>
          <AmountCells amounts={block.subtotal} />
        </tr>
      ) : null}
      {!isAwaitingPayment ? (
        <>
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
      ) : null}
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
        Cashflow 203 / 303 / 304 partner-transfer rows with no Paid To and a CoA
        that does not name both partners. Set <strong>Paid To</strong> to Jess or
        Molly, or use a CoA such as 304 Jess to Molly. 302 owner draws, 306
        loan paybacks, and 308 personal-card refunds are not partner transfers
        and will not appear here.
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
        description="Cash-basis accounting between partners. Purchases (goods, shipping, receiving, and fees) stay with whoever paid and are reimbursed in full from client payments — never split 50/50. Client payments go to whoever received them. Required transfer reimburses the purchaser and splits profit only 50/50: send is negative, receive is positive."
        action={
          <SelectField
            label="Year"
            className="min-w-32"
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
            description="Cash in and out by invoice. COGS includes goods, shipping, receiving, and payment fees (negative = money out, attributed to whoever paid). Sales income is net of sales & use tax only. Required transfer reimburses the purchaser from client payments and splits remaining profit 50/50. Jobs with purchases but no client payment yet show as Pending."
          >
            <BlockTable
              sectionLabel="Sales&Revenue"
              secondaryHeader="Invoice"
              blocks={report.sales}
              ytdTotals={report.ytdSales}
              expandableCategories
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="Expenses"
            description="Operating cash by month and COA category. Expand a category to see its transactions. Expenses (debits) are negative. Required transfer splits that month's cash 50/50: send is negative, receive is positive."
          >
            <BlockTable
              sectionLabel="Expenses"
              secondaryHeader="Date"
              blocks={report.expenses}
              ytdTotals={report.ytdExpenses}
              expandableCategories
            />
          </CollapsibleSection>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">YTD</h2>
            <p className="mb-3 text-sm text-slate-600">
              Year-to-date Required, Recorded, and Discrepancy for Goods and
              Services and for Expenses, then Grand Total YTD for both.
              Positive = received; negative = sent. Discrepancy is required
              minus recorded.
            </p>
            <div className="mb-3 space-y-1 text-sm">
              <p className="font-semibold text-slate-900">
                Molly to Jes YTD = {money(report.ytdMollyToJess)}
              </p>
              <p className="font-semibold text-slate-900">
                Jess to Molly YTD = {money(report.ytdJessToMolly)}
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

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">
              Excluded from the true-up
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              These do not enter the profit split. Partner transfers that do count
              toward settlement are 203 commissions/fees and 303/304 Jess↔Molly (or Paid To the other
              partner).
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {TRUE_UP_EXCLUSIONS.map((item) => (
                <li key={item.label}>
                  <span className="font-medium text-slate-900">{item.label}.</span>{" "}
                  {item.detail}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </AppShell>
  );
}
