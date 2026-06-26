"use client";

import { Button } from "@/components/ui/Button";
import type { Invoice } from "@/lib/types";
import { invoiceLineTotal, type InvoiceLineItem } from "@/lib/invoice-utils";
import { formatCurrency, formatDate } from "@/lib/utils";

interface DeleteInvoiceDialogProps {
  invoice: Invoice;
  lines: InvoiceLineItem[];
  deleting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteInvoiceDialog({
  invoice,
  lines,
  deleting = false,
  onConfirm,
  onCancel,
}: DeleteInvoiceDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-invoice-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
          <h2 id="delete-invoice-title" className="text-lg font-semibold text-slate-900">
            Delete invoice {invoice.invoice_id}?
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            This cannot be undone. The following ledger items will be marked{" "}
            <strong>not invoiced</strong>:
          </p>
        </div>

        <div className="max-h-64 overflow-y-auto px-4 py-4 sm:px-6">
          {lines.length === 0 ? (
            <p className="text-sm text-slate-500">
              No ledger items are linked to this invoice. Only the invoice record will be
              removed.
            </p>
          ) : (
            <ul className="space-y-2 text-sm text-slate-800">
              {lines.map((line) => (
                <li
                  key={line.id}
                  className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                >
                  <span className="font-medium">{formatDate(line.entry_date)}</span>
                  <span className="text-slate-500"> — </span>
                  {line.description?.trim() || "Ledger item"}
                  <span className="mt-0.5 block text-slate-600">
                    {formatCurrency(invoiceLineTotal(line))}
                    {Number(line.quantity) > 1 ? ` · Qty ${line.quantity}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-4 py-4 sm:px-6">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm} loading={deleting}>
            Delete Invoice
          </Button>
        </div>
      </div>
    </div>
  );
}
