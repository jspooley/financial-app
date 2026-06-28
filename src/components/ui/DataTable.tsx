interface DataTableProps {
  columns: { key: string; label: string; className?: string }[];
  rows: Record<string, React.ReactNode>[];
  emptyMessage?: string;
  rowKey?: (row: Record<string, React.ReactNode>, index: number) => string;
  stickyLastColumn?: boolean;
  /** Primary field shown as card title on mobile (defaults to first column). */
  mobileTitleKey?: string;
}

export function DataTable({
  columns,
  rows,
  emptyMessage = "No records yet.",
  rowKey,
  stickyLastColumn = false,
  mobileTitleKey,
}: DataTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  const lastColumnKey = columns[columns.length - 1]?.key;
  const titleKey = mobileTitleKey ?? columns[0]?.key;
  const stickyCell =
    "sticky right-0 z-10 bg-white shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]";
  const stickyHeader = "sticky right-0 z-10 bg-slate-50 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]";
  const detailColumns = columns.filter(
    (column) => column.key !== titleKey && column.key !== "actions"
  );
  const actionsColumn = columns.find((column) => column.key === "actions");

  return (
    <>
      <div className="space-y-3 md:hidden">
        {rows.map((row, index) => (
          <article
            key={rowKey?.(row, index) ?? index}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
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
            {actionsColumn && row.actions != null && (
              <div className="mt-4 border-t border-slate-100 pt-4">{row.actions}</div>
            )}
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-4 py-3 text-left font-medium text-slate-600 ${column.className ?? ""} ${
                    stickyLastColumn && column.key === lastColumnKey ? stickyHeader : ""
                  }`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={rowKey?.(row, index) ?? index} className="group hover:bg-slate-50/80">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3 text-slate-800 ${column.className ?? ""} ${
                      stickyLastColumn && column.key === lastColumnKey
                        ? `${stickyCell} group-hover:bg-slate-50/80`
                        : ""
                    }`}
                  >
                    {row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
