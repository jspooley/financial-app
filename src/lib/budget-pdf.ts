export function budgetPdfFilename(clientName: string, poNumber?: string): string {
  const safeClient = clientName.replace(/[^\w.-]+/g, "_");
  if (poNumber?.trim()) {
    const safePo = poNumber.trim().replace(/[^\w.-]+/g, "_");
    return `Investment-Approach-${safeClient}-${safePo}.pdf`;
  }
  return `Investment-Approach-${safeClient}.pdf`;
}

export { saveInvoicePdf as saveBudgetPdf } from "@/lib/invoice-pdf";
