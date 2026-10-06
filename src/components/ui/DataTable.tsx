"use client";

import { useEffect, useRef, useState } from "react";

type DataTableColumn = {
  key: string;
  label: string;
  className?: string;
  sortable?: boolean;
};

interface DataTableProps {
  columns: DataTableColumn[];
  rows: Record<string, React.ReactNode>[];
  emptyMessage?: string;
  rowKey?: (row: Record<string, React.ReactNode>, index: number) => string;
  stickyLastColumn?: boolean;
  stickyFirstColumn?: boolean;
  /** Keep column header row visible while scrolling (desktop table). */
  stickyHeader?: boolean;
  /** Max height for the desktop table body; enables vertical scroll with sticky header. */
  maxBodyHeight?: string;
  /** Totals shown in parentheses under column labels on desktop (replaces footer row). */
  columnTotals?: Record<string, React.ReactNode>;
  /** Primary field shown as card title on mobile (defaults to first column). */
  mobileTitleKey?: string;
  /** Optional footer row; keys should match column keys. */
  footerRow?: Record<string, React.ReactNode>;
  /** Mobile footer heading (defaults to "Totals"). */
  footerTitle?: string;
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;
  getRowId?: (row: Record<string, React.ReactNode>, index: number) => string | undefined;
  highlightedRowId?: string | null;
  /** Range control that scrolls the desktop table horizontally. */
  horizontalSlider?: boolean;
}

function SortIndicator({
  active,
  direction,
}: {
  active: boolean;
  direction: "asc" | "desc";
}) {
  if (!active) {
    return <span className="text-slate-300">↕</span>;
  }
  return <span className="text-brand-700">{direction === "asc" ? "↑" : "↓"}</span>;
}

function resolveRowKey(
  row: Record<string, React.ReactNode>,
  index: number,
  rowKey?: (row: Record<string, React.ReactNode>, index: number) => string
): string {
  const key = rowKey?.(row, index) ?? index;
  if (typeof key === "string" && key.length > 0) return key;
  if (typeof key === "number" && !Number.isNaN(key)) return String(key);
  return String(index);
}

