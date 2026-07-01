"use client";

import { useRef, useState } from "react";
import { BudgetPdfContent } from "@/components/budget/BudgetPdfContent";
import { Button } from "@/components/ui/Button";
import { budgetPdfFilename, saveBudgetPdf } from "@/lib/budget-pdf";
import type { BudgetPlanSnapshot } from "@/lib/budget-utils";
import { printInvoicePdf } from "@/lib/invoice-pdf";

export interface BudgetPdfPreviewProps {
  clientName: string;
  poNumber?: string;
  plan: BudgetPlanSnapshot;
  onClose: () => void;
}

export function BudgetPdfPreview({
  clientName,
  poNumber,
  plan,
  onClose,
}: BudgetPdfPreviewProps) {
  const pdfRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<"save" | "print" | null>(null);

  const title = `Investment Approach for ${clientName}`;

  async function handleSave() {
    if (!pdfRef.current) return;
    setBusy("save");
    try {
      await saveBudgetPdf(pdfRef.current, budgetPdfFilename(clientName, poNumber));
    } catch (error) {
      console.error(error);
      alert("Could not save the PDF. Try Print and choose Save as PDF instead.");
    } finally {
      setBusy(null);
    }
  }

  function handlePrint() {
    if (!pdfRef.current) return;
    setBusy("print");
    try {
      printInvoicePdf(pdfRef.current, title);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="budget-pdf-title"
    >
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6">
          <div>
            <h2 id="budget-pdf-title" className="text-lg font-semibold text-slate-900">
              Investment Approach Preview
            </h2>
            <p className="text-sm text-slate-600">
              {clientName}
              {poNumber ? ` · PO ${poNumber}` : ""}
            </p>
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
            <BudgetPdfContent
              ref={pdfRef}
              clientName={clientName}
              poNumber={poNumber}
              plan={plan}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
