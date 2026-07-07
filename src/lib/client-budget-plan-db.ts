"use client";

import {
  buildClientBudgetPlanSaved,
} from "@/lib/budget-planner-state";
import {
  CLIENT_BUDGET_PDF_BUCKET,
  clientBudgetPdfStoragePath,
  renderElementToPdfBlob,
} from "@/lib/budget-pdf";
import { createClient } from "@/lib/supabase/client";
import { roundMoney } from "@/lib/utils";
import type { BudgetPlannerState } from "@/lib/budget-planner-state";

export async function saveClientBudgetPlan({
  clientId,
  poId,
  plannerState,
  grandTotal,
  pdfElement,
}: {
  clientId: string;
  poId: string;
  plannerState: BudgetPlannerState;
  grandTotal: number;
  pdfElement?: HTMLElement | null;
}) {
  const supabase = createClient();
  const budgetAmount = roundMoney(grandTotal);
  const budgetPlan = buildClientBudgetPlanSaved(plannerState, budgetAmount);
  let budgetPdfPath: string | null = null;
  let pdfWarning: string | null = null;

  if (pdfElement) {
    try {
      const blob = await renderElementToPdfBlob(pdfElement);
      budgetPdfPath = clientBudgetPdfStoragePath(clientId, poId);
      const { error: uploadError } = await supabase.storage
        .from(CLIENT_BUDGET_PDF_BUCKET)
        .upload(budgetPdfPath, blob, {
          upsert: true,
          contentType: "application/pdf",
        });

      if (uploadError) {
        budgetPdfPath = null;
        pdfWarning = `Budget saved, but PDF upload failed: ${uploadError.message}`;
      }
    } catch (uploadError) {
      budgetPdfPath = null;
      pdfWarning =
        uploadError instanceof Error
          ? `Budget saved, but PDF could not be generated: ${uploadError.message}`
          : "Budget saved, but PDF could not be generated.";
    }
  }

  const { error: clientError } = await supabase
    .from("clients")
    .update({ budget: budgetAmount })
    .eq("id", clientId);

  if (clientError) {
    throw new Error(clientError.message);
  }

  const { error: poError } = await supabase
    .from("client_po_numbers")
    .update({
      budget: budgetAmount,
      budget_plan: budgetPlan,
      ...(budgetPdfPath ? { budget_pdf_path: budgetPdfPath } : {}),
    })
    .eq("id", poId);

  if (poError) {
    throw new Error(poError.message);
  }

  return { budgetPlan, budgetPdfPath, pdfWarning };
}

export async function downloadSavedClientBudgetPdf(storagePath: string) {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(CLIENT_BUDGET_PDF_BUCKET)
    .download(storagePath);

  if (error) {
    throw new Error(error.message);
  }

  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = storagePath.split("/").pop() ?? "client-budget.pdf";
  link.click();
  URL.revokeObjectURL(url);
}