export function DataTable({
  columns,
  rows,
  emptyMessage = "No records yet.",
  rowKey,
  stickyLastColumn = false,
  stickyFirstColumn = false,
  stickyHeader = false,
  maxBodyHeight,
  columnTotals,
  mobileTitleKey,
  footerRow,
  footerTitle = "Totals",
  sortKey,
  sortDirection = "asc",
  onSort,
  getRowId,
  highlightedRowId,
  horizontalSlider = false,
}: DataTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollMax, setScrollMax] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  useEffect(() => {
    if (!horizontalSlider) return;
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      setScrollMax(max);
      setScrollLeft(Math.min(el.scrollLeft, max));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    const table = el.querySelector("table");
    if (table) observer.observe(table);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [horizontalSlider, rows, columns]);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  const firstColumnKey = columns[0]?.key;
  const lastColumnKey = columns[columns.length - 1]?.key;
  const titleKey =
    mobileTitleKey ?? (firstColumnKey === "actions" ? columns[1]?.key : firstColumnKey);
  const stickyLeftCell =
    "sticky left-0 z-10 bg-white shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)]";
  const stickyLeftHeader =
    "sticky left-0 z-10 bg-slate-50 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)]";
  const stickyRightCell =
    "sticky right-0 z-10 bg-white shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]";
  const stickyRightHeader =
    "sticky right-0 z-10 bg-slate-50 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]";
  const stickyTopHeader = "sticky top-0 z-20 bg-slate-50 shadow-[0_1px_0_0_rgb(226,232,240)]";
  const stickyTopLeftHeader =
    "sticky left-0 top-0 z-30 bg-slate-50 shadow-[4px_1px_8px_-4px_rgba(0,0,0,0.08)]";
  const detailColumns = columns.filter(
    (column) => column.key !== titleKey && column.key !== "actions"
  );
  const actionsColumn = columns.find((column) => column.key === "actions");
  const actionsFirst = firstColumnKey === "actions";
  const desktopFooterRow = columnTotals ? undefined : footerRow;
  const sortableColumns = columns.filter((column) => column.sortable && onSort);

  return (
    <>
      {sortableColumns.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2 md:hidden">
          {sortableColumns.map((column) => {
            const active = sortKey === column.key;
            return (
              <button
                key={column.key}
                type="button"
                onClick={() => onSort?.(column.key)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                  active
                    ? "border-brand-300 bg-brand-50 text-brand-800"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                {column.label}
                <SortIndicator active={active} direction={sortDirection} />
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="space-y-3 md:hidden">
        {rows.map((row, index) => {
          const rowId = getRowId?.(row, index);
          const highlighted = Boolean(
            highlightedRowId && rowId === highlightedRowId
          );
          return (
          <article
            key={resolveRowKey(row, index, rowKey)}
            data-ledger-id={rowId}
            className={`rounded-xl border bg-white p-4 shadow-sm ${
              highlighted
                ? "border-amber-300 bg-amber-50 ring-1 ring-amber-200"
                : "border-slate-200"
            }`}
          >
            {actionsFirst && actionsColumn && row.actions != null && (
              <div className="mb-4 border-b border-slate-100 pb-4">{row.actions}</div>
            )}
            {titleKey && row[titleKey] != null && (
              <div className="font-medium text-slate-900">{row[titleKey]}</div>
            )}
            <dl className={`space-y-2 text-sm ${titleKey ? "mt-3" : ""}`}>
              {detailColumns.map((column) => (
                <div key={column.key} className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-slate-500">{column.label}</dt>
                  <dd className="min-w-0 text-right text-slate-800">{row[column.key]}</dd>
                </div>
              ))}
            </dl>
            {!actionsFirst && actionsColumn && row.actions != null && (
              <div className="mt-4 border-t border-slate-100 pt-4">{row.actions}</div>
            )}
          </article>
          );
        })}
        {footerRow && (
          <article className="rounded-xl border border-slate-300 bg-slate-50 p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {footerTitle}
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              {columns.map((column) =>
                footerRow[column.key] != null && footerRow[column.key] !== "" ? (
                  <div key={column.key} className="flex items-start justify-between gap-3">
                    <dt className="shrink-0 text-slate-600">{column.label}</dt>
                    <dd className="min-w-0 text-right font-semibold text-slate-900">
                      {footerRow[column.key]}
                    </dd>
                  </div>
                ) : null
              )}
            </dl>
          </article>
        )}
      </div>

      {horizontalSlider && scrollMax > 0 ? (
        <label className="mb-2 hidden w-full items-center gap-3 text-sm text-slate-600 md:flex">
          <span className="shrink-0">Scroll</span>
          <input
            type="range"
            min={0}
            max={scrollMax}
            value={scrollLeft}
            aria-label="Scroll table"
            onChange={(event) => {
              const next = Number(event.target.value);
              if (scrollRef.current) scrollRef.current.scrollLeft = next;
              setScrollLeft(next);
            }}
            className="h-2 w-full cursor-pointer accent-brand-600"
          />
        </label>
      ) : null}
      <div
        ref={scrollRef}
        className={`hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block ${
          maxBodyHeight ? "overflow-auto" : "overflow-x-auto"
        }`}
        style={maxBodyHeight ? { maxHeight: maxBodyHeight } : undefined}
      >
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => {
                const total = columnTotals?.[column.key];
                const showTotal = total != null && total !== "";

                const active = sortKey === column.key;
                const canSort = Boolean(column.sortable && onSort);

                return (
                <th
                  key={column.key}
                  aria-sort={
                    canSort
                      ? active
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                      : undefined
                  }
                  className={`px-4 py-3 text-left font-medium text-slate-600 ${column.className ?? ""} ${
                    stickyHeader && stickyFirstColumn && column.key === firstColumnKey
                      ? stickyTopLeftHeader
                      : stickyHeader
                        ? stickyTopHeader
                        : ""
                  } ${
                    !stickyHeader && stickyFirstColumn && column.key === firstColumnKey
                      ? stickyLeftHeader
                      : ""
                  } ${
                    stickyLastColumn && column.key === lastColumnKey ? stickyRightHeader : ""
                  }`}
                >
                  {canSort ? (
                    <button
                      type="button"
                      onClick={() => onSort?.(column.key)}
                      className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded text-left hover:text-slate-900"
                    >
                      {column.label}
                      <SortIndicator active={active} direction={sortDirection} />
                    </button>
                  ) : (
                    <span className="block whitespace-nowrap">{column.label}</span>
                  )}
                  {showTotal ? (
                    <span className="mt-0.5 block whitespace-nowrap text-xs font-semibold text-slate-900">
                      ({total})
                    </span>
                  ) : null}
                </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => {
              const rowId = getRowId?.(row, index);
              const highlighted = Boolean(
                highlightedRowId && rowId === highlightedRowId
              );
              return (
              <tr
                key={resolveRowKey(row, index, rowKey)}
                data-ledger-id={rowId}
                className={`group hover:bg-slate-50/80 ${
                  highlighted ? "bg-amber-50" : ""
                }`}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3 text-slate-800 ${column.className ?? ""} ${
                      stickyFirstColumn && column.key === firstColumnKey
                        ? `${stickyLeftCell} group-hover:bg-slate-50/80 ${
                            highlighted ? "bg-amber-50" : ""
                          }`
                        : ""
                    } ${
                      stickyLastColumn && column.key === lastColumnKey
                        ? `${stickyRightCell} group-hover:bg-slate-50/80 ${
                            highlighted ? "bg-amber-50" : ""
                          }`
                        : ""
                    }`}
                  >
                    {row[column.key]}
                  </td>
                ))}
              </tr>
              );
            })}
          </tbody>
          {desktopFooterRow && (
            <tfoot className="border-t-2 border-slate-300 bg-slate-50">
              <tr>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3 font-semibold text-slate-900 ${column.className ?? ""} ${
                      stickyFirstColumn && column.key === firstColumnKey
                        ? "sticky left-0 z-10 bg-slate-50 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)]"
                        : ""
                    } ${
                      stickyLastColumn && column.key === lastColumnKey
                        ? "sticky right-0 z-10 bg-slate-50 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]"
                        : ""
                    }`}
                  >
                    {desktopFooterRow[column.key]}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
