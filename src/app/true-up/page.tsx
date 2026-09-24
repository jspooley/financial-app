"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectField, selectFieldClass } from "@/components/ui/FormFields";
import {
  TrueUpExcludeReasonModal,
  TrueUpReasonModal,
} from "@/components/true-up/TrueUpExcludeReasonModal";
import { createClient } from "@/lib/supabase/client";
import { normalizeInvoiceId } from "@/lib/invoice-utils";
import { fetchAllLedgerRows, normalizeLedgerRow } from "@/lib/ledger-db";
import {
  addPartnerAmount,
  buildTrueUpReport,
  emptyPartnerAmounts,
  isTrueUpExcludeSchemaError,
  isTrueUpOffsetSchemaError,
  partnerTotal,
  TRUE_UP_EXCLUDE_SETUP_SQL,
  TRUE_UP_EXCLUSIONS,
  TRUE_UP_OFFSET_LABEL,
  TRUE_UP_OFFSET_SETUP_SQL,
  type PartnerAmounts,
  type TrueUpBlock,
  type TrueUpGroupBy,
  type TrueUpInvoiceOffset,
  type TrueUpTransaction,
  type TrueUpUntaggedTransfer,
  type TrueUpYtdTotals,
} from "@/lib/true-up-report";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { LedgerEntry } from "@/lib/types";

type InvoiceOffsetRow = {
  id: string;
  invoice_id: string | null;
  true_up_offset_accepted: boolean;
  true_up_offset_reason: string;
};

const BLOCK_COL_SPAN = 8;
const PENDING_NOTE_COL_SPAN = 6;
const excludeSelectClass = `${selectFieldClass} h-8 min-h-8 w-[4.75rem] px-1.5 py-0 pr-7 text-sm`;

function money(value: number) {
  return formatCurrency(value);
}

type ExcludeValue = "yes" | "no" | "mixed";

function excludeValueFromTransactions(
  transactions: TrueUpTransaction[]
): ExcludeValue {
  if (transactions.length === 0) return "no";
  const excludedCount = transactions.filter((txn) => txn.excluded).length;
  if (excludedCount === 0) return "no";
  if (excludedCount === transactions.length) return "yes";
  return "mixed";
}

function excludeReasonFromTransactions(
  transactions: TrueUpTransaction[]
): string {
  const reasons = [
    ...new Set(
      transactions
        .filter((txn) => txn.excluded)
        .map((txn) => (txn.excludeReason ?? "").trim())
        .filter(Boolean)
    ),
  ];
  if (reasons.length === 0) return "";
  if (reasons.length === 1) return reasons[0];
  return "Multiple reasons";
}

function ExcludeCell({
  value = "no",
  onChange,
  disabled,
  empty,
  label,
  reason,
}: {
  value?: ExcludeValue;
  onChange?: (excluded: boolean) => void;
  disabled?: boolean;
  empty?: boolean;
  label?: string;
  reason?: string;
}) {
  if (empty || !onChange) return <td />;
  return (
    <td className="px-3 py-1.5">
      <select
        aria-label={label ?? "Exclude from true up"}
        className={excludeSelectClass}
        disabled={disabled}
        title={reason || undefined}
        value={value === "yes" ? "yes" : value === "mixed" ? "mixed" : "no"}
        onChange={(event) => {
          const next = event.target.value;
          if (next === "mixed") return;
          onChange(next === "yes");
        }}
      >
        <option value="no">No</option>
        <option value="yes">Yes</option>
        {value === "mixed" ? (
          <option value="mixed" disabled>
            Mixed
          </option>
        ) : null}
      </select>
      {reason ? (
        <p
          className="mt-0.5 max-w-[9rem] truncate text-[11px] text-slate-500"
          title={reason}
        >
          {reason}
        </p>
      ) : null}
    </td>
  );
}

function RequiredTransferLabel({ note }: { note?: string }) {
  return (
    <>
      Required Transfer
      <span className="ml-1 font-normal text-slate-500">
        (does not include Excluded items)
      </span>
      {note ? (
        <span className="ml-1 font-normal text-slate-500">{note}</span>
      ) : null}
    </>
  );
}

