"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { InvoicePdfContent, type InvoicePdfContentProps } from "./InvoicePdfContent";
import { invoicePdfFilename, printInvoicePdf, saveInvoicePdf } from "@/lib/invoice-pdf";

interface InvoicePdfPreviewProps extends InvoicePdfContentProps {
  onClose: () => void;
}

export function InvoicePdfPreview({ onClose, ...contentProps }: InvoicePdfPreviewProps) {
  const invoiceRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<"save" | "print" | null>(null);

  async function handleSave() {
    if (!invoiceRef.current) return;
    setBusy("save");
    try {
      await saveInvoicePdf(
        invoiceRef.current,
        invoicePdfFilename(contentProps.invoiceNumber)
      );
    } catch (error) {
      console.error(error);
      alert("Could not save the PDF. Try Print and choose Save as PDF instead.");
    } finally {
      setBusy(null);
    }
  }

  function handlePrint() {
    if (!invoiceRef.current) return;
    setBusy("print");
    try {
      printInvoicePdf(invoiceRef.current, `Invoice ${contentProps.invoiceNumber}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-pdf-title"
    >
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6">
          <div>
            <h2 id="invoice-pdf-title" className="text-lg font-semibold text-slate-900">
              Invoice PDF Preview
            </h2>
            <p className="text-sm text-slate-600">{contentProps.invoiceNumber}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleSave}
              disabled={busy !== null}
            >
              {busy === "save" ? "Saving…" : "Save PDF"}
            </Button>
            <Button type="button" onClick={handlePrint} disabled={busy !== null}>
              {busy === "print" ? "Opening…" : "Print"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        <div className="overflow-auto bg-slate-100 p-4 sm:p-6">
          <div className="mx-auto w-fit shadow-lg">
            <InvoicePdfContent ref={invoiceRef} {...contentProps} />
          </div>
        </div>
      </div>
    </div>
  );
}
