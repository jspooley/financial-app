"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import {
  CASHFLOW_ACCOUNTS,
  CASHFLOW_DEPARTMENTS,
  CASHFLOW_EXPENSE_TYPES,
  type CashflowEntry,
  type Purchaser,
} from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { InputField, SelectField, TextareaField } from "@/components/ui/FormFields";
import { checkingAccountForPurchaser, formatMoneyInput, roundMoney } from "@/lib/utils";

const schema = z
  .object({
    entry_date: z.string().min(1, "Date is required"),
    department: z.enum(CASHFLOW_DEPARTMENTS),
    expense_type: z.enum(CASHFLOW_EXPENSE_TYPES),
    description: z.string().optional(),
    debit_amount: z.coerce.number().min(0, "Debit must be 0 or greater"),
    credit_amount: z.coerce.number().min(0, "Credit must be 0 or greater"),
    account: z.enum(CASHFLOW_ACCOUNTS),
    designer: z.enum(["Jess", "Molly"]),
  })
  .refine((values) => values.debit_amount > 0 || values.credit_amount > 0, {
    message: "Enter a debit amount, credit amount, or both",
    path: ["debit_amount"],
  });

type FormValues = z.infer<typeof schema>;

interface CashflowFormProps {
  initial?: CashflowEntry | null;
  defaultDesigner?: Purchaser;
  onSuccess: () => void;
  onCancel: () => void;
}

function expenseTypeLabel(value: string) {
  if (value === "tax & License") return "Tax & License";
  if (value === "COGS") return "COGS";
  if (
    value === "Issuing Debt" ||
    value === "Repaying Debt" ||
    value === "Accounts Receivable"
  ) {
    return value;
  }
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function CashflowForm({
  initial,
  defaultDesigner = "Jess",
  onSuccess,
  onCancel,
}: CashflowFormProps) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      entry_date: initial?.entry_date ?? new Date().toISOString().slice(0, 10),
      department: initial?.department ?? "Interior Design",
      expense_type: initial?.expense_type ?? "admin",
      description: initial?.description ?? "",
      debit_amount: initial?.debit_amount ?? 0,
      credit_amount: initial?.credit_amount ?? 0,
      account: initial?.account ?? checkingAccountForPurchaser(defaultDesigner),
      designer: initial?.designer ?? defaultDesigner,
    },
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    const supabase = createClient();
    const payload = {
      entry_date: values.entry_date,
      department: values.department,
      expense_type: values.expense_type,
      description: values.description?.trim() || null,
      debit_amount: roundMoney(values.debit_amount),
      credit_amount: roundMoney(values.credit_amount),
      account: values.account,
      designer: values.designer,
    };

    const { error: dbError } = initial
      ? await supabase.from("cashflow").update(payload).eq("id", initial.id)
      : await supabase.from("cashflow").insert(payload);

    if (dbError) {
      setError(dbError.message);
      return;
    }

    onSuccess();
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
          {CASHFLOW_DEPARTMENTS.map((department) => (
            <option key={department} value={department}>
              {department}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Expense Type"
          required
          error={errors.expense_type?.message}
          {...register("expense_type")}
        >
          {CASHFLOW_EXPENSE_TYPES.map((expenseType) => (
            <option key={expenseType} value={expenseType}>
              {expenseTypeLabel(expenseType)}
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
        <div className="hidden sm:block" aria-hidden />
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
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : initial ? "Save Changes" : "Add Entry"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
