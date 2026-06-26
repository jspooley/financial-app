interface DataTableProps {
  columns: { key: string; label: string; className?: string }[];
  rows: Record<string, React.ReactNode>[];
  emptyMessage?: string;
  rowKey?: (row: Record<string, React.ReactNode>, index: number) => string;
  stickyLastColumn?: boolean;
}

export function DataTable({
  columns,
  rows,
  emptyMessage = "No records yet.",
  rowKey,
  stickyLastColumn = false,
}: DataTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  const lastColumnKey = columns[columns.length - 1]?.key;
  const stickyCell =
    "sticky right-0 z-10 bg-white shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]";
  const stickyHeader = "sticky right-0 z-10 bg-slate-50 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]";

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
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
  );
}
