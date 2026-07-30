"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import type { ChartOfAccount } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { InputField } from "@/components/ui/FormFields";

const schema = z.object({
  category: z.string().trim().min(1, "Category is required"),
});

type FormValues = z.infer<typeof schema>;

interface ChartOfAccountFormProps {
  initial?: ChartOfAccount | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ChartOfAccountForm({
  initial,
  onSuccess,
  onCancel,
}: ChartOfAccountFormProps) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      category: initial?.category ?? "",
    },
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    const supabase = createClient();
    const payload = {
      category: values.category.trim(),
    };

    const { error: dbError } = initial
      ? await supabase
          .from("chart_of_accounts")
          .update(payload)
          .eq("id", initial.id)
      : await supabase.from("chart_of_accounts").insert(payload);

    if (dbError) {
      if (dbError.code === "23505") {
        setError("That category already exists.");
        return;
      }
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
        {initial ? "Edit Chart of Accounts Entry" : "New Chart of Accounts Entry"}
      </h2>

      <InputField
        label="Category"
        required
        hint="Example: 212 Supplies"
        error={errors.category?.message}
        {...register("category")}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={isSubmitting}>
          {initial ? "Save Changes" : "Create Entry"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