function isSettled(amounts: PartnerAmounts) {
  return (
    Math.abs(amounts.jess) < 0.005 &&
    Math.abs(amounts.molly) < 0.005 &&
    Math.abs(amounts.tbd) < 0.005
  );
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
  unknown,
}: {
  amounts: PartnerAmounts;
  emphasize?: boolean;
  tone?: "danger" | "success";
  unknown?: boolean;
}) {
  const total = partnerTotal(amounts);
  const unknownClass = `px-3 py-1.5 text-right italic ${
    emphasize ? "font-bold" : "font-normal"
  } text-slate-500`;
  if (unknown) {
    return (
      <>
        <td className={unknownClass}>TBD</td>
        <td className={unknownClass}>TBD</td>
        <td className={unknownClass}>TBD</td>
        <td className={amountClass(0, emphasize, tone)}>{money(0)}</td>
      </>
    );
  }
  return (
    <>
      <td className={amountClass(amounts.jess, emphasize, tone)}>
        {money(amounts.jess)}
      </td>
      <td className={amountClass(amounts.molly, emphasize, tone)}>
        {money(amounts.molly)}
      </td>
      <td className={amountClass(amounts.tbd, emphasize, tone)}>
        {money(amounts.tbd)}
      </td>
      <td className={amountClass(total, emphasize, tone)}>{money(total)}</td>
    </>
  );
}

function DiscrepancyRow({
  amounts,
  leadingCells,
  showExclude,
  settleValue,
  settleReason,
  settleDisabled,
  onSettle,
  onEditReason,
}: {
  amounts: PartnerAmounts;
  leadingCells: number;
  showExclude?: boolean;
  settleValue?: ExcludeValue;
  settleReason?: string;
  settleDisabled?: boolean;
  onSettle?: (settled: boolean) => void;
  onEditReason?: () => void;
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
      {onSettle ? (
        <td className="px-3 py-1.5">
          <p className="mb-0.5 text-[11px] leading-tight text-slate-500">
            Settle remaining
          </p>
          <select
            aria-label="Settle remaining discrepancy as a non-cash offset"
            className={excludeSelectClass}
            disabled={settleDisabled}
            title={settleReason || undefined}
            value={settleValue === "yes" ? "yes" : "no"}
            onChange={(event) => onSettle(event.target.value === "yes")}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
          {settleReason ? (
            <p
              className="mt-0.5 max-w-[9rem] truncate text-[11px] text-slate-500"
              title={settleReason}
            >
              {settleReason}
            </p>
          ) : null}
          {onEditReason && settleValue === "yes" ? (
            <button
              type="button"
              className="mt-0.5 text-[11px] font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
              disabled={settleDisabled}
              onClick={onEditReason}
            >
              Edit note
            </button>
          ) : null}
        </td>
      ) : showExclude ? (
        <td />
      ) : null}
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
  showExclude,
}: {
  groupLabel: string;
  totals: TrueUpYtdTotals;
  extraLeading?: number;
  grouped?: boolean;
  showExclude?: boolean;
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
          <RequiredTransferLabel />
        </td>
        {showExclude ? <td /> : null}
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
        {showExclude ? <td /> : null}
        <AmountCells amounts={totals.recorded} emphasize />
      </tr>
      <DiscrepancyRow
        amounts={totals.discrepancy}
        leadingCells={1 + extraLeading}
        showExclude={showExclude}
      />
      <tr className="border-b border-slate-100">
        <td />
        {Array.from({ length: extraLeading }, (_, index) => (
          <td key={index} />
        ))}
        <td className="px-3 py-1.5 font-bold text-slate-900">
          Unassigned (TBD)
        </td>
        {showExclude ? <td /> : null}
        <AmountCells amounts={totals.unassigned} emphasize />
      </tr>
    </>
  );
}

