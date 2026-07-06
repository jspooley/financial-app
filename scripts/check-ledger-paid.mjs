import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  const path = resolve(process.cwd(), ".env.local");
  const text = readFileSync(path, "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function getLedgerCustomerPrice(entry) {
  const discountPercent = Number(entry.discount_percent ?? 0);
  const qty = Math.max(0.01, roundMoney(Number(entry.quantity ?? 1)) || 1);
  if (discountPercent > 0) {
    const retail = Number(entry.retail_price ?? 0);
    return roundMoney(retail * qty * (1 - discountPercent / 100));
  }
  const stored = roundMoney(Number(entry.customer_price ?? 0));
  if (stored > 0) return stored;
  return roundMoney(Number(entry.retail_price ?? 0) * qty);
}

function getLedgerInvoicedAmount(entry) {
  const tax =
    entry.wholesale_retail === "wholesale" ? Number(entry.tax_amount ?? 0) : 0;
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
  if (expenseApplied > 0) {
    if (balance < 0) balance = roundMoney(Math.min(0, balance + expenseApplied));
    else if (balance > 0) balance = roundMoney(Math.max(0, balance - expenseApplied));
  }
  return balance;
}

function isFullyPaid(entry) {
  return getLedgerOutstandingBalance(entry) >= 0;
}

function isInvoiced(entry) {
  return Boolean(entry.invoiced || entry.invoice_id);
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error("Missing Supabase env vars in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key);

const { data, error } = await supabase
  .from("ledger")
  .select("*, clients(name)")
  .order("entry_date", { ascending: false });

if (error) {
  console.error(error.message);
  process.exit(1);
}

const entries = (data ?? []).map((row) => ({
  ...row,
  quantity: Number(row.quantity ?? 1),
  retail_price: Number(row.retail_price ?? 0),
  designer_cost: Number(row.designer_cost ?? 0),
  discount_percent: Number(row.discount_percent ?? 0),
  tax_amount: Number(row.tax_amount ?? 0),
  shipping_receiving_amount: Number(row.shipping_receiving_amount ?? 0),
  payment_amount: Number(row.payment_amount ?? 0),
  payment_fee: Number(row.payment_fee ?? 0),
  expense_amount: Number(row.expense_amount ?? 0),
}));

const debits = entries.filter((e) => e.credit_debit === "debit");
const credits = entries.filter((e) => e.credit_debit === "credit");

const notFullyPaidDebits = debits.filter((e) => !isFullyPaid(e));
const notFullyPaidCredits = credits.filter((e) => !isFullyPaid(e));
const uninvoicedDebits = debits.filter((e) => !isInvoiced(e));
const uninvoicedCredits = credits.filter((e) => !isInvoiced(e));
const invoicedNotFullyPaidDebits = debits.filter(
  (e) => isInvoiced(e) && !isFullyPaid(e)
);

console.log("=== Ledger payment status ===");
console.log(`Total lines: ${entries.length} (${debits.length} debits, ${credits.length} credits)`);
console.log(`Debit lines NOT fully paid (balance < 0): ${notFullyPaidDebits.length}`);
console.log(`Credit lines NOT fully paid: ${notFullyPaidCredits.length}`);
console.log(`Uninvoiced debits: ${uninvoicedDebits.length}`);
console.log(`Uninvoiced credits: ${uninvoicedCredits.length}`);
console.log(`Invoiced debits NOT fully paid: ${invoicedNotFullyPaidDebits.length}`);
console.log("");

function printLine(entry) {
  const invoiced = getLedgerInvoicedAmount(entry);
  const received = getLedgerTotalPaymentReceived(entry);
  const balance = getLedgerOutstandingBalance(entry);
  const client = entry.clients?.name ?? entry.client_id ?? "—";
  console.log(
    [
      entry.entry_date,
      entry.credit_debit,
      client,
      entry.po_number ?? "—",
      entry.invoice_id ?? "—",
      (entry.description ?? "").slice(0, 40),
      `invoiced=${invoiced.toFixed(2)}`,
      `received=${received.toFixed(2)}`,
      `balance=${balance.toFixed(2)}`,
      `paid_flag=${entry.paid ? "Y" : "N"}`,
      `invoiced_flag=${entry.invoiced ? "Y" : "N"}`,
    ].join(" | ")
  );
}

if (notFullyPaidDebits.length > 0) {
  console.log("--- Debits NOT fully paid ---");
  notFullyPaidDebits.forEach(printLine);
  console.log("");
}

if (invoicedNotFullyPaidDebits.length > 0) {
  console.log("--- Invoiced debits NOT fully paid ---");
  invoicedNotFullyPaidDebits.forEach(printLine);
  console.log("");
}

if (notFullyPaidCredits.length > 0) {
  console.log("--- Credits NOT fully paid (Paid column shows — for credits) ---");
  notFullyPaidCredits.forEach(printLine);
  console.log("");
}

if (uninvoicedDebits.length > 0) {
  console.log("--- Uninvoiced debits ---");
  uninvoicedDebits.forEach(printLine);
  console.log("");
}

// Summary for totals mismatch
const invoicedDebits = debits.filter(isInvoiced);
const fullyPaidInvoicedDebits = invoicedDebits.filter(isFullyPaid);
const invoiceHistoryTotal = entries
  .filter((e) => e.invoice_id)
  .reduce((s, e) => s + getLedgerInvoicedAmount(e), 0);
const paymentHistoryTotal = fullyPaidInvoicedDebits.reduce(
  (s, e) => {
    const received = getLedgerTotalPaymentReceived(e);
    return s + (received > 0 ? received : getLedgerInvoicedAmount(e));
  },
  0
);
const invoicedDebitTotal = invoicedDebits.reduce(
  (s, e) => s + getLedgerInvoicedAmount(e),
  0
);
const fullyPaidInvoicedDebitInvoicedTotal = fullyPaidInvoicedDebits.reduce(
  (s, e) => s + getLedgerInvoicedAmount(e),
  0
);

console.log("=== Totals (debits only, invoiced) ===");
console.log(`All invoiced debit lines invoiced sum: ${roundMoney(invoicedDebitTotal).toFixed(2)}`);
console.log(
  `Fully paid invoiced debit lines invoiced sum: ${roundMoney(fullyPaidInvoicedDebitInvoicedTotal).toFixed(2)}`
);
console.log(`Payment history style total: ${roundMoney(paymentHistoryTotal).toFixed(2)}`);
console.log(`All lines with invoice_id invoiced sum: ${roundMoney(invoiceHistoryTotal).toFixed(2)}`);

const creditOnInvoices = entries.filter(
  (e) => e.credit_debit === "credit" && e.invoice_id
);
if (creditOnInvoices.length > 0) {
  console.log("");
  console.log(`--- Credit lines ON invoices (${creditOnInvoices.length}) ---`);
  creditOnInvoices.forEach(printLine);
  const creditInvoicedSum = creditOnInvoices.reduce(
    (s, e) => s + getLedgerInvoicedAmount(e),
    0
  );
  console.log(`Credit-on-invoice invoiced sum: ${roundMoney(creditInvoicedSum).toFixed(2)}`);
}
