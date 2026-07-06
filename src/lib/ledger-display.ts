import { getLedgerOutstandingBalance } from "@/lib/invoice-utils";
import { computePlTotals, ledgerLineGrossProfit, ledgerLineNetProfit } from "@/lib/pl-report";
import type { LedgerEntry } from "@/lib/types";
import {
  formatCurrency,
  formatDate,
  formatPercent,
  formatQuantity,
  getLedgerCustomerPrice,
  getLedgerInvoicedAmount,
  getLedgerRetailSubtotal,
  getLedgerTotalDesignerCost,
  roundMoney,
} from "@/lib/utils";

export function ledgerTaxDisplay(entry: LedgerEntry) {
  return entry.wholesale_retail === "retail"
    ? "N/A"
    : formatCurrency(Number(entry.tax_amount));
}

export function ledgerDetailFields(
  entry: LedgerEntry,
  invoicedPoKeys?: Set<string>
) {
  return [
    { label: "Client", value: entry.clients?.name ?? "—" },
    { label: "Date", value: formatDate(entry.entry_date) },
    { label: "Description", value: entry.description?.trim() || "—" },
    { label: "Retail Price", value: formatCurrency(Number(entry.retail_price ?? 0)) },
    { label: "Quantity", value: formatQuantity(Number(entry.quantity)) },
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
      label: "Gross Profit",
      value: formatCurrency(ledgerLineGrossProfit(entry, invoicedPoKeys)),
    },
    {
      label: "Net Profit",
      value: formatCurrency(ledgerLineNetProfit(entry, invoicedPoKeys)),
    },
    {
      label: "Expense",
      value: entry.credit_debit === "debit" ? (entry.expense ? "Yes" : "No") : "—",
    },
    {
      label: "Expense Amount",
      value:
        entry.credit_debit === "debit"
          ? formatCurrency(Number(entry.expense_amount ?? 0))
          : "—",
    },
    {
      label: "Paid",
      value:
        entry.credit_debit === "debit" ? (entry.paid ? "Yes" : "No") : "—",
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

export function mapLedgerTableRow(
  entry: LedgerEntry,
  invoicedPoKeys?: Set<string>
) {
  return {
    client: entry.clients?.name ?? "—",
    date: formatDate(entry.entry_date),
    description: entry.description?.trim() || "—",
    retailPrice: formatCurrency(Number(entry.retail_price ?? 0)),
    qty: formatQuantity(Number(entry.quantity)),
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
    expense: entry.credit_debit === "debit" ? (entry.expense ? "Yes" : "No") : "—",
    expenseAmount:
      entry.credit_debit === "debit"
        ? formatCurrency(Number(entry.expense_amount ?? 0))
        : "—",
    paid: entry.credit_debit === "debit" ? (entry.paid ? "Yes" : "No") : "—",
    purchaser: entry.purchaser,
    paidTo: entry.credit_debit === "debit" ? (entry.paid_to ?? "—") : "—",
    datePaid:
      entry.credit_debit === "debit" && entry.date_paid
        ? formatDate(entry.date_paid)
        : "—",
    designerCost: formatCurrency(Number(entry.designer_cost)),
    totalDesignerCost: formatCurrency(getLedgerTotalDesignerCost(entry)),
    grossProfit: formatCurrency(ledgerLineGrossProfit(entry, invoicedPoKeys)),
    netProfit: formatCurrency(ledgerLineNetProfit(entry, invoicedPoKeys)),
    po: entry.po_number ?? "—",
    type: `${entry.credit_debit} / ${entry.wholesale_retail}`,
    salesUseTaxPaid: entry.sales_and_use_tax_paid ? "Yes" : "No",
  };
}

/** Footer row with gross and net profit totals for visible ledger entries. */
export function ledgerProfitFooterRow(
  entries: LedgerEntry[],
  invoicedPoKeys?: Set<string>
) {
  const { grossProfit, netProfit } = computePlTotals(entries, invoicedPoKeys);
  return {
    actions: "",
    client: "Totals",
    grossProfit: formatCurrency(grossProfit),
    netProfit: formatCurrency(netProfit),
  };
}

/** Column header totals for goods and services (numeric fields only). */
export function ledgerDebitColumnTotals(
  entries: LedgerEntry[],
  invoicedPoKeys?: Set<string>
): Record<string, string> {
  if (entries.length === 0) return {};

  let discountSum = 0;
  let retailPrice = 0;
  let retailPriceQty = 0;
  let customerPrice = 0;
  let tax = 0;
  let shipping = 0;
  let paymentFee = 0;
  let invoicedAmount = 0;
  let outstandingBalance = 0;
  let paidAmount = 0;
  let expenseAmount = 0;
  let designerCost = 0;
  let totalDesignerCost = 0;

  for (const entry of entries) {
    discountSum += Number(entry.discount_percent);
    retailPrice += Number(entry.retail_price ?? 0);
    retailPriceQty += getLedgerRetailSubtotal(entry);
    customerPrice += getLedgerCustomerPrice(entry);
    if (entry.wholesale_retail === "wholesale") {
      tax += Number(entry.tax_amount);
    }
    shipping += Number(entry.shipping_receiving_amount ?? 0);
    paymentFee += Number(entry.payment_fee ?? 0);
    invoicedAmount += getLedgerInvoicedAmount(entry);
    outstandingBalance += getLedgerOutstandingBalance(entry);
    paidAmount += Number(entry.payment_amount ?? 0);
    expenseAmount += Number(entry.expense_amount ?? 0);
    designerCost += Number(entry.designer_cost);
    totalDesignerCost += getLedgerTotalDesignerCost(entry);
  }

  const { grossProfit, netProfit } = computePlTotals(entries, invoicedPoKeys);
  const avgDiscount = discountSum / entries.length;

  return {
    discount: formatPercent(avgDiscount),
    retailPrice: formatCurrency(roundMoney(retailPrice)),
    retailPriceQty: formatCurrency(roundMoney(retailPriceQty)),
    customerPrice: formatCurrency(roundMoney(customerPrice)),
    tax: formatCurrency(roundMoney(tax)),
    shipping: formatCurrency(roundMoney(shipping)),
    paymentFee: formatCurrency(roundMoney(paymentFee)),
    invoicedAmount: formatCurrency(roundMoney(invoicedAmount)),
    outstandingBalance: formatCurrency(roundMoney(outstandingBalance)),
    paidAmount: formatCurrency(roundMoney(paidAmount)),
    expenseAmount: formatCurrency(roundMoney(expenseAmount)),
    designerCost: formatCurrency(roundMoney(designerCost)),
    totalDesignerCost: formatCurrency(roundMoney(totalDesignerCost)),
    grossProfit: formatCurrency(grossProfit),
    netProfit: formatCurrency(netProfit),
  };
}

/** Debits table: retail price columns after total designer cost. */
export const ledgerDebitColumns = [
  { key: "client", label: "Client" },
  { key: "date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "qty", label: "Qty", className: "w-14 max-w-14 whitespace-nowrap px-2" },
  { key: "discount", label: "Discount %" },
  { key: "customerPrice", label: "Customer Price × Qty" },
  { key: "tax", label: "Tax" },
  { key: "shipping", label: "Shipping" },
  { key: "paymentFee", label: "Pmt Fee", className: "w-24 max-w-24 whitespace-nowrap px-2" },
  { key: "invoicedAmount", label: "Invoiced Amount" },
  { key: "outstandingBalance", label: "Outstanding Balance" },
  { key: "invoiced", label: "Invoiced" },
  { key: "invoiceId", label: "Invoice ID" },
  { key: "paidAmount", label: "Paid Amount" },
  { key: "grossProfit", label: "Gross Profit" },
  { key: "netProfit", label: "Net Profit" },
  { key: "expense", label: "Expense" },
  { key: "expenseAmount", label: "Expense Amount" },
  { key: "paid", label: "Paid" },
  { key: "purchaser", label: "Purchaser" },
  { key: "paidTo", label: "Paid To" },
  { key: "datePaid", label: "Date Paid" },
  { key: "designerCost", label: "Designer Cost" },
  { key: "totalDesignerCost", label: "Total Designer Cost" },
  { key: "retailPrice", label: "Retail Price" },
  { key: "retailPriceQty", label: "Retail Price × Qty" },
  { key: "po", label: "PO" },
  { key: "type", label: "Type" },
  { key: "salesUseTaxPaid", label: "Sales and Use Tax Paid" },
] as const;

function csvEscape(value: string | number | null | undefined): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** CSV for goods and services rows, including calculated gross/net profit and a totals row. */
export function buildGoodsAndServicesLedgerCsv(
  entries: LedgerEntry[],
  invoicedPoKeys?: Set<string>
): string {
  const columns = ledgerDebitColumns;
  const lines = [columns.map((column) => csvEscape(column.label)).join(",")];

  for (const entry of entries) {
    const row = mapLedgerTableRow(entry, invoicedPoKeys);
    lines.push(
      columns
        .map((column) => csvEscape(row[column.key as keyof typeof row] as string))
        .join(",")
    );
  }

  if (entries.length > 0) {
    const totals = ledgerDebitColumnTotals(entries, invoicedPoKeys);
    lines.push(
      columns
        .map((column) => {
          if (column.key === "client") return csvEscape("Totals");
          const total = totals[column.key];
          return total ? csvEscape(total) : "";
        })
        .join(",")
    );
  }

  return `\uFEFF${lines.join("\r\n")}`;
}

export function downloadGoodsAndServicesLedgerCsv(
  entries: LedgerEntry[],
  invoicedPoKeys?: Set<string>
) {
  const csv = buildGoodsAndServicesLedgerCsv(entries, invoicedPoKeys);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `ledger-goods-and-services-${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export const ledgerDetailColumns = [
  { key: "client", label: "Client" },
  { key: "date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "retailPrice", label: "Retail Price" },
  { key: "qty", label: "Qty", className: "w-14 max-w-14 whitespace-nowrap px-2" },
  { key: "retailPriceQty", label: "Retail Price × Qty" },
  { key: "discount", label: "Discount %" },
  { key: "customerPrice", label: "Customer Price × Qty" },
  { key: "tax", label: "Tax" },
  { key: "shipping", label: "Shipping" },
  { key: "paymentFee", label: "Pmt Fee", className: "w-24 max-w-24 whitespace-nowrap px-2" },
  { key: "invoicedAmount", label: "Invoiced Amount" },
  { key: "outstandingBalance", label: "Outstanding Balance" },
  { key: "invoiced", label: "Invoiced" },
  { key: "invoiceId", label: "Invoice ID" },
  { key: "paidAmount", label: "Paid Amount" },
  { key: "grossProfit", label: "Gross Profit" },
  { key: "netProfit", label: "Net Profit" },
  { key: "expense", label: "Expense" },
  { key: "expenseAmount", label: "Expense Amount" },
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
