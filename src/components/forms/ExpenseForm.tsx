"use client";

import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { isCashflowOperatingCoa, isCogsCoa, isOperatingExpenseCoa } from "@/lib/coa";
import {
  CASHFLOW_ACCOUNTS,
  CASHFLOW_DEPARTMENTS,
  type ChartOfAccount,
  type LedgerEntry,
  type Purchaser,
} from "@/lib/types";
import { Button } from "@/components/ui/Button";
import {
  CheckboxField,
  InputField,
  SelectField,
  TextareaField,
} from "@/components/ui/FormFields";
import { checkingAccountForPurchaser, formatMoneyInput, roundMoney } from "@/lib/utils";

const schema = z
  .object({
    entry_date: z.string().min(1, "Date is required"),
    department: z
      .string()
      .min(1, "Choose a department")
      .refine(
        (value): value is (typeof CASHFLOW_DEPARTMENTS)[number] =>
          (CASHFLOW_DEPARTMENTS as readonly string[]).includes(value),
        "Choose a department"
      ),
    description: z.string().optional(),
    debit_amount: z.coerce.number().min(0, "Debit must be 0 or greater"),
    credit_amount: z.coerce.number().min(0, "Credit must be 0 or greater"),
    account: z.enum(CASHFLOW_ACCOUNTS),
    designer: z.enum(["Jess", "Molly"]),
    coa_category: z.string().min(1, "Chart of Accounts category is required"),
    expense: z.boolean(),
    balance_sheet: z.boolean(),
  })
  .refine((values) => values.debit_amount > 0 || values.credit_amount > 0, {
    message: "Enter a debit amount, credit amount, or both",
    path: ["debit_amount"],
  });

type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

interface ExpenseFormProps {
  initial?: LedgerEntry | null;
  chartOfAccounts?: ChartOfAccount[];
  defaultDesigner?: Purchaser;
  onSuccess: () => void;
  onCancel: () => void;
  onDeleted?: () => void;
}

function defaultsForCoaCategory(coaCategory: string) {
  const isCogs = isCogsCoa(coaCategory);
  const isEquityOrTransfer = isCashflowOperatingCoa(coaCategory) && !isOperatingExpenseCoa(coaCategory);
  return {
    // Operating expenses (200-series) hit the P&L / register as cash out.
    // 300-series equity / transfers default to Balance Sheet (still shown on Cashflow).
    expense: !isCogs && !isEquityOrTransfer,
    balance_sheet: isEquityOrTransfer,
  };
}

