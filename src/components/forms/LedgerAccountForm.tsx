"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CASHFLOW_ACCOUNTS,
  type CashflowAccount,
  type LedgerEntry,
} from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/FormFields";
import { formatCurrency, formatDate, roundMoney } from "@/lib/utils";
import { normalizeInvoiceId } from "@/lib/invoice-utils";

interface LedgerAccountFormProps {
  /** One or more ledger rows to assign the same account (e.g. Sales Income rollup). */
  entries: LedgerEntry[];
  onSuccess: () => void;
  onCancel: () => void;
}

function sharedAccount(entries: LedgerEntry[]): string {
  const accounts = [
    ...new Set(
      entries
        .map((entry) => entry.account)
        .filter(
          (account): account is CashflowAccount =>
            typeof account === "string" &&
            (CASHFLOW_ACCOUNTS as readonly string[]).includes(account)
        )
    ),
  ];
  return accounts.length === 1 ? accounts[0] : "";
}

export function LedgerAccountForm({
  entries,
  onSuccess,
  onCancel,
}: LedgerAccountFormProps) {
  const [account, setAccount] = useState<string>(() => sharedAccount(entries));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const primary = entries[0];
  const invoiceId = normalizeInvoiceId(primary?.invoice_id);
  const paymentTotal = roundMoney(
    entries.reduce((sum, entry) => sum + Number(entry.payment_amount ?? 0), 0)
  );
  const datePaid =
    entries
      .map((entry) => entry.date_paid)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => b.localeCompare(a))[0] ?? null;
  const description =
    entries.length === 1
      ? primary.description?.trim() || primary.clients?.name || "—"
      : `Invoice ${invoiceId || "—"} payments (${entries.length})`;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!(CASHFLOW_ACCOUNTS as readonly string[]).includes(account)) {
      setError("Select an account");
      return;
    }
    if (entries.length === 0) {
      setError("No entries to update");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("ledger")
      .update({ account: account as CashflowAccount })
      .in(
        "id",
        entries.map((entry) => entry.id)
      );
    setSaving(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    onSuccess();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <h2 className="text-lg font-semibold text-slate-900">Assign Account</h2>
      <p className="text-sm text-slate-600">
        Only the account can be changed here. Edit other fields on the Ledger
        page.
        {entries.length > 1
          ? ` This updates all ${entries.length} Sales Income payment rows for this invoice.`
          : ""}
      </p>

      <dl className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            Date Paid
          </dt>
          <dd className="font-medium text-slate-900">
            {datePaid ? formatDate(datePaid) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            Invoice ID
          </dt>
          <dd className="font-medium text-slate-900">{invoiceId || "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            Description
          </dt>
          <dd className="font-medium text-slate-900">{description}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            Payment Amount
          </dt>
          <dd className="font-medium text-slate-900">
            {paymentTotal > 0 ? formatCurrency(paymentTotal) : "—"}
          </dd>
        </div>
      </dl>

      <SelectField
        label="Account"
        required
        value={account}
        onChange={(event) => setAccount(event.target.value)}
      >
        <option value="">Select Account</option>
        {CASHFLOW_ACCOUNTS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </SelectField>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Account"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
