"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { Invoice } from "@/lib/types";
import {
  getInvoiceLineBreakdown,
  sumInvoiceLineBreakdowns,
  type InvoiceLineItem,
} from "@/lib/invoice-utils";
import { formatCurrency, formatDate } from "@/lib/utils";

const InvoicePdfPreview = dynamic(
  () => import("./InvoicePdfPreview").then((mod) => mod.InvoicePdfPreview),
  { ssr: false }
);

interface InvoiceDetailViewProps {
  invoice: Pick<Invoice, "invoice_id" | "po_number" | "invoice_date" | "notes"> & {
    clients?: { name: string; address?: string | null } | null;
  };
  lines: InvoiceLineItem[];
  onClose: () => void;
}

export function InvoiceDetailView({
  invoice,
  lines,
  onClose,
}: InvoiceDetailViewProps) {
  const totals = sumInvoiceLineBreakdowns(lines);
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-detail-title"
    >
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-slate-100 bg-white px-4 py-4 sm:px-6">
          <div>
            <h2 id="invoice-detail-title" className="text-lg font-semibold text-slate-900">
              Invoice {invoice.invoice_id}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {invoice.clients?.name ?? "—"} · PO {invoice.po_number}
              {invoice.invoice_date ? ` · ${formatDate(invoice.invoice_date)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => setShowPdfPreview(true)}
              disabled={lines.length === 0}
            >
              Preview PDF
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-6">
          {invoice.notes && (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <span className="font-medium">Notes:</span> {invoice.notes}
            </p>
          )}

          {lines.length === 0 ? (
            <p className="text-sm text-slate-500">
              No line items on this invoice yet. Close this window, click{" "}
              <strong>Edit</strong> on the invoice, check the ledger items to include, and save.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2 text-right">Customer Price</th>
                    <th className="px-3 py-2 text-right">Tax</th>
                    <th className="px-3 py-2 text-right">Shipping</th>
                    <th className="px-3 py-2 text-right">Payment Fee</th>
                    <th className="px-3 py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line) => {
                    const breakdown = getInvoiceLineBreakdown(line);
                    return (
                      <tr key={line.id}>
                        <td className="px-3 py-2">{formatDate(line.entry_date)}</td>
                        <td className="px-3 py-2">{line.description ?? "—"}</td>
                        <td className="px-3 py-2">{Math.round(Number(line.quantity))}</td>
                        <td className="px-3 py-2 text-right">
                          {formatCurrency(breakdown.merchandise)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {breakdown.taxLabel === "N/A"
                            ? "N/A"
                            : formatCurrency(breakdown.tax)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatCurrency(breakdown.shipping)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatCurrency(breakdown.paymentFee)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          {formatCurrency(breakdown.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                    <td colSpan={3} className="px-3 py-3 text-right">
                      Invoice totals
                    </td>
                    <td className="px-3 py-3 text-right">
                      {formatCurrency(totals.merchandise)}
                    </td>
                    <td className="px-3 py-3 text-right">{formatCurrency(totals.tax)}</td>
                    <td className="px-3 py-3 text-right">
                      {formatCurrency(totals.shipping)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {formatCurrency(totals.paymentFee)}
                    </td>
                    <td className="px-3 py-3 text-right text-brand-800">
                      {formatCurrency(totals.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {showPdfPreview && (
        <InvoicePdfPreview
          clientName={invoice.clients?.name ?? "—"}
          location={invoice.clients?.address ?? "—"}
          invoiceNumber={invoice.invoice_id ?? "—"}
          projectName={invoice.po_number}
          lines={lines}
          onClose={() => setShowPdfPreview(false)}
        />
      )}
    </div>
  );
}