function BlockTable({
  sectionLabel,
  groupHeader,
  secondaryHeader,
  categoryHeader = "COA Category",
  blocks,
  ytdTotals,
  expandableCategories = false,
  showRecordedRows = true,
  stickyHeader = false,
  onExclude,
  excluding,
  onSettle,
  onEditSettle,
  settling,
}: {
  sectionLabel: string;
  groupHeader?: string;
  secondaryHeader: string;
  categoryHeader?: string;
  blocks: TrueUpBlock[];
  ytdTotals?: TrueUpYtdTotals;
  expandableCategories?: boolean;
  showRecordedRows?: boolean;
  stickyHeader?: boolean;
  onExclude?: (
    ids: string[],
    excluded: boolean,
    context?: { label: string }
  ) => void;
  excluding?: boolean;
  onSettle?: (
    invoiceId: string,
    settled: boolean,
    context?: { label: string }
  ) => void;
  onEditSettle?: (invoiceId: string, context?: { label: string }) => void;
  settling?: boolean;
}) {
  if (blocks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
        No {sectionLabel === "Sales&Revenue" ? "sales and revenue" : sectionLabel.toLowerCase()}{" "}
        activity for this year.
      </p>
    );
  }

  const headerCellClass = stickyHeader
    ? "sticky top-0 z-10 bg-slate-50 px-3 py-2 font-semibold shadow-[0_1px_0_0_rgb(226,232,240)]"
    : "px-3 py-2 font-semibold";

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${
        stickyHeader ? "max-h-[70vh] overflow-auto" : "overflow-x-auto"
      }`}
    >
      <table className="min-w-full text-sm">
        <thead className={stickyHeader ? "sticky top-0 z-10 bg-slate-50" : undefined}>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
            <th className={headerCellClass}>
              {groupHeader ?? sectionLabel}
            </th>
            <th className={headerCellClass}>{secondaryHeader}</th>
            <th className={headerCellClass}>{categoryHeader}</th>
            <th className={headerCellClass}>Exclude from true up</th>
            <th className={`${headerCellClass} text-right`}>Jess</th>
            <th className={`${headerCellClass} text-right`}>Molly</th>
            <th className={`${headerCellClass} text-right`}>TBD</th>
            <th className={`${headerCellClass} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((block, blockIndex) => (
            <BlockRows
              key={block.id}
              block={block}
              showDivider={blockIndex > 0}
              expandableCategories={expandableCategories}
              showRecordedRows={showRecordedRows}
              onExclude={onExclude}
              excluding={excluding}
              onSettle={onSettle}
              onEditSettle={onEditSettle}
              settling={settling}
            />
          ))}
          {ytdTotals ? (
            <>
              <tr>
                <td colSpan={BLOCK_COL_SPAN} className="h-3 bg-white p-0" />
              </tr>
              <TransferYtdRows
                groupLabel="YTD"
                totals={ytdTotals}
                extraLeading={1}
                grouped
                showExclude
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
  showRecordedRows = true,
  onExclude,
  excluding,
  onSettle,
  onEditSettle,
  settling,
}: {
  block: TrueUpBlock;
  showDivider: boolean;
  expandableCategories?: boolean;
  showRecordedRows?: boolean;
  onExclude?: (
    ids: string[],
    excluded: boolean,
    context?: { label: string }
  ) => void;
  excluding?: boolean;
  onSettle?: (
    invoiceId: string,
    settled: boolean,
    context?: { label: string }
  ) => void;
  onEditSettle?: (invoiceId: string, context?: { label: string }) => void;
  settling?: boolean;
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
            <td colSpan={BLOCK_COL_SPAN} className="h-3 bg-white p-0" />
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
            colSpan={PENDING_NOTE_COL_SPAN}
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
  const projectedSubtotal = block.projectedSubtotal ?? block.subtotal;
  const projectedRequired = block.projectedRequired ?? block.required;
  const hasProjectedBreakdown =
    isAwaitingPayment &&
    (block.projectedCategoryRows?.length ?? 0) > 0 &&
    block.projectedSubtotal &&
    block.projectedRequired;

  return (
    <>
      {showDivider ? (
        <tr>
          <td colSpan={BLOCK_COL_SPAN} className="h-3 bg-white p-0" />
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
            colSpan={PENDING_NOTE_COL_SPAN}
            className="px-3 py-1.5 text-sm text-amber-900/80"
          >
            Purchases recorded; awaiting client payment before true-up. COGS is
            not shared — the payee will reimburse whoever bought the goods once
            payment is received. Invoiced amounts sit in TBD until cash is
            received. Unpurchased goods (purchaser or account TBD) sit in TBD
            until someone buys them.
            {hasProjectedBreakdown
              ? " Projected profit below uses invoiced totals, not who will be paid."
              : null}
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
              <ExcludeCell
                value={excludeValueFromTransactions(transactions)}
                reason={excludeReasonFromTransactions(transactions)}
                disabled={excluding || !onExclude || transactions.length === 0}
                onChange={
                  onExclude && transactions.length > 0
                    ? (excluded) =>
                        onExclude(
                          [...new Set(transactions.map((txn) => txn.id))],
                          excluded,
                          { label: row.category }
                        )
                    : undefined
                }
                label={`Exclude ${row.category} from true up`}
              />
              <AmountCells amounts={row.amounts} />
            </tr>
            {canExpand && isOpen
              ? transactions.map((txn) => (
                  <tr
                    key={`${block.id}-txn-${row.category}-${txn.id}`}
                    className={`border-b border-slate-50 bg-slate-50/60 ${
                      txn.excluded ? "text-slate-400" : ""
                    }`}
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
                    <ExcludeCell
                      value={txn.excluded ? "yes" : "no"}
                      reason={txn.excludeReason}
                      disabled={excluding || !onExclude}
                      onChange={
                        onExclude
                          ? (excluded) =>
                              onExclude([txn.id], excluded, {
                                label: txn.description,
                              })
                          : undefined
                      }
                      label={`Exclude ${txn.description} from true up`}
                    />
                    <AmountCells amounts={transactionAmounts(txn)} />
                  </tr>
                ))
              : null}
          </Fragment>
        );
      })}
      {(block.projectedCategoryRows ?? []).map((row) => (
        <tr
          key={`${block.id}-proj-${row.category}`}
          className="border-b border-slate-100 bg-amber-50/30"
        >
          <td />
          <td />
          <td className="px-3 py-1.5 italic text-slate-700">{row.category}</td>
          <ExcludeCell
            value={excludeValueFromTransactions(row.transactions ?? [])}
            reason={excludeReasonFromTransactions(row.transactions ?? [])}
            disabled={
              excluding || !onExclude || (row.transactions?.length ?? 0) === 0
            }
            onChange={
              onExclude && (row.transactions?.length ?? 0) > 0
                ? (excluded) =>
                    onExclude(
                      [...new Set((row.transactions ?? []).map((txn) => txn.id))],
                      excluded,
                      { label: row.category }
                    )
                : undefined
            }
            label={`Exclude ${row.category} from true up`}
          />
          <AmountCells amounts={row.amounts} />
        </tr>
      ))}
      {block.categoryRows.length === 0 && !isAwaitingPayment ? (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td className="px-3 py-1.5 font-medium text-slate-900">{block.groupLabel}</td>
          <td className="px-3 py-1.5 text-slate-600">{block.secondaryLabel}</td>
          <td className="px-3 py-1.5 text-slate-500">No category activity</td>
          <ExcludeCell empty />
          <AmountCells amounts={block.subtotal} />
        </tr>
      ) : null}
      {!isAwaitingPayment ? (
        <>
      <tr className="border-b border-slate-100">
        <td />
        <td />
        <td className="px-3 py-1.5 font-bold text-slate-900">Subtotal</td>
        <ExcludeCell empty />
        <AmountCells amounts={block.subtotal} emphasize />
      </tr>
      <tr className="border-b border-slate-100">
        <td />
        <td />
        <td className="px-3 py-1.5 font-bold text-slate-900">
          <RequiredTransferLabel />
        </td>
        <ExcludeCell empty />
        <AmountCells amounts={block.required} emphasize />
      </tr>
      {showRecordedRows ? (
        <>
      <tr>
        <td colSpan={BLOCK_COL_SPAN} className="h-2 bg-white p-0" />
      </tr>
      {block.recordedRows.map((row) => {
        const canEditOffsetNote =
          row.category === TRUE_UP_OFFSET_LABEL &&
          Boolean(onEditSettle && block.invoiceId);
        return (
        <tr key={`${block.id}-rec-${row.category}`} className="border-b border-slate-100">
          <td />
          <td />
          <td className="px-3 py-1.5 text-slate-800">
            {row.category}
            {row.note ? (
              <p
                className="mt-0.5 max-w-xs text-[11px] font-normal text-slate-500"
                title={row.note}
              >
                {row.note}
              </p>
            ) : null}
            {canEditOffsetNote ? (
              <button
                type="button"
                className="mt-0.5 text-[11px] font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
                disabled={settling}
                onClick={() =>
                  onEditSettle?.(block.invoiceId!, {
                    label: block.invoiceId!,
                  })
                }
              >
                Edit note
              </button>
            ) : null}
          </td>
          <ExcludeCell empty />
          <AmountCells amounts={row.amounts} />
        </tr>
        );
      })}
      <tr className="border-b border-slate-100">
        <td />
        <td />
        <td className="px-3 py-1.5 font-bold text-slate-900">Recorded Transfers</td>
        <ExcludeCell empty />
        <AmountCells amounts={block.recorded} emphasize />
      </tr>
      <DiscrepancyRow
        amounts={block.discrepancy}
        leadingCells={2}
        showExclude
        settleValue={block.offsetAccepted ? "yes" : "no"}
        settleReason={block.offsetReason}
        settleDisabled={settling || !onSettle || !block.invoiceId}
        onSettle={
          onSettle &&
          block.invoiceId &&
          (block.offsetAccepted || !isSettled(block.discrepancy))
            ? (settled) =>
                onSettle(block.invoiceId!, settled, {
                  label: block.invoiceId!,
                })
            : undefined
        }
        onEditReason={
          onEditSettle && block.invoiceId && block.offsetAccepted
            ? () =>
                onEditSettle(block.invoiceId!, {
                  label: block.invoiceId!,
                })
            : undefined
        }
      />
        </>
      ) : null}
        </>
      ) : isAwaitingPayment ? (
        <>
      <tr className="border-b border-slate-100 bg-amber-50/30">
        <td />
        <td />
        <td className="px-3 py-1.5 font-bold text-slate-900">
          {hasProjectedBreakdown ? "Subtotal (projected)" : "Subtotal"}
        </td>
        <ExcludeCell empty />
        <AmountCells amounts={projectedSubtotal} emphasize />
      </tr>
      <tr className="border-b border-slate-100 bg-amber-50/30">
        <td />
        <td />
        <td className="px-3 py-1.5 font-bold text-slate-900">
          <RequiredTransferLabel
            note={
              hasProjectedBreakdown ? "(projected)" : "(after payment)"
            }
          />
        </td>
        <ExcludeCell empty />
        <AmountCells
          amounts={projectedRequired}
          emphasize
          unknown={block.projectedPayeeUnknown}
        />
      </tr>
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
  const [groupBy, setGroupBy] = useState<TrueUpGroupBy>("month");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ReturnType<typeof normalizeLedgerRow>[]>(
    []
  );
  const [invoiceRows, setInvoiceRows] = useState<InvoiceOffsetRow[]>([]);
  const [excluding, setExcluding] = useState(false);
  const [settling, setSettling] = useState(false);
  const [excludeError, setExcludeError] = useState<string | null>(null);
  const [offsetError, setOffsetError] = useState<string | null>(null);
  const [excludePrompt, setExcludePrompt] = useState<{
    ids: string[];
    label: string;
  } | null>(null);
  const [settlePrompt, setSettlePrompt] = useState<{
    invoiceId: string;
    label: string;
    reason: string;
    editing: boolean;
  } | null>(null);

  const patchEntry = useCallback((id: string, patch: Partial<LedgerEntry>) => {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
    );
  }, []);

  const saveExclude = useCallback(
    async (ids: string[], excluded: boolean, reason = "") => {
      const unique = [...new Set(ids.filter(Boolean))];
      if (unique.length === 0) return;
      if (excluded && !reason.trim()) return;
      const previous = new Map(
        unique.map((id) => {
          const entry = entries.find((item) => item.id === id);
          return [
            id,
            {
              true_up_eligible: entry?.true_up_eligible ?? null,
              true_up_payment_id: entry?.true_up_payment_id ?? null,
              true_up_exclude_reason: entry?.true_up_exclude_reason ?? "",
            },
          ] as const;
        })
      );
      const patch: Partial<LedgerEntry> = {
        true_up_eligible: excluded ? false : true,
        true_up_exclude_reason: excluded ? reason.trim() : "",
        ...(excluded ? { true_up_payment_id: null } : {}),
      };
      setExcludeError(null);
      setExcluding(true);
      for (const id of unique) patchEntry(id, patch);
      const supabase = createClient();
      const { error } = await supabase.from("ledger").update(patch).in("id", unique);
      setExcluding(false);
      if (!error) return;
      for (const id of unique) {
        const prior = previous.get(id);
        if (prior) patchEntry(id, prior);
      }
      setExcludeError(
        isTrueUpExcludeSchemaError(error.message)
          ? `Run migrations 083 and 084 in Supabase so exclude can save.\n\n${TRUE_UP_EXCLUDE_SETUP_SQL}`
          : error.message
      );
    },
    [entries, patchEntry]
  );

  const requestExclude = useCallback(
    (ids: string[], excluded: boolean, context?: { label: string }) => {
      if (excluded) {
        setExcludePrompt({
          ids,
          label: context?.label ?? "this item",
        });
        return;
      }
      void saveExclude(ids, false, "");
    },
    [saveExclude]
  );

  const patchInvoiceOffset = useCallback(
    (id: string, patch: Partial<InvoiceOffsetRow>) => {
      setInvoiceRows((current) =>
        current.map((row) => (row.id === id ? { ...row, ...patch } : row))
      );
    },
    []
  );

  const saveOffset = useCallback(
    async (invoiceId: string, accepted: boolean, reason = "") => {
      const key = normalizeInvoiceId(invoiceId);
      if (!key) return;
      if (accepted && !reason.trim()) return;
      const row = invoiceRows.find(
        (item) => normalizeInvoiceId(item.invoice_id) === key
      );
      if (!row) {
        setOffsetError(
          `No invoicing record found for ${key}, so this remaining amount cannot be settled from True Up.`
        );
        return;
      }
      const previous = {
        true_up_offset_accepted: row.true_up_offset_accepted,
        true_up_offset_reason: row.true_up_offset_reason,
      };
      const patch = {
        true_up_offset_accepted: accepted,
        true_up_offset_reason: accepted ? reason.trim() : "",
      };
      setOffsetError(null);
      setSettling(true);
      patchInvoiceOffset(row.id, patch);
      const supabase = createClient();
      const { error } = await supabase.from("invoicing").update(patch).eq("id", row.id);
      setSettling(false);
      if (!error) return;
      patchInvoiceOffset(row.id, previous);
      setOffsetError(
        isTrueUpOffsetSchemaError(error.message)
          ? `Run migration 086 in Supabase so non-cash offsets can save.\n\n${TRUE_UP_OFFSET_SETUP_SQL}`
          : error.message
      );
    },
    [invoiceRows, patchInvoiceOffset]
  );

  const requestSettle = useCallback(
    (invoiceId: string, settled: boolean, context?: { label: string }) => {
      if (settled) {
        setSettlePrompt({
          invoiceId,
          label: context?.label ?? invoiceId,
          reason: "",
          editing: false,
        });
        return;
      }
      void saveOffset(invoiceId, false, "");
    },
    [saveOffset]
  );

  const requestEditSettle = useCallback(
    (invoiceId: string, context?: { label: string }) => {
      const key = normalizeInvoiceId(invoiceId);
      const row = invoiceRows.find(
        (item) => normalizeInvoiceId(item.invoice_id) === key
      );
      setSettlePrompt({
        invoiceId,
        label: context?.label ?? invoiceId,
        reason: (row?.true_up_offset_reason ?? "").trim(),
        editing: true,
      });
    },
    [invoiceRows]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const [ledgerResult, invoiceResult] = await Promise.all([
      fetchAllLedgerRows(supabase, "*, clients(name)"),
      supabase
        .from("invoicing")
        .select("id, invoice_id, true_up_offset_accepted, true_up_offset_reason"),
    ]);
    if (ledgerResult.error) {
      setLoadError(ledgerResult.error);
      setEntries([]);
    } else {
      setEntries(ledgerResult.data.map((row) => normalizeLedgerRow(row)));
    }

    if (invoiceResult.error) {
      if (isTrueUpOffsetSchemaError(invoiceResult.error.message)) {
        setOffsetError(
          `Run migration 086 in Supabase so remaining discrepancy can be settled without a bank transfer.\n\n${TRUE_UP_OFFSET_SETUP_SQL}`
        );
        const fallback = await supabase.from("invoicing").select("id, invoice_id");
        setInvoiceRows(
          (fallback.data ?? []).map((row) => ({
            id: String(row.id),
            invoice_id: (row.invoice_id as string | null) ?? null,
            true_up_offset_accepted: false,
            true_up_offset_reason: "",
          }))
        );
      } else {
        setOffsetError(invoiceResult.error.message);
        setInvoiceRows([]);
      }
    } else {
      setOffsetError(null);
      setInvoiceRows(
        (invoiceResult.data ?? []).map((row) => ({
          id: String(row.id),
          invoice_id: (row.invoice_id as string | null) ?? null,
          true_up_offset_accepted: Boolean(row.true_up_offset_accepted),
          true_up_offset_reason: String(row.true_up_offset_reason ?? ""),
        }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const invoiceOffsets = useMemo(() => {
    const map = new Map<string, TrueUpInvoiceOffset>();
    for (const row of invoiceRows) {
      const invoiceId = normalizeInvoiceId(row.invoice_id);
      if (!invoiceId) continue;
      map.set(invoiceId, {
        accepted: row.true_up_offset_accepted,
        reason: row.true_up_offset_reason.trim(),
      });
    }
    return map;
  }, [invoiceRows]);

  const report = useMemo(
    () => buildTrueUpReport(entries, year, groupBy, invoiceOffsets),
    [entries, year, groupBy, invoiceOffsets]
  );
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
        description="Cash-basis accounting between partners. Required transfer is 50% of retail price minus designer cost. Tax, shipping, receiving, delivery, and fees stay with whoever collected or paid them and are not part of the transfer. Send is negative, receive is positive."
        action={
          <div className="flex flex-wrap gap-2">
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
            <SelectField
              label="Group expenses by"
              className="min-w-44"
              value={groupBy}
              onChange={(event) =>
                setGroupBy(event.target.value as TrueUpGroupBy)
              }
            >
              <option value="month">Month</option>
              <option value="coa">COA category</option>
            </SelectField>
          </div>
        }
      />

      {loadError ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Could not load ledger data: {loadError}
        </div>
      ) : null}

      {excludeError ? (
        <div className="mb-4 whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {excludeError}
        </div>
      ) : null}

      {offsetError ? (
        <div className="mb-4 whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {offsetError}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading true-up report...</p>
      ) : (
        <div className="space-y-8">
          <CollapsibleSection
            title="Sales and Revenue"
            description="Cash in and out by invoice. COGS is designer cost (who paid). Sales income is retail price (who received payment). Required transfer equalizes so each partner gets half of retail minus designer cost. Tax, shipping, receiving, delivery, and fees are omitted from that transfer. Exclude from true up keeps the Jess/Molly amounts on the line and only drops those values from Required Transfer. If you netted unrelated expenses instead of sending the full required transfer, set Settle remaining to Yes on the discrepancy — that zeros the invoice without posting a 304 to checking. Jobs with purchases but no client payment yet show as Pending."
          >
            <BlockTable
              sectionLabel="Sales&Revenue"
              secondaryHeader="Invoice"
              blocks={report.sales}
              ytdTotals={report.ytdSales}
              expandableCategories
              stickyHeader
              onExclude={requestExclude}
              excluding={excluding}
              onSettle={requestSettle}
              onEditSettle={requestEditSettle}
              settling={settling}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="Expenses"
            description={
              groupBy === "coa"
                ? "Operating cash by COA category, with months inside each category. Expand a month to see its transactions. Expenses (debits) are negative. Required transfer splits that category's cash 50/50: send is negative, receive is positive. Exclude from true up keeps the Jess/Molly amounts on the line and only drops those values from Required Transfer. Recorded transfers stay on the YTD row because they are not tagged to an expense category."
                : "Operating cash by month and COA category. Expand a category to see its transactions. Expenses (debits) are negative. Required transfer splits that month's cash 50/50: send is negative, receive is positive. Exclude from true up keeps the Jess/Molly amounts on the line and only drops those values from Required Transfer."
            }
          >
            <BlockTable
              sectionLabel="Expenses"
              groupHeader={groupBy === "coa" ? "COA Category" : "Expenses"}
              secondaryHeader={groupBy === "coa" ? "" : "Date"}
              categoryHeader={groupBy === "coa" ? "Month" : "COA Category"}
              blocks={report.expenses}
              ytdTotals={report.ytdExpenses}
              expandableCategories
              showRecordedRows={groupBy !== "coa"}
              onExclude={requestExclude}
              excluding={excluding}
            />
          </CollapsibleSection>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">YTD</h2>
            <p className="mb-3 text-sm text-slate-600">
              Year-to-date Required, Recorded, and Discrepancy for Goods and
              Services and for Expenses, then Grand Total YTD for both.
              Positive = received; negative = sent. Discrepancy is required
              minus recorded. Unassigned (TBD) is invoiced income not yet
              received and purchases not yet assigned to Jess or Molly — it is
              not part of Required or Recorded.
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
                    <th className="px-3 py-2 text-right font-semibold">TBD</th>
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
      {excludePrompt ? (
        <TrueUpExcludeReasonModal
          itemLabel={excludePrompt.label}
          count={excludePrompt.ids.length}
          onCancel={() => setExcludePrompt(null)}
          onConfirm={(reason) => {
            const ids = excludePrompt.ids;
            setExcludePrompt(null);
            void saveExclude(ids, true, reason);
          }}
        />
      ) : null}
      {settlePrompt ? (
        <TrueUpReasonModal
          title={
            settlePrompt.editing
              ? "Edit settle remaining note?"
              : "Settle remaining discrepancy?"
          }
          itemLabel={settlePrompt.label}
          description={
            settlePrompt.editing
              ? "Update why this remaining true-up was settled without posting a 304 to checking."
              : "This zeros the remaining true-up without posting a 304 to checking. Use it when you deducted unrelated expenses instead of sending the full required transfer."
          }
          confirmLabel={settlePrompt.editing ? "Save note" : "Settle"}
          requiredError="A description is required to settle the remaining discrepancy."
          placeholder="Why was the remaining amount not transferred?"
          initialValue={settlePrompt.reason}
          onCancel={() => setSettlePrompt(null)}
          onConfirm={(reason) => {
            const invoiceId = settlePrompt.invoiceId;
            setSettlePrompt(null);
            void saveOffset(invoiceId, true, reason);
          }}
        />
      ) : null}
    </AppShell>
  );
}
