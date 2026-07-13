"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { CLIENT_BUDGET_SETUP_SQL } from "@/lib/client-budget-db";
import {
  fetchAllKnownPoNumbers,
  pickUniqueAutoClientPoNumber,
  renameClientPoNumber,
  resolveClientPoNumber,
} from "@/lib/client-po-db";
import { normalizePoNumber } from "@/lib/invoice-utils";
import type { Client } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { CheckboxField, editableControlClass, InputField } from "@/components/ui/FormFields";
import { roundMoney } from "@/lib/utils";

const schema = z.object({
  name: z.string().min(1, "Client name is required"),
  po_number: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  personal_use: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

type PoBudgetRow = {
  id: string;
  po_number: string;
  original_po_number: string;
  budget: number;
};

type PendingPoRow = {
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
  const [pendingPoRows, setPendingPoRows] = useState<PendingPoRow[]>([]);
  const [addingPo, setAddingPo] = useState(false);
  const [loadingPos, setLoadingPos] = useState(false);
  const [needsBudgetSetup, setNeedsBudgetSetup] = useState(false);
  const isEdit = Boolean(initial);
  const poTouched = useRef(false);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? "",
      po_number: "",
      address: initial?.address ?? "",
      phone: initial?.phone ?? "",
      email: initial?.email ?? "",
      personal_use: initial?.personal_use ?? false,
    },
  });

  const clientName = useWatch({ control, name: "name" });
  const poNumberDraft = useWatch({ control, name: "po_number" });

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
              original_po_number: row.po_number.trim(),
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
        original_po_number: row.po_number.trim(),
        budget: Number(row.budget ?? 0),
      }))
    );
    setLoadingPos(false);
  }, [initial?.id]);

  useEffect(() => {
    loadPoRows();
  }, [loadPoRows]);

  useEffect(() => {
    if (isEdit || poTouched.current) return;
    const name = clientName?.trim();
    if (!name) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const supabase = createClient();
      try {
        const suggested = await resolveClientPoNumber(supabase, name, "");
        if (!cancelled && !poTouched.current && !poNumberDraft?.trim()) {
          setValue("po_number", suggested);
        }
      } catch {
        // User can still enter a PO manually.
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [clientName, isEdit, poNumberDraft, setValue]);

  function updatePendingPoNumber(rowId: string, poNumber: string) {
    setPendingPoRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, po_number: poNumber } : row))
    );
  }

  function updatePendingPoBudget(rowId: string, budget: number) {
    setPendingPoRows((current) =>
      current.map((row) =>
        row.id === rowId ? { ...row, budget: roundMoney(Math.max(0, budget)) } : row
      )
    );
  }

  async function handleAddPo() {
    setError(null);
    const name = clientName?.trim();
    if (!name) {
      setError("Enter a client name before adding a PO.");
      return;
    }

    setAddingPo(true);
    try {
      const supabase = createClient();
      const global = await fetchAllKnownPoNumbers(supabase);
      const local = [
        ...poRows.map((row) => row.po_number),
        ...pendingPoRows.map((row) => row.po_number),
      ];
      const poNumber = pickUniqueAutoClientPoNumber(name, [...global, ...local]);
      setPendingPoRows((current) => [
        ...current,
        { id: crypto.randomUUID(), po_number: poNumber, budget: 0 },
      ]);
    } catch (genError) {
      setError(
        genError instanceof Error ? genError.message : "Could not generate a PO number."
      );
    } finally {
      setAddingPo(false);
    }
  }

  function validatePoNumbers(
    existingRows: PoBudgetRow[],
    pendingRows: PendingPoRow[]
  ): string | null {
    const trimmed = [
      ...existingRows.map((row) => row.po_number.trim()),
      ...pendingRows.map((row) => row.po_number.trim()),
    ];
    if (trimmed.some((po) => !po)) return "PO number cannot be empty.";
    const keys = trimmed.map((po) => normalizePoNumber(po));
    if (new Set(keys).size !== keys.length) {
      return "Each PO number for this client must be unique.";
    }
    return null;
  }

  async function validateGlobalPoUniqueness(
    existingRows: PoBudgetRow[],
    pendingRows: PendingPoRow[]
  ): Promise<string | null> {
    const supabase = createClient();
    const global = await fetchAllKnownPoNumbers(supabase);
    const taken = new Set(global.map((po) => normalizePoNumber(po)));

    for (const row of existingRows) {
      taken.delete(normalizePoNumber(row.original_po_number));
      const next = row.po_number.trim();
      if (taken.has(normalizePoNumber(next))) {
        return `PO number "${next}" is already in use.`;
      }
      taken.add(normalizePoNumber(next));
    }

    for (const row of pendingRows) {
      const next = row.po_number.trim();
      if (taken.has(normalizePoNumber(next))) {
        return `PO number "${next}" is already in use.`;
      }
      taken.add(normalizePoNumber(next));
    }

    return null;
  }

  function updatePoBudget(poId: string, budget: number) {
    setPoRows((current) =>
      current.map((row) =>
        row.id === poId ? { ...row, budget: roundMoney(Math.max(0, budget)) } : row
      )
    );
  }

  function updatePoNumber(poId: string, poNumber: string) {
    setPoRows((current) =>
      current.map((row) => (row.id === poId ? { ...row, po_number: poNumber } : row))
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
      personal_use: values.personal_use,
    };

    if (initial) {
      let rowsToInsert = [...pendingPoRows];

      if (poRows.length === 0 && rowsToInsert.length === 0) {
        try {
          const autoPo = await resolveClientPoNumber(supabase, values.name, "");
          rowsToInsert = [{ id: "auto", po_number: autoPo, budget: 0 }];
        } catch (genError) {
          setError(
            genError instanceof Error
              ? genError.message
              : "Could not generate a PO number."
          );
          return;
        }
      }

      if (poRows.length === 0 && rowsToInsert.length === 0) {
        setError("Add at least one PO number for this client.");
        return;
      }

      const poValidationError = validatePoNumbers(poRows, rowsToInsert);
      if (poValidationError) {
        setError(poValidationError);
        return;
      }

      const globalPoError = await validateGlobalPoUniqueness(poRows, rowsToInsert);
      if (globalPoError) {
        setError(globalPoError);
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
        const trimmedPo = row.po_number.trim();

        if (trimmedPo !== row.original_po_number) {
          const renameResult = await renameClientPoNumber(
            supabase,
            initial.id,
            row.original_po_number,
            trimmedPo
          );
          if (renameResult.error) {
            setError(renameResult.error);
            return;
          }
        }

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

      for (const row of rowsToInsert) {
        const { error: poError } = await supabase.from("client_po_numbers").insert({
          client_id: initial.id,
          po_number: row.po_number.trim(),
          budget: row.budget,
        });
        if (poError) {
          setError(poError.message);
          return;
        }
      }

      onSuccess();
      return;
    }

    let poNumber: string;
    try {
      poNumber = await resolveClientPoNumber(supabase, values.name, values.po_number);
    } catch (genError) {
      setError(
        genError instanceof Error ? genError.message : "Could not generate a PO number."
      );
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

  const poNumberField = register("po_number", {
    onChange: () => {
      poTouched.current = true;
    },
  });

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
            hint="Auto-generated from client name; edit before saving if needed."
            error={errors.po_number?.message}
            {...poNumberField}
          />
        ) : (
          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-slate-700">PO numbers &amp; budgets</p>
            {loadingPos ? (
              <p className="mt-1 text-sm text-slate-500">Loading PO numbers…</p>
            ) : poRows.length === 0 ? (
              <p className="mt-1 text-sm text-amber-800">
                No PO numbers yet. Click Add PO Number below — at least one is required for
                ledger entries.
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
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={row.po_number}
                            onChange={(event) => updatePoNumber(row.id, event.target.value)}
                            className={`w-full min-w-[10rem] px-3 py-2 text-sm text-slate-900 ${editableControlClass}`}
                          />
                        </td>
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
            {pendingPoRows.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded-lg border border-dashed border-brand-200 bg-brand-50/30">
                <table className="min-w-full text-sm">
                  <thead className="bg-brand-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">New PO</th>
                      <th className="px-3 py-2 font-medium">Budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingPoRows.map((row) => (
                      <tr key={row.id} className="border-t border-brand-100">
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={row.po_number}
                            onChange={(event) =>
                              updatePendingPoNumber(row.id, event.target.value)
                            }
                            className={`w-full min-w-40 px-3 py-2 text-sm text-slate-900 ${editableControlClass}`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={row.budget}
                            disabled={needsBudgetSetup}
                            onChange={(event) =>
                              updatePendingPoBudget(row.id, Number(event.target.value) || 0)
                            }
                            className="w-full max-w-40 rounded-lg border border-brand-300 bg-white px-3 py-2 text-sm shadow-sm disabled:bg-slate-50"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              disabled={addingPo}
              onClick={() => void handleAddPo()}
            >
              {addingPo ? "Generating…" : "Add PO Number"}
            </Button>
          </div>
        )}
        <InputField label="Phone" {...register("phone")} />
        <InputField label="Email" error={errors.email?.message} {...register("email")} />
        <InputField label="Address" className="sm:col-span-2" {...register("address")} />
        <CheckboxField
          label="Personal Use"
          hint="Ledger entries for this client are marked Balance Sheet."
          {...register("personal_use")}
        />
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
