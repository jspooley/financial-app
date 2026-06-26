"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import type { TradePartner } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { InputField } from "@/components/ui/FormFields";

const schema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  contact_name: z.string().optional(),
  contact_email: z.string().email("Invalid email").optional().or(z.literal("")),
  contact_phone: z.string().optional(),
  discount_amount: z.coerce
    .number()
    .min(0, "Discount must be 0 or greater")
    .max(100, "Discount cannot exceed 100%"),
  minimum_purchase_amount: z.coerce.number().min(0, "MAP must be 0 or greater"),
  map_expiration: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface TradePartnerFormProps {
  initial?: TradePartner | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function TradePartnerForm({
  initial,
  onSuccess,
  onCancel,
}: TradePartnerFormProps) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      company_name: initial?.company_name ?? "",
      contact_name: initial?.contact_name ?? "",
      contact_email: initial?.contact_email ?? "",
      contact_phone: initial?.contact_phone ?? "",
      discount_amount: initial?.discount_amount ?? 0,
      minimum_purchase_amount: initial?.minimum_purchase_amount ?? 0,
      map_expiration: initial?.map_expiration ?? "",
    },
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    const supabase = createClient();
    const payload = {
      company_name: values.company_name,
      contact_name: values.contact_name || null,
      contact_email: values.contact_email || null,
      contact_phone: values.contact_phone || null,
      discount_amount: values.discount_amount,
      minimum_purchase_amount: values.minimum_purchase_amount,
      map_expiration: values.map_expiration || null,
    };

    const { error: dbError } = initial
      ? await supabase.from("trade_partners").update(payload).eq("id", initial.id)
      : await supabase.from("trade_partners").insert(payload);

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
        {initial ? "Edit Trade Partner" : "New Trade Partner"}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          label="Company Name"
          error={errors.company_name?.message}
          {...register("company_name")}
        />
        <InputField label="Contact Name" {...register("contact_name")} />
        <InputField
          label="Contact Email"
          error={errors.contact_email?.message}
          {...register("contact_email")}
        />
        <InputField label="Contact Phone" {...register("contact_phone")} />
        <InputField
          label="Discount (%)"
          type="number"
          step="0.01"
          min="0"
          max="100"
          hint="Percentage off applied on the Ledger form when this partner is selected."
          error={errors.discount_amount?.message}
          {...register("discount_amount")}
        />
        <InputField
          label="Minimum Purchase Amount (MAP)"
          type="number"
          step="0.01"
          error={errors.minimum_purchase_amount?.message}
          {...register("minimum_purchase_amount")}
        />
        <InputField
          label="MAP Expiration"
          type="date"
          className="sm:col-span-2"
          {...register("map_expiration")}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={isSubmitting}>
          {initial ? "Save Changes" : "Create Trade Partner"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
