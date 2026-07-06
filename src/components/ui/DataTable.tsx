interface DataTableProps {
  columns: { key: string; label: string; className?: string }[];
  rows: Record<string, React.ReactNode>[];
  emptyMessage?: string;
  rowKey?: (row: Record<string, React.ReactNode>, index: number) => string;
  stickyLastColumn?: boolean;
  stickyFirstColumn?: boolean;
  /** Primary field shown as card title on mobile (defaults to first column). */
  mobileTitleKey?: string;
  /** Optional footer row; keys should match column keys. */
  footerRow?: Record<string, React.ReactNode>;
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
  mobileTitleKey,
  footerRow,
}: DataTableProps) {
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
  const detailColumns = columns.filter(
    (column) => column.key !== titleKey && column.key !== "actions"
  );
  const actionsColumn = columns.find((column) => column.key === "actions");
  const actionsFirst = firstColumnKey === "actions";

  return (
    <>
      <div className="space-y-3 md:hidden">
        {rows.map((row, index) => (
          <article
            key={resolveRowKey(row, index, rowKey)}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            {actionsFirst && actionsColumn && row.actions != null && (
              <div className="mb-4 border-b border-slate-100 pb-4">{row.actions}</div>
            )}
            {titleKey && row[titleKey] != null && (
              <p className="font-medium text-slate-900">{row[titleKey]}</p>
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
        ))}
        {footerRow && (
          <article className="rounded-xl border border-slate-300 bg-slate-50 p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Totals (all invoiced lines)
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

      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-4 py-3 text-left font-medium text-slate-600 ${column.className ?? ""} ${
                    stickyFirstColumn && column.key === firstColumnKey ? stickyLeftHeader : ""
                  } ${
                    stickyLastColumn && column.key === lastColumnKey ? stickyRightHeader : ""
                  }`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={resolveRowKey(row, index, rowKey)} className="group hover:bg-slate-50/80">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3 text-slate-800 ${column.className ?? ""} ${
                      stickyFirstColumn && column.key === firstColumnKey
                        ? `${stickyLeftCell} group-hover:bg-slate-50/80`
                        : ""
                    } ${
                      stickyLastColumn && column.key === lastColumnKey
                        ? `${stickyRightCell} group-hover:bg-slate-50/80`
                        : ""
                    }`}
                  >
                    {row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footerRow && (
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
                    {footerRow[column.key]}
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