export function ExpenseForm({
  initial,
  chartOfAccounts = [],
  defaultDesigner = "Jess",
  onSuccess,
  onCancel,
  onDeleted,
}: ExpenseFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const initialFlags = initial
    ? {
        expense: initial.expense,
        balance_sheet: initial.balance_sheet,
      }
    : { expense: true, balance_sheet: false };

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      entry_date: initial?.entry_date ?? new Date().toISOString().slice(0, 10),
      department: initial?.department ?? "",
      description: initial?.description ?? "",
      debit_amount: initial?.debit_amount ?? 0,
      credit_amount: initial?.credit_amount ?? 0,
      account: initial?.account ?? checkingAccountForPurchaser(defaultDesigner),
      designer: initial?.purchaser ?? defaultDesigner,
      coa_category: initial?.coa_category ?? "",
      expense: initialFlags.expense,
      balance_sheet: initialFlags.balance_sheet,
    },
  });

  const coaCategory = useWatch({ control, name: "coa_category" });
  /**
   * Defaults apply only when the category actually changes. Comparing against
   * the last seen value (rather than a one-shot flag) keeps an edit from having
   * its saved Expense / Balance Sheet flags overwritten on mount.
   */
  const lastCoaRef = useRef(initial?.coa_category ?? "");

  useEffect(() => {
    if (!coaCategory) return;
    if (coaCategory === lastCoaRef.current) return;
    lastCoaRef.current = coaCategory;
    const next = defaultsForCoaCategory(coaCategory);
    setValue("expense", next.expense, { shouldValidate: true });
    setValue("balance_sheet", next.balance_sheet, { shouldValidate: true });
  }, [coaCategory, setValue]);

  async function onSubmit(values: FormValues) {
    setError(null);
    const debit = roundMoney(values.debit_amount);
    const credit = roundMoney(values.credit_amount);
    const supabase = createClient();
    const payload = {
      entry_date: values.entry_date,
      department: values.department,
      // Classification is CoA Category; stop writing the duplicate expense_type.
      expense_type: null,
      description: values.description?.trim() || null,
      debit_amount: debit,
      credit_amount: credit,
      account: values.account,
      purchaser: values.designer,
      coa_category: values.coa_category,
      expense: values.expense,
      balance_sheet: values.balance_sheet,
      income_statement: !values.balance_sheet,
      credit_debit: debit >= credit ? ("debit" as const) : ("credit" as const),
      designer_cost: 0,
      quantity: 1,
      wholesale_retail: "retail" as const,
      trade_partner_id: null,
      discount_percent: 0,
      shipping_receiving_amount: 0,
      retail_price: 0,
      tax_amount: 0,
      client_id: null,
      po_number: null,
      expense_amount: 0,
    };

    const { error: dbError } = initial
      ? await supabase.from("ledger").update(payload).eq("id", initial.id)
      : await supabase.from("ledger").insert(payload);

    if (dbError) {
      setError(dbError.message);
      return;
    }

    onSuccess();
  }

  async function handleDelete() {
    if (!initial) return;
    const label = initial.description?.trim() || initial.entry_date;
    if (!confirm(`Delete cashflow entry "${label}"?`)) return;

    setError(null);
    setDeleting(true);
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("ledger")
      .delete()
      .eq("id", initial.id);
    setDeleting(false);

    if (dbError) {
      setError(dbError.message);
      return;
    }

    (onDeleted ?? onSuccess)();
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <h2 className="text-lg font-semibold text-slate-900">
        {initial ? "Edit Cashflow Entry" : "New Cashflow Entry"}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          label="Date"
          type="date"
          required
          error={errors.entry_date?.message}
          {...register("entry_date")}
        />
        <SelectField
          label="Designer"
          required
          error={errors.designer?.message}
          {...register("designer")}
        >
          <option value="Jess">Jess</option>
          <option value="Molly">Molly</option>
        </SelectField>
        <SelectField
          label="Department"
          required
          error={errors.department?.message}
          {...register("department")}
        >
          <option value="">Choose Department</option>
          {CASHFLOW_DEPARTMENTS.map((department) => (
            <option key={department} value={department}>
              {department}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Account"
          required
          error={errors.account?.message}
          {...register("account")}
        >
          {CASHFLOW_ACCOUNTS.map((account) => (
            <option key={account} value={account}>
              {account}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="CoA Category"
          required
          error={errors.coa_category?.message}
          hint={
            chartOfAccounts.length === 0
              ? "Add categories on the Chart of Accounts page first."
              : undefined
          }
          {...register("coa_category")}
        >
          <option value="">Select category...</option>
          {chartOfAccounts.map((entry) => (
            <option key={entry.id} value={entry.category}>
              {entry.category}
            </option>
          ))}
        </SelectField>
        <div className="flex flex-col justify-end gap-3 sm:flex-row sm:items-center sm:col-span-2">
          <CheckboxField label="Expense" {...register("expense")} />
          <CheckboxField label="Balance Sheet" {...register("balance_sheet")} />
        </div>
        <InputField
          label="Debit Amount"
          type="number"
          step="0.01"
          min="0"
          error={errors.debit_amount?.message}
          {...register("debit_amount", {
            setValueAs: (value) => {
              if (value === "" || value == null) return 0;
              return Number(value);
            },
          })}
          onFocus={(event) => {
            event.currentTarget.value = formatMoneyInput(
              Number(event.currentTarget.value) || 0
            );
          }}
        />
        <InputField
          label="Credit Amount"
          type="number"
          step="0.01"
          min="0"
          error={errors.credit_amount?.message}
          {...register("credit_amount", {
            setValueAs: (value) => {
              if (value === "" || value == null) return 0;
              return Number(value);
            },
          })}
          onFocus={(event) => {
            event.currentTarget.value = formatMoneyInput(
              Number(event.currentTarget.value) || 0
            );
          }}
        />
      </div>

      <TextareaField
        label="Description"
        rows={3}
        error={errors.description?.message}
        {...register("description")}
      />

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting || deleting}>
          {isSubmitting ? "Saving..." : initial ? "Save Changes" : "Add Entry"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={isSubmitting || deleting}
        >
          Cancel
        </Button>
        {initial && onDeleted && (
          <Button
            type="button"
            variant="danger"
            onClick={() => void handleDelete()}
            disabled={isSubmitting || deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        )}
      </div>
    </form>
  );
}
