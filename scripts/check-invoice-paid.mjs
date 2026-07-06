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

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(url, key);
const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["MJ-CK-2604-1-1", "MJ-MB-20262-4", "MJ-JM-20264-1"];

for (const id of ids) {
  const { data, error } = await supabase
    .from("ledger")
    .select("*")
    .eq("invoice_id", id);

  console.log(`\n=== ${id} ===`);
  if (error) {
    console.log("error:", error.message);
    continue;
  }
  console.log(`ledger rows: ${data?.length ?? 0}`);
  const debits = (data ?? []).filter((r) => r.credit_debit === "debit");
  console.log(`debits: ${debits.length}`);
  for (const r of data ?? []) {
    const invoiced = getLedgerInvoicedAmount(r);
    const received = getLedgerTotalPaymentReceived(r);
    const balance = getLedgerOutstandingBalance(r);
  console.log({
      id: r.id,
      credit_debit: r.credit_debit,
      paid: r.paid,
      invoiced,
      received,
      balance,
      balancePaid: balance >= 0,
      description: (r.description ?? "").slice(0, 50),
    });
  }

  const allDebitsPaid =
    debits.length > 0 &&
    debits.every((r) => getLedgerOutstandingBalance(r) >= 0);
  console.log("isInvoicePaidByBalance:", allDebitsPaid);

  const { data: inv } = await supabase
    .from("invoicing")
    .select("invoice_id, po_number")
    .eq("invoice_id", id);
  console.log("invoicing rows:", inv?.length ?? 0, inv);
}
