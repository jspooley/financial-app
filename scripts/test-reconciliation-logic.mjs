/**
 * Sanity check: per-line discrepancy sums to summary revenueMinusPayments.
 * Run: node scripts/test-reconciliation-logic.mjs
 */

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function getLedgerCustomerPrice(entry) {
  const qty = Math.max(0.01, Number(entry.quantity ?? 1));
  const discount = Number(entry.discount_percent ?? 0);
  const retailSubtotal = Number(entry.retail_price ?? 0) * qty;
  if (discount > 0) {
    return roundMoney(retailSubtotal * (1 - discount / 100));
  }
  const stored = roundMoney(Number(entry.customer_price ?? 0));
  return stored > 0 ? stored : roundMoney(retailSubtotal);
}

function getLedgerInvoicedAmount(entry) {
  const tax =
    entry.wholesale_retail === "wholesale" ? Number(entry.tax_amount ?? 0) : 0;
  const shipping = Number(entry.shipping_receiving_amount ?? 0) || 0;
  const fee = Number(entry.payment_fee ?? 0);
  return roundMoney(getLedgerCustomerPrice(entry) + tax + shipping + fee);
}

function getLedgerTotalPaymentReceived(entry) {
  return roundMoney(
    Number(entry.payment_amount ?? 0) + Number(entry.payment_fee ?? 0)
  );
}

function getLedgerOutstandingBalance(entry) {
  const owed = getLedgerInvoicedAmount(entry);
  const paid = getLedgerTotalPaymentReceived(entry);
  const expenseApplied = entry.expense
    ? roundMoney(Math.max(0, Number(entry.expense_amount ?? 0)))
    : 0;
  let balance = roundMoney(paid - owed);
  if (expenseApplied > 0) {
    if (balance < 0) balance = roundMoney(Math.min(0, balance + expenseApplied));
    else if (balance > 0) balance = roundMoney(Math.max(0, balance - expenseApplied));
  }
  return balance;
}

function getLedgerUnderpaymentAmount(entry) {
  const balance = getLedgerOutstandingBalance(entry);
  return balance < 0 ? roundMoney(-balance) : 0;
}

function isInvoicedDebitLine(entry) {
  return (
    entry.credit_debit === "debit" &&
    Boolean(entry.invoiced || entry.invoice_id)
  );
}

function ledgerLineAmount(entry) {
  return getLedgerInvoicedAmount(entry);
}

function ledgerLineAmountSettled(entry) {
  if (!isInvoicedDebitLine(entry)) return 0;
  return roundMoney(ledgerLineAmount(entry) - getLedgerUnderpaymentAmount(entry));
}

function lineDiscrepancy(entry) {
  const gap = roundMoney(
    Number(entry.payment_amount ?? 0) - ledgerLineAmountSettled(entry)
  );
  return gap < 0 ? gap : 0;
}

function lineOutstandingRevenue(entry) {
  const gap = roundMoney(ledgerLineAmount(entry) - Number(entry.payment_amount ?? 0));
  return gap > 0 ? gap : 0;
}

function sumPaymentsHistoryTotal(entries) {
  return roundMoney(
    entries
      .filter(isInvoicedDebitLine)
      .reduce((sum, entry) => sum + ledgerLineAmountSettled(entry), 0)
  );
}

function sumInvoicedDebitRevenue(entries) {
  return roundMoney(
    entries
      .filter(isInvoicedDebitLine)
      .reduce((sum, entry) => sum + Number(entry.payment_amount ?? 0), 0)
  );
}

const debits = [
  {
    id: "1",
    credit_debit: "debit",
    invoiced: true,
    invoice_id: "PO-1",
    retail_price: 100,
    quantity: 1,
    discount_percent: 0,
    tax_amount: 0,
    shipping_receiving_amount: 0,
    wholesale_retail: "retail",
    payment_amount: 97,
    payment_fee: 3,
    paid: true,
  },
  {
    id: "2",
    credit_debit: "credit",
    invoiced: true,
    invoice_id: "PO-1",
    retail_price: 0,
    quantity: 1,
    payment_amount: 500,
    payment_fee: 0,
    paid: false,
  },
  {
    id: "3",
    credit_debit: "debit",
    invoiced: true,
    invoice_id: "PO-2",
    retail_price: 200,
    quantity: 1,
    discount_percent: 0,
    tax_amount: 0,
    shipping_receiving_amount: 0,
    wholesale_retail: "retail",
    payment_amount: 50,
    payment_fee: 0,
    paid: false,
  },
  {
    id: "4",
    credit_debit: "debit",
    invoiced: true,
    invoice_id: "PO-3",
    retail_price: 100,
    quantity: 1,
    discount_percent: 0,
    tax_amount: 0,
    shipping_receiving_amount: 0,
    wholesale_retail: "retail",
    payment_amount: 150,
    payment_fee: 0,
    paid: true,
  },
];

const invoicedDebits = debits.filter(isInvoicedDebitLine);
const revenueTotal = sumInvoicedDebitRevenue(debits);
const paymentsTotal = sumPaymentsHistoryTotal(debits);
const rawGap = roundMoney(revenueTotal - paymentsTotal);
const summaryGap = roundMoney(
  invoicedDebits.reduce((sum, entry) => sum + lineDiscrepancy(entry), 0)
);
const lineGapSum = summaryGap;

const overpaid = invoicedDebits.find((e) => e.id === "4");
console.log("Overpaid line discrepancy:", lineDiscrepancy(overpaid), "(expected 0)");
console.log("Overpaid outstanding revenue:", lineOutstandingRevenue(overpaid), "(expected 0)");

console.log("Revenue (debits only):", revenueTotal);
console.log("Payments received:", paymentsTotal);
console.log("Raw revenue - payments (includes overpay):", rawGap);
console.log("Summary discrepancy (fees only):", summaryGap);
console.log("Sum of line discrepancies:", lineGapSum);
console.log(
  lineGapSum === summaryGap
    ? "PASS: line gaps match summary"
    : `FAIL: expected ${summaryGap}, got ${lineGapSum}`
);

const oldRevenue = debits
  .filter((e) => e.invoiced || e.invoice_id)
  .reduce((sum, e) => sum + Number(e.payment_amount ?? 0), 0);
console.log(
  "Old revenue (all invoiced lines incl. credits):",
  roundMoney(oldRevenue),
  "— would mismatch debits-only scope"
);
