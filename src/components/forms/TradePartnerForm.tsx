"use client";

import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { TRADE_ACCOUNT_OWNERS, type TradePartner } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { InputField, SelectField } from "@/components/ui/FormFields";
import {
  calculateTradeDiscountPercentFromPricing,
  formatPercent,
  roundMoney,
} from "@/lib/utils";

const schema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  contact_name: z.string().optional(),
  contact_email: z.string().email("Invalid email").optional().or(z.literal("")),
  contact_phone: z.string().optional(),
  account_owner: z.enum(["", ...TRADE_ACCOUNT_OWNERS]),
  retail_price: z.coerce.number().min(0, "Retail price must be 0 or greater"),
  designer_cost: z.coerce.number().min(0, "Designer cost must be 0 or greater"),
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
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      company_name: initial?.company_name ?? "",
      contact_name: initial?.contact_name ?? "",
      contact_email: initial?.contact_email ?? "",
      contact_phone: initial?.contact_phone ?? "",
      account_owner: initial?.account_owner ?? "",
      retail_price: initial?.retail_price ?? 0,
      designer_cost: initial?.designer_cost ?? 0,
      minimum_purchase_amount: initial?.minimum_purchase_amount ?? 0,
      map_expiration: initial?.map_expiration ?? "",
    },
  });

  const retailPrice = useWatch({ control, name: "retail_price" });
  const designerCost = useWatch({ control, name: "designer_cost" });

  const calculatedDiscount = useMemo(
    () =>
      calculateTradeDiscountPercentFromPricing(
        Number(retailPrice) || 0,
        Number(designerCost) || 0
      ),
    [retailPrice, designerCost]
  );

  async function onSubmit(values: FormValues) {
    setError(null);
    const supabase = createClient();
    const retail = roundMoney(values.retail_price);
    const designer = roundMoney(values.designer_cost);
    const discountAmount = calculateTradeDiscountPercentFromPricing(retail, designer);

    const payload = {
      company_name: values.company_name,
      contact_name: values.contact_name || null,
      contact_email: values.contact_email || null,
      contact_phone: values.contact_phone || null,
      account_owner: values.account_owner || null,
      retail_price: retail,
      designer_cost: designer,
      discount_amount: discountAmount,
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
        <SelectField
          label="Trade Account Owner"
          error={errors.account_owner?.message}
          {...register("account_owner")}
        >
          <option value="">Select owner</option>
          {TRADE_ACCOUNT_OWNERS.map((owner) => (
            <option key={owner} value={owner}>
              {owner}
            </option>
          ))}
        </SelectField>
        <InputField
          label="Retail Price"
          type="number"
          step="0.01"
          min="0"
          error={errors.retail_price?.message}
          {...register("retail_price", { valueAsNumber: true })}
        />
        <InputField
          label="Designer Cost"
          type="number"
          step="0.01"
          min="0"
          error={errors.designer_cost?.message}
          {...register("designer_cost", { valueAsNumber: true })}
        />
        <InputField
          label="Discount (%)"
          value={formatPercent(calculatedDiscount)}
          readOnly
          disabled
          hint="((Retail price − Designer cost) ÷ Retail price) × 100"
          className="sm:col-span-2"
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
