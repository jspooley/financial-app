"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { CLIENT_BUDGET_SETUP_SQL } from "@/lib/client-budget-db";
import type { Client } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { InputField } from "@/components/ui/FormFields";
import { roundMoney } from "@/lib/utils";

const schema = z.object({
  name: z.string().min(1, "Client name is required"),
  po_number: z.string().optional(),
  new_po_number: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

type PoBudgetRow = {
  id: string;
  po_number: string;
  budget: number;
};

interface ClientFormProps {
  initial?: Client | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ClientForm({ initial, onSuccess, onCancel }: ClientFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [poRows, setPoRows] = useState<PoBudgetRow[]>([]);
  const [loadingPos, setLoadingPos] = useState(false);
  const [needsBudgetSetup, setNeedsBudgetSetup] = useState(false);
  const isEdit = Boolean(initial);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? "",
      po_number: "",
      new_po_number: "",
      address: initial?.address ?? "",
      phone: initial?.phone ?? "",
      email: initial?.email ?? "",
    },
  });

  const loadPoRows = useCallback(async () => {
    if (!initial?.id) {
      setPoRows([]);
      return;
    }
    setLoadingPos(true);
    setNeedsBudgetSetup(false);
    const supabase = createClient();
    const { data, error: dbError } = await supabase
      .from("client_po_numbers")
      .select("id, po_number, budget")
      .eq("client_id", initial.id)
      .order("po_number", { ascending: true });

    if (dbError) {
      const message = dbError.message.toLowerCase();
      if (message.includes("budget")) {
        setNeedsBudgetSetup(true);
        const { data: fallback, error: fallbackError } = await supabase
          .from("client_po_numbers")
          .select("id, po_number")
          .eq("client_id", initial.id)
          .order("po_number", { ascending: true });

        if (fallbackError) {
          setError(fallbackError.message);
          setPoRows([]);
        } else {
          setPoRows(
            (fallback ?? []).map((row) => ({
              id: row.id,
              po_number: row.po_number.trim(),
              budget: 0,
            }))
          );
        }
      } else {
        setError(dbError.message);
        setPoRows([]);
      }
      setLoadingPos(false);
      return;
    }

    setPoRows(
      (data ?? []).map((row) => ({
        id: row.id,
        po_number: row.po_number.trim(),
        budget: Number(row.budget ?? 0),
      }))
    );
    setLoadingPos(false);
  }, [initial?.id]);

  useEffect(() => {
    loadPoRows();
  }, [loadPoRows]);

  function updatePoBudget(poId: string, budget: number) {
    setPoRows((current) =>
      current.map((row) =>
        row.id === poId ? { ...row, budget: roundMoney(Math.max(0, budget)) } : row
      )
    );
  }

  async function onSubmit(values: FormValues) {
    setError(null);
    const supabase = createClient();
    const payload = {
      name: values.name,
      address: values.address || null,
      phone: values.phone || null,
      email: values.email || null,
    };

    if (initial) {
      const newPo = values.new_po_number?.trim();
      if (poRows.length === 0 && !newPo) {
        setError("Add at least one PO number for this client.");
        return;
      }

      const { error: dbError } = await supabase
        .from("clients")
        .update(payload)
        .eq("id", initial.id);

      if (dbError) {
        setError(dbError.message);
        return;
      }

      for (const row of poRows) {
        const { error: poBudgetError } = await supabase
          .from("client_po_numbers")
          .update({ budget: row.budget })
          .eq("id", row.id);

        if (poBudgetError) {
          const message = poBudgetError.message.toLowerCase();
          if (message.includes("budget")) setNeedsBudgetSetup(true);
          setError(poBudgetError.message);
          return;
        }
      }

      if (newPo) {
        const { error: poError } = await supabase.from("client_po_numbers").insert({
          client_id: initial.id,
          po_number: newPo,
          budget: 0,
        });
        if (poError) {
          setError(poError.message);
          return;
        }
      }

      onSuccess();
      return;
    }

    const poNumber = values.po_number?.trim();
    if (!poNumber) {
      setError("PO number is required.");
      return;
    }

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
      po_number: poNumber,
      budget: 0,
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
            error={errors.po_number?.message}
            {...register("po_number")}
          />
        ) : (
          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-slate-700">PO numbers &amp; budgets</p>
            {loadingPos ? (
              <p className="mt-1 text-sm text-slate-500">Loading PO numbers…</p>
            ) : poRows.length === 0 ? (
              <p className="mt-1 text-sm text-amber-800">
                No PO numbers yet. Add one below — at least one is required for ledger entries.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">PO</th>
                      <th className="px-3 py-2 font-medium">Budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poRows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium text-slate-900">{row.po_number}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={row.budget}
                            disabled={needsBudgetSetup}
                            onChange={(event) =>
                              updatePoBudget(row.id, Number(event.target.value) || 0)
                            }
                            className="w-full max-w-[10rem] rounded-lg border border-brand-300 bg-white px-3 py-2 text-sm shadow-sm disabled:bg-slate-50"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <InputField
              label="Add PO Number"
              className="mt-3"
              hint="Optional. Leave blank to keep existing PO numbers only."
              error={errors.new_po_number?.message}
              {...register("new_po_number")}
            />
          </div>
        )}
        <InputField label="Phone" {...register("phone")} />
        <InputField label="Email" error={errors.email?.message} {...register("email")} />
        <InputField label="Address" className="sm:col-span-2" {...register("address")} />
      </div>

      {needsBudgetSetup && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">PO budget column not set up yet.</p>
          <p className="mt-1">Run this SQL once in Supabase to enable budget editing.</p>
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-white p-2 text-xs ring-1 ring-amber-200">
            {CLIENT_BUDGET_SETUP_SQL}
          </pre>
        </div>
      )}

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
