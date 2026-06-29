"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import type { Client } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { InputField } from "@/components/ui/FormFields";

const createSchema = z.object({
  name: z.string().min(1, "Client name is required"),
  po_number: z.string().trim().min(1, "PO number is required"),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});

const editSchema = z.object({
  name: z.string().min(1, "Client name is required"),
  new_po_number: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});

type CreateFormValues = z.infer<typeof createSchema>;
type EditFormValues = z.infer<typeof editSchema>;

interface ClientFormProps {
  initial?: Client | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ClientForm({ initial, onSuccess, onCancel }: ClientFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [existingPos, setExistingPos] = useState<string[]>([]);
  const [loadingPos, setLoadingPos] = useState(false);
  const isEdit = Boolean(initial);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateFormValues | EditFormValues>({
    resolver: zodResolver(isEdit ? editSchema : createSchema),
    defaultValues: isEdit
      ? {
          name: initial?.name ?? "",
          new_po_number: "",
          address: initial?.address ?? "",
          phone: initial?.phone ?? "",
          email: initial?.email ?? "",
        }
      : {
          name: "",
          po_number: "",
          address: "",
          phone: "",
          email: "",
        },
  });

  const loadPoNumbers = useCallback(async () => {
    if (!initial?.id) {
      setExistingPos([]);
      return;
    }
    setLoadingPos(true);
    const supabase = createClient();
    const { data, error: dbError } = await supabase
      .from("client_po_numbers")
      .select("po_number")
      .eq("client_id", initial.id)
      .order("po_number", { ascending: true });

    if (dbError) {
      setError(dbError.message);
      setExistingPos([]);
    } else {
      setExistingPos((data ?? []).map((row) => row.po_number.trim()).filter(Boolean));
    }
    setLoadingPos(false);
  }, [initial?.id]);

  useEffect(() => {
    loadPoNumbers();
  }, [loadPoNumbers]);

  async function onSubmit(values: CreateFormValues | EditFormValues) {
    setError(null);
    const supabase = createClient();
    const payload = {
      name: values.name,
      address: values.address || null,
      phone: values.phone || null,
      email: values.email || null,
    };

    if (initial) {
      const editValues = values as EditFormValues;
      const { error: dbError } = await supabase
        .from("clients")
        .update(payload)
        .eq("id", initial.id);

      if (dbError) {
        setError(dbError.message);
        return;
      }

      const newPo = editValues.new_po_number?.trim();
      if (existingPos.length === 0 && !newPo) {
        setError("Add at least one PO number for this client.");
        return;
      }
      if (newPo) {
        const { error: poError } = await supabase.from("client_po_numbers").insert({
          client_id: initial.id,
          po_number: newPo,
        });
        if (poError) {
          setError(poError.message);
          return;
        }
      }

      onSuccess();
      return;
    }

    const createValues = values as CreateFormValues;
    const { data: created, error: dbError } = await supabase
      .from("clients")
      .insert(payload)
      .select("id")
      .single();

    if (dbError || !created) {
      setError(dbError?.message ?? "Could not create client.");
      return;
    }

    const { error: poError } = await supabase.from("client_po_numbers").insert({
      client_id: created.id,
      po_number: createValues.po_number.trim(),
    });

    if (poError) {
      setError(poError.message);
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
        {!isEdit ? (
          <InputField
            label="PO Number"
            required
            hint="Project PO for this client. Used on ledger entries and invoices."
            error={"po_number" in errors ? errors.po_number?.message : undefined}
            {...register("po_number")}
          />
        ) : (
          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-slate-700">PO Numbers</p>
            {loadingPos ? (
              <p className="mt-1 text-sm text-slate-500">Loading PO numbers…</p>
            ) : existingPos.length === 0 ? (
              <p className="mt-1 text-sm text-amber-800">
                No PO numbers yet. Add one below — at least one is required for ledger entries.
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {existingPos.map((po) => (
                  <li
                    key={po}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-800"
                  >
                    {po}
                  </li>
                ))}
              </ul>
            )}
            <InputField
              label="Add PO Number"
              className="mt-3"
              hint="Optional. Leave blank to keep existing PO numbers only."
              error={"new_po_number" in errors ? errors.new_po_number?.message : undefined}
              {...register("new_po_number")}
            />
          </div>
        )}
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
