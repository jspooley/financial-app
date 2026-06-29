import { getLedgerOutstandingBalance, isLedgerLineFullyPaid } from "@/lib/invoice-utils";
import type { LedgerEntry } from "@/lib/types";
import {
  formatCurrency,
  formatDate,
  getLedgerCustomerPrice,
  getLedgerInvoicedAmount,
  getLedgerRetailSubtotal,
  getLedgerTotalDesignerCost,
} from "@/lib/utils";

export function ledgerTaxDisplay(entry: LedgerEntry) {
  return entry.wholesale_retail === "retail"
    ? "N/A"
    : formatCurrency(Number(entry.tax_amount));
}

export function ledgerDetailFields(entry: LedgerEntry) {
  return [
    { label: "Client", value: entry.clients?.name ?? "—" },
    { label: "Date", value: formatDate(entry.entry_date) },
    { label: "Retail Price", value: formatCurrency(Number(entry.retail_price ?? 0)) },
    { label: "Quantity", value: String(Math.round(Number(entry.quantity))) },
    {
      label: "Retail Price × Qty",
      value: formatCurrency(getLedgerRetailSubtotal(entry)),
    },
    { label: "Discount %", value: `${Number(entry.discount_percent)}%` },
    {
      label: "Customer Price × Qty",
      value: formatCurrency(getLedgerCustomerPrice(entry)),
    },
    { label: "Tax", value: ledgerTaxDisplay(entry) },
    {
      label: "Shipping",
      value: formatCurrency(Number(entry.shipping_receiving_amount ?? 0)),
    },
    { label: "Payment Fee", value: formatCurrency(Number(entry.payment_fee ?? 0)) },
    { label: "Invoiced Amount", value: formatCurrency(getLedgerInvoicedAmount(entry)) },
    {
      label: "Outstanding Balance",
      value:
        entry.credit_debit === "debit"
          ? formatCurrency(getLedgerOutstandingBalance(entry))
          : "—",
    },
    { label: "Invoiced", value: entry.invoiced ? "Yes" : "No" },
    { label: "Invoice ID", value: entry.invoice_id ?? "—" },
    {
      label: "Paid Amount",
      value:
        entry.credit_debit === "debit"
          ? formatCurrency(Number(entry.payment_amount ?? 0))
          : "—",
    },
    {
      label: "Write Off",
      value: entry.credit_debit === "debit" ? (entry.write_off ? "Yes" : "No") : "—",
    },
    {
      label: "Write Off Amount",
      value:
        entry.credit_debit === "debit"
          ? formatCurrency(Number(entry.write_off_amount ?? 0))
          : "—",
    },
    {
      label: "Paid",
      value:
        entry.credit_debit === "debit"
          ? isLedgerLineFullyPaid(entry)
            ? "Yes"
            : "No"
          : "—",
    },
    { label: "Purchaser", value: entry.purchaser },
    {
      label: "Paid To",
      value: entry.credit_debit === "debit" ? (entry.paid_to ?? "—") : "—",
    },
    {
      label: "Date Paid",
      value:
        entry.credit_debit === "debit" && entry.date_paid
          ? formatDate(entry.date_paid)
          : "—",
    },
    { label: "Designer Cost", value: formatCurrency(Number(entry.designer_cost)) },
    {
      label: "Total Designer Cost",
      value: formatCurrency(getLedgerTotalDesignerCost(entry)),
    },
    { label: "PO", value: entry.po_number ?? "—" },
    { label: "Type", value: `${entry.credit_debit} / ${entry.wholesale_retail}` },
    {
      label: "Sales and Use Tax Paid",
      value: entry.sales_and_use_tax_paid ? "Yes" : "No",
    },
  ];
}

export function mapLedgerTableRow(entry: LedgerEntry) {
  return {
    client: entry.clients?.name ?? "—",
    date: formatDate(entry.entry_date),
    retailPrice: formatCurrency(Number(entry.retail_price ?? 0)),
    qty: Math.round(Number(entry.quantity)),
    retailPriceQty: formatCurrency(getLedgerRetailSubtotal(entry)),
    discount: `${Number(entry.discount_percent)}%`,
    customerPrice: formatCurrency(getLedgerCustomerPrice(entry)),
    tax: ledgerTaxDisplay(entry),
    shipping: formatCurrency(Number(entry.shipping_receiving_amount ?? 0)),
    paymentFee: formatCurrency(Number(entry.payment_fee ?? 0)),
    invoicedAmount: formatCurrency(getLedgerInvoicedAmount(entry)),
    outstandingBalance:
      entry.credit_debit === "debit"
        ? formatCurrency(getLedgerOutstandingBalance(entry))
        : "—",
    invoiced: entry.invoiced ? "Yes" : "No",
    invoiceId: entry.invoice_id ?? "—",
    paidAmount:
      entry.credit_debit === "debit"
        ? formatCurrency(Number(entry.payment_amount ?? 0))
        : "—",
    writeOff: entry.credit_debit === "debit" ? (entry.write_off ? "Yes" : "No") : "—",
    writeOffAmount:
      entry.credit_debit === "debit"
        ? formatCurrency(Number(entry.write_off_amount ?? 0))
        : "—",
    paid: entry.credit_debit === "debit" ? (isLedgerLineFullyPaid(entry) ? "Yes" : "No") : "—",
    purchaser: entry.purchaser,
    paidTo: entry.credit_debit === "debit" ? (entry.paid_to ?? "—") : "—",
    datePaid:
      entry.credit_debit === "debit" && entry.date_paid
        ? formatDate(entry.date_paid)
        : "—",
    designerCost: formatCurrency(Number(entry.designer_cost)),
    totalDesignerCost: formatCurrency(getLedgerTotalDesignerCost(entry)),
    po: entry.po_number ?? "—",
    type: `${entry.credit_debit} / ${entry.wholesale_retail}`,
    salesUseTaxPaid: entry.sales_and_use_tax_paid ? "Yes" : "No",
  };
}

export const ledgerDetailColumns = [
  { key: "client", label: "Client" },
  { key: "date", label: "Date" },
  { key: "retailPrice", label: "Retail Price" },
  { key: "qty", label: "Quantity" },
  { key: "retailPriceQty", label: "Retail Price × Qty" },
  { key: "discount", label: "Discount %" },
  { key: "customerPrice", label: "Customer Price × Qty" },
  { key: "tax", label: "Tax" },
  { key: "shipping", label: "Shipping" },
  { key: "paymentFee", label: "Payment Fee" },
  { key: "invoicedAmount", label: "Invoiced Amount" },
  { key: "outstandingBalance", label: "Outstanding Balance" },
  { key: "invoiced", label: "Invoiced" },
  { key: "invoiceId", label: "Invoice ID" },
  { key: "paidAmount", label: "Paid Amount" },
  { key: "writeOff", label: "Write Off" },
  { key: "writeOffAmount", label: "Write Off Amount" },
  { key: "paid", label: "Paid" },
  { key: "purchaser", label: "Purchaser" },
  { key: "paidTo", label: "Paid To" },
  { key: "datePaid", label: "Date Paid" },
  { key: "designerCost", label: "Designer Cost" },
  { key: "totalDesignerCost", label: "Total Designer Cost" },
  { key: "po", label: "PO" },
  { key: "type", label: "Type" },
  { key: "salesUseTaxPaid", label: "Sales and Use Tax Paid" },
] as const;
