"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  cashflowClassificationFlags,
  isCashflowManagedEntry,
  isCashflowOperatingCoa,
  isInvoiceGoodsLine,
  isPersonalCardReimbursementCoa,
} from "@/lib/coa";
import { isCostCompanionRow, COST_COMPANION_KINDS } from "@/lib/cost-companions";
import {
  CASHFLOW_ACCOUNTS,
  type CashflowAccount,
  type ChartOfAccount,
  type LedgerEntry,
  type Purchaser,
} from "@/lib/types";
import { accountMoveFields, isCheckingAccount, personalCardRoleFields } from "@/lib/account-move";
import { syncCardReimburseMate } from "@/lib/card-reimbursement";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/FormFields";
import { formatCurrency, formatDate, roundMoney } from "@/lib/utils";
import { normalizeInvoiceId } from "@/lib/invoice-utils";

interface LedgerAccountFormProps {
  /** One or more ledger rows to assign the same account (e.g. Sales Income rollup). */
  entries: LedgerEntry[];
  chartOfAccounts?: ChartOfAccount[];
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

function sharedPurchaser(entries: LedgerEntry[]): Purchaser | "" {
  const purchasers = [
    ...new Set(
      entries
        .map((entry) => entry.purchaser)
        .filter(
          (value): value is Purchaser => value === "Jess" || value === "Molly"
        )
    ),
  ];
  return purchasers.length === 1 ? purchasers[0] : "";
}

function canEditEntryCoa(entry: LedgerEntry) {
  if (entry.source_ledger_id) return false;
  if (isCashflowManagedEntry(entry)) return true;
  return isCashflowOperatingCoa(entry.coa_category);
}

function sharedCoaCategory(entries: LedgerEntry[]): string {
  const categories = [
    ...new Set(
      entries
        .map((entry) => (entry.coa_category ?? "").trim())
        .filter(Boolean)
    ),
  ];
  return categories.length === 1 ? categories[0] : "";
}

export function LedgerAccountForm({
  entries,
  chartOfAccounts = [],
  onSuccess,
  onCancel,
}: LedgerAccountFormProps) {
  const canEditCoa = entries.length > 0 && entries.every(canEditEntryCoa);
  const canEditPurchaser =
    entries.length > 0 &&
    entries.every(
      (entry) => isInvoiceGoodsLine(entry) || isCostCompanionRow(entry)
    );
  const [account, setAccount] = useState<string>(() => sharedAccount(entries));
  const [purchaser, setPurchaser] = useState<Purchaser | "">(() =>
    canEditPurchaser ? sharedPurchaser(entries) : ""
  );
  const [coaCategory, setCoaCategory] = useState<string>(() =>
    canEditCoa ? sharedCoaCategory(entries) : ""
  );
  const [nextInvoiceId, setNextInvoiceId] = useState<string>(
    () => normalizeInvoiceId(entries.length === 1 ? entries[0]?.invoice_id : "")
  );
  const [invoiceOptions, setInvoiceOptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("invoicing")
      .select("invoice_id")
      .not("invoice_id", "is", null)
      .then(({ data }) => {
        const ids = [
          ...new Set(
            (data ?? [])
              .map((row) => normalizeInvoiceId(row.invoice_id))
              .filter(Boolean)
          ),
        ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const current = normalizeInvoiceId(entries[0]?.invoice_id);
        if (current && !ids.includes(current)) ids.unshift(current);
        setInvoiceOptions(ids);
      });
  }, [entries]);

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
      : invoiceId
        ? `Invoice ${invoiceId} (${entries.length} rows)`
        : primary.description?.trim() || `${entries.length} cashflow entries`;

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
    if (canEditCoa && chartOfAccounts.length > 0 && !coaCategory) {
      setError("Select a CoA category");
      return;
    }
    if (canEditPurchaser && purchaser !== "Jess" && purchaser !== "Molly") {
      setError("Select a purchaser");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const nextAccount = account as CashflowAccount;
    for (const entry of entries) {
      const move = accountMoveFields(entry, nextAccount);
      const payload: Record<string, unknown> = {
        account: move.account,
        moved_from_account: move.moved_from_account,
        ...personalCardRoleFields(entry, nextAccount),
      };
      if (isCheckingAccount(move.account)) {
        payload.reimbursed_by_ledger_id = null;
      }
      if (canEditPurchaser && (purchaser === "Jess" || purchaser === "Molly")) {
        payload.purchaser = purchaser;
      }
      if (canEditCoa && coaCategory) {
        payload.coa_category = coaCategory;
        const flags = cashflowClassificationFlags(coaCategory);
        payload.expense = flags.expense;
        payload.balance_sheet = flags.balance_sheet;
        payload.income_statement = flags.income_statement;
      }
      payload.invoice_id = nextInvoiceId.trim() || null;
      const { error: dbError } = await supabase
        .from("ledger")
        .update(payload)
        .eq("id", entry.id);
      if (dbError) {
        setSaving(false);
        setError(dbError.message);
        return;
      }
      if (canEditCoa && isPersonalCardReimbursementCoa(coaCategory)) {
        const mateError = await syncCardReimburseMate(supabase, {
          ...entry,
          ...payload,
          coa_category: coaCategory,
        } as LedgerEntry);
        if (mateError) {
          setSaving(false);
          setError(mateError);
          return;
        }
      }
    }
    if (canEditPurchaser && (purchaser === "Jess" || purchaser === "Molly")) {
      const parentIds = [
        ...new Set(
          entries
            .map((entry) =>
              entry.source_ledger_id ||
              (isInvoiceGoodsLine(entry) ? entry.id : null)
            )
            .filter((id): id is string => Boolean(id))
        ),
      ];
      for (const parentId of parentIds) {
        const { error: parentError } = await supabase
          .from("ledger")
          .update({ purchaser })
          .eq("id", parentId);
        if (parentError) {
          setSaving(false);
          setError(parentError.message);
          return;
        }
        const { error: companionError } = await supabase
          .from("ledger")
          .update({ purchaser })
          .eq("source_ledger_id", parentId)
          .in("companion_kind", [...COST_COMPANION_KINDS]);
        if (companionError) {
          setSaving(false);
          setError(companionError.message);
          return;
        }
      }
    }
    setSaving(false);
    onSuccess();
  }

  async function handleDelete() {
    if (entries.length !== 1 || !primary) return;
    const label = description;
    if (
      !confirm(
        `Delete this charge?\n${label}\n\nRelated tax/shipping/fee rows on this charge are also deleted. This cannot be undone.`
      )
    ) {
      return;
    }
    setError(null);
    setDeleting(true);
    const supabase = createClient();
    const { error: companionError } = await supabase
      .from("ledger")
      .delete()
      .eq("source_ledger_id", primary.id);
    if (companionError) {
      setDeleting(false);
      setError(companionError.message);
      return;
    }
    const { error: dbError } = await supabase
      .from("ledger")
      .delete()
      .eq("id", primary.id);
    setDeleting(false);
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
      <h2 className="text-lg font-semibold text-slate-900">
        {canEditCoa && canEditPurchaser
          ? "Edit Account, Purchaser & CoA"
          : canEditCoa
            ? "Edit Account & CoA Category"
            : canEditPurchaser
              ? "Edit Account & Purchaser"
              : "Assign Account"}
      </h2>
      <p className="text-sm text-slate-600">
        {canEditCoa
          ? "Change the bank account and CoA category (for example 302 owner's draw vs 308 personal-card refund)."
          : canEditPurchaser
            ? "Change who purchased this line. Shipping and payment-fee companions stay with the same purchaser."
          : "Change the account. Moving Checking → Credit Card stamps the original checking account so you can review relocated personal-card charges."}
        {canEditPurchaser && canEditCoa
          ? " Purchaser can be changed here too."
          : ""}
        {entries.length > 1
          ? ` This updates all ${entries.length} rows in this group.`
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

      {canEditPurchaser ? (
        <SelectField
          label="Purchaser"
          required
          value={purchaser}
          onChange={(event) => {
            const value = event.target.value;
            setPurchaser(value === "Molly" || value === "Jess" ? value : "");
          }}
        >
          {sharedPurchaser(entries) ? null : (
            <option value="">Multiple — select a purchaser</option>
          )}
          <option value="Jess">Jess</option>
          <option value="Molly">Molly</option>
        </SelectField>
      ) : null}

      {canEditCoa ? (
        <SelectField
          label="CoA Category"
          required
          value={coaCategory}
          onChange={(event) => setCoaCategory(event.target.value)}
          hint={
            chartOfAccounts.length === 0
              ? "Add categories on the Chart of Accounts page first."
              : undefined
          }
        >
          <option value="">
            {sharedCoaCategory(entries) ? "Select category..." : "Multiple — select a category"}
          </option>
          {chartOfAccounts.map((entry) => (
            <option key={entry.id} value={entry.category}>
              {entry.category}
            </option>
          ))}
        </SelectField>
      ) : null}

      <SelectField
        label="Invoice"
        value={nextInvoiceId}
        onChange={(event) => setNextInvoiceId(event.target.value)}
        hint="Optional. Attach or remove this row from a sales invoice (for example MJ-WD-202608-1)."
      >
        <option value="">None — not on an invoice</option>
        {invoiceOptions.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </SelectField>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving || deleting}>
          {saving
            ? "Saving..."
            : canEditCoa
              ? "Save"
              : canEditPurchaser
                ? "Save"
                : "Save Account"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={saving || deleting}
        >
          Cancel
        </Button>
        {entries.length === 1 ? (
          <Button
            type="button"
            variant="danger"
            onClick={() => void handleDelete()}
            disabled={saving || deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
