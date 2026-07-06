// Quick sanity check for isInvoiceFullyPaid logic (mirrors invoice-utils.ts)
function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function getLedgerCustomerPrice(entry) {
  const qty = Math.max(0.01, Number(entry.quantity ?? 1));
  const stored = roundMoney(Number(entry.customer_price ?? 0));
  if (stored > 0) return stored;
  return roundMoney(Number(entry.retail_price ?? 0) * qty);
}

function getLedgerInvoicedAmount(entry) {
  const tax = entry.wholesale_retail === "wholesale" ? Number(entry.tax_amount ?? 0) : 0;
  const shipping = Number(entry.shipping_receiving_amount ?? 0) || 0;
  const fee = Number(entry.payment_fee ?? 0);
  return roundMoney(getLedgerCustomerPrice(entry) + tax + shipping + fee);
}

function getLedgerTotalPaymentReceived(entry) {
  const amount = roundMoney(Number(entry.payment_amount ?? 0));
  const fee = roundMoney(Number(entry.payment_fee ?? 0));
  if (fee <= 0) return amount;
  const invoiced = getLedgerInvoicedAmount(entry);
  const combined = roundMoney(amount + fee);
  if (combined <= invoiced + 0.009) return combined;
  return amount;
}

function getLedgerOutstandingBalance(entry) {
  const invoiced = getLedgerInvoicedAmount(entry);
  const paid = getLedgerTotalPaymentReceived(entry);
  const expenseApplied = entry.expense
    ? roundMoney(Math.max(0, Number(entry.expense_amount ?? 0)))
    : 0;
  let balance = roundMoney(paid - invoiced);
  if (expenseApplied > 0 && balance < 0) {
    balance = roundMoney(Math.min(0, balance + expenseApplied));
  }
  return balance;
}

function isLedgerLineFullyPaid(entry) {
  return getLedgerOutstandingBalance(entry) >= 0;
}

function isLedgerLineInvoiced(line) {
  return Boolean(line.invoiced || line.invoice_id);
}

function invoiceBillableLines(lines) {
  return lines.filter(
    (line) => line.credit_debit !== "credit" && isLedgerLineInvoiced(line)
  );
}

function isInvoiceFullyPaid(lines) {
  const billable = invoiceBillableLines(lines);
  if (billable.length === 0) return false;
  return billable.every((line) => isLedgerLineFullyPaid(line));
}

// Scenario: paid via payment_amount, paid flag false
const line1 = {
  credit_debit: "debit",
  invoiced: true,
  invoice_id: "MJ-CK-20264-1",
  paid: false,
  retail_price: 1000,
  quantity: 1,
  customer_price: 1000,
  tax_amount: 61.61,
  shipping_receiving_amount: 0,
  wholesale_retail: "retail",
  payment_amount: 1061.61,
  payment_fee: 0,
};
console.log("line1 balance", getLedgerOutstandingBalance(line1), "fullyPaid", isLedgerLineFullyPaid(line1));
console.log("invoice paid", isInvoiceFullyPaid([line1]));

// Scenario: credit line on same invoice
const credit = {
  credit_debit: "credit",
  invoiced: true,
  invoice_id: "MJ-CK-20264-1",
  retail_price: 1061.61,
  quantity: 1,
  customer_price: 1061.61,
  payment_amount: 0,
};
const debitUnpaid = { ...line1, payment_amount: 0, paid: false };
console.log("debit+credit invoice paid", isInvoiceFullyPaid([debitUnpaid, credit]));

// Scenario: only credit lines
console.log("credit-only invoice paid", isInvoiceFullyPaid([credit]));
