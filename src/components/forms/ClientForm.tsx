"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import type { Client } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { InputField } from "@/components/ui/FormFields";

const schema = z.object({
  name: z.string().min(1, "Client name is required"),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

interface ClientFormProps {
  initial?: Client | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ClientForm({ initial, onSuccess, onCancel }: ClientFormProps) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? "",
      address: initial?.address ?? "",
      phone: initial?.phone ?? "",
      email: initial?.email ?? "",
    },
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    const supabase = createClient();
    const payload = {
      name: values.name,
      address: values.address || null,
      phone: values.phone || null,
      email: values.email || null,
    };

    const { error: dbError } = initial
      ? await supabase.from("clients").update(payload).eq("id", initial.id)
      : await supabase.from("clients").insert(payload);

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
        {initial ? "Edit Client" : "New Client"}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          label="Client Name"
          error={errors.name?.message}
          {...register("name")}
        />
        <InputField label="Phone" {...register("phone")} />
        <InputField label="Email" error={errors.email?.message} {...register("email")} />
        <InputField label="Address" className="sm:col-span-2" {...register("address")} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={isSubmitting}>
          {initial ? "Save Changes" : "Create Client"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
