export function budgetPdfFilename(clientName: string, poNumber?: string): string {
  const safeClient = clientName.replace(/[^\w.-]+/g, "_");
  if (poNumber?.trim()) {
    const safePo = poNumber.trim().replace(/[^\w.-]+/g, "_");
    return `Investment-Approach-${safeClient}-${safePo}.pdf`;
  }
  return `Investment-Approach-${safeClient}.pdf`;
}

export function clientBudgetPdfStoragePath(clientId: string, poId: string) {
  return `${clientId}/${poId}.pdf`;
}

export const CLIENT_BUDGET_PDF_BUCKET = "client-budgets";

export { saveInvoicePdf as saveBudgetPdf, renderElementToPdfBlob } from "@/lib/invoice-pdf";
