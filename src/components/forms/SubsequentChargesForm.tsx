"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { InputField, SelectField } from "@/components/ui/FormFields";
import { createClient } from "@/lib/supabase/client";
import { isLedgerLineUninvoiced } from "@/lib/invoice-utils";
import { normalizeLedgerRow, type LedgerDbRow } from "@/lib/ledger-db";
import {
  LEDGER_DELIVERY_AND_ORIGIN_SETUP_SQL,
  canAddSubsequentCharges,
  createSubsequentCharge,
  deleteSubsequentCharge,
  goodsLineOriginId,
  isMissingDeliveryOrOriginColumn,
  subsequentChargeLineTotal,
  subsequentChargeTotal,
  uninvoicedSubsequentChargeTotal,
} from "@/lib/subsequent-charges";
import {
  PURCHASER_ACCOUNT_OPTIONS,
  isKnownPurchaser,
  type LedgerEntry,
  type Purchaser,
  type PurchaserAccount,
} from "@/lib/types";
import {
  formatCurrency,
  formatDate,
  purchaserAccountForPurchaser,
  roundMoney,
} from "@/lib/utils";

const schema = z.object({
  entry_date: z.string().min(1, "Date is required"),
  shipping_receiving_amount: z.coerce.number().min(0).transform(roundMoney),
  receiving_amount: z.coerce.number().min(0).transform(roundMoney),
  delivery_amount: z.coerce.number().min(0).transform(roundMoney),
  payment_fee: z.coerce.number().min(0).transform(roundMoney),
  purchaser: z.enum(["Jess", "Molly", "TBD"], {
    required_error: "Select a purchaser",
    invalid_type_error: "Select a purchaser",
  }),
  account: z.enum(PURCHASER_ACCOUNT_OPTIONS, {
    required_error: "Select an account",
    invalid_type_error: "Select an account",
  }),
});

type FormValues = z.infer<typeof schema>;

export function SubsequentChargesForm({
  origin,
  onCreated,
  onClose,
}: {
  origin: LedgerEntry;
  onCreated: () => void;
  onClose?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [existing, setExisting] = useState<LedgerEntry[]>([]);
  const [root, setRoot] = useState<LedgerEntry>(origin);
  const canAdd = canAddSubsequentCharges(origin);
  const originId = goodsLineOriginId(origin);
  const unpaidTotal = useMemo(
    () => uninvoicedSubsequentChargeTotal(existing),
    [existing]
  );

  const {
    register,
    handleSubmit,
    control,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      entry_date: new Date().toISOString().slice(0, 10),
      shipping_receiving_amount: 0,
      receiving_amount: 0,
      delivery_amount: 0,
      payment_fee: 0,
      purchaser: origin.purchaser,
      account: origin.account ?? "TBD",
    },
  });

  const selectedPurchaser = useWatch({ control, name: "purchaser" });
  const selectedAccount = useWatch({ control, name: "account" });
  const shipping = Number(useWatch({ control, name: "shipping_receiving_amount" }) || 0);
  const receiving = Number(useWatch({ control, name: "receiving_amount" }) || 0);
  const delivery = Number(useWatch({ control, name: "delivery_amount" }) || 0);
  const fee = Number(useWatch({ control, name: "payment_fee" }) || 0);
  const billedTotal = subsequentChargeTotal({
    shipping_receiving_amount: shipping,
    receiving_amount: receiving,
    delivery_amount: delivery,
    payment_fee: fee,
  });

  useEffect(() => {
    let cancelled = false;
    async function loadRelated() {
      const supabase = createClient();
      const siblingQuery = supabase
        .from("ledger")
        .select("*, clients(name)")
        .eq("origin_ledger_id", originId)
        .is("source_ledger_id", null);
      const rootQuery = origin.origin_ledger_id
        ? supabase
            .from("ledger")
            .select("*, clients(name)")
            .eq("id", origin.origin_ledger_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const [{ data: siblingData, error: siblingError }, { data: rootData, error: rootError }] =
        await Promise.all([siblingQuery, rootQuery]);
      if (cancelled) return;
      const loadError = siblingError?.message || rootError?.message;
      if (loadError) {
        setNeedsMigration(isMissingDeliveryOrOriginColumn(loadError));
        setError(loadError);
        return;
      }
      setExisting(
        (siblingData ?? []).map((row) =>
          normalizeLedgerRow(row as LedgerDbRow & Record<string, unknown>)
        )
      );
      if (rootData) {
        setRoot(
          normalizeLedgerRow(rootData as LedgerDbRow & Record<string, unknown>)
        );
      } else {
        setRoot(origin);
      }
    }
    void loadRelated();
    return () => {
      cancelled = true;
    };
  }, [origin, originId, reloadToken]);

  useEffect(() => {
    if (selectedPurchaser === "TBD") {
      setValue("account", "TBD", { shouldValidate: true });
      return;
    }
    if (isKnownPurchaser(selectedPurchaser) && selectedAccount === "TBD") {
      setValue("account", purchaserAccountForPurchaser(selectedPurchaser), {
        shouldValidate: true,
      });
    }
  }, [selectedPurchaser, selectedAccount, setValue]);

  if (!canAdd && existing.length === 0) return null;

  async function onSubmit(values: FormValues) {
    setError(null);
    setSuccess(null);
    setNeedsMigration(false);
    if (unpaidTotal >= 0.005) {
      const extra = subsequentChargeTotal({
        shipping_receiving_amount: values.shipping_receiving_amount,
        receiving_amount: values.receiving_amount,
        delivery_amount: values.delivery_amount,
        payment_fee: values.payment_fee,
      });
      const confirmed = window.confirm(
        `This line already has ${formatCurrency(unpaidTotal)} uninvoiced. Add another ${formatCurrency(extra)}?`
      );
      if (!confirmed) return;
    }
    setSaving(true);
    const supabase = createClient();
    const result = await createSubsequentCharge(
      supabase,
      {
        ...origin,
        description: root.description,
        clients: root.clients ?? origin.clients,
      },
      {
        entry_date: values.entry_date,
        shipping_receiving_amount: values.shipping_receiving_amount,
        receiving_amount: values.receiving_amount,
        delivery_amount: values.delivery_amount,
        payment_fee: values.payment_fee,
        purchaser: values.purchaser as Purchaser,
        account: values.account as PurchaserAccount,
      }
    );
    setSaving(false);
    if (result.error) {
      setNeedsMigration(result.missingColumn);
      setError(result.error);
      return;
    }
    reset({
      entry_date: new Date().toISOString().slice(0, 10),
      shipping_receiving_amount: 0,
      receiving_amount: 0,
      delivery_amount: 0,
      payment_fee: 0,
      purchaser: values.purchaser,
      account: values.account,
    });
    setSuccess(
      `${formatCurrency(subsequentChargeTotal(values))} is unpaid. It is not on the paid invoice. Create a new invoice from Invoicing → Outstanding to bill it.`
    );
    setReloadToken((current) => current + 1);
    onCreated();
  }

  async function onDelete(row: LedgerEntry) {
    if (!isLedgerLineUninvoiced(row)) return;
    if (
      !window.confirm(
        `Delete ${formatCurrency(subsequentChargeLineTotal(row))} unpaid charges?`
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    setDeletingId(row.id);
    const supabase = createClient();
    const result = await deleteSubsequentCharge(supabase, row);
    setDeletingId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setReloadToken((current) => current + 1);
    onCreated();
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Subsequent charges
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Bill shipping, receiving, delivery, or card fees for{" "}
            <span className="font-medium text-slate-800">
              {origin.description?.trim() || "this line"}
            </span>
            . The original paid invoice stays paid. These charges are a new unpaid
            line — bill them from{" "}
            <Link
              href="/invoicing"
              className="font-medium text-brand-700 hover:underline"
            >
              Invoicing → Outstanding
            </Link>
            .
          </p>
        </div>
        {onClose ? (
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>

      {unpaidTotal >= 0.005 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">
            Unpaid charges: {formatCurrency(unpaidTotal)}
          </p>
          <p className="mt-1">
            This does not show on the paid invoice. Create a new invoice for this
            PO to bill it.
          </p>
        </div>
      ) : null}

      {success ? (
        <p className="text-sm font-medium text-emerald-800">{success}</p>
      ) : null}

      {existing.length > 0 ? (
        <ul className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          {existing.map((row) => {
            const amount = subsequentChargeLineTotal(row);
            const uninvoiced = isLedgerLineUninvoiced(row);
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="text-slate-800">
                  {formatDate(row.entry_date)} · {row.description?.trim() || "Charges"}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums font-medium text-slate-900">
                    {formatCurrency(amount)}
                    <span className="ml-2 font-normal text-slate-500">
                      {uninvoiced ? "Unpaid" : row.invoice_id || "Invoiced"}
                    </span>
                  </span>
                  {uninvoiced ? (
                    <Button
                      type="button"
                      variant="danger"
                      className="min-h-8 px-2 py-1 text-xs"
                      disabled={deletingId === row.id}
                      onClick={() => void onDelete(row)}
                    >
                      {deletingId === row.id ? "Deleting..." : "Delete"}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {canAdd ? (
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            <InputField
              label="Date"
              type="date"
              required
              error={errors.entry_date?.message}
              {...register("entry_date")}
            />
            <SelectField
              label="Purchaser"
              required
              error={errors.purchaser?.message}
              {...register("purchaser")}
            >
              <option value="">Select purchaser</option>
              <option value="Jess">Jess</option>
              <option value="Molly">Molly</option>
              <option value="TBD">TBD</option>
            </SelectField>
            <SelectField
              label="Account"
              required
              error={errors.account?.message}
              {...register("account")}
            >
              <option value="">Select account</option>
              {PURCHASER_ACCOUNT_OPTIONS.map((account) => (
                <option key={account} value={account}>
                  {account}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            <InputField
              label="Shipping"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              error={errors.shipping_receiving_amount?.message}
              {...register("shipping_receiving_amount")}
            />
            <InputField
              label="Receiving"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              error={errors.receiving_amount?.message}
              {...register("receiving_amount")}
            />
            <InputField
              label="Delivery"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              error={errors.delivery_amount?.message}
              {...register("delivery_amount")}
            />
            <InputField
              label="Card fee"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              error={errors.payment_fee?.message}
              {...register("payment_fee")}
            />
          </div>
          <p className="text-sm text-slate-600">
            Amount to invoice:{" "}
            <span className="font-medium text-slate-900">
              {formatCurrency(billedTotal)}
            </span>
          </p>
          {needsMigration ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">
                Run this SQL in the Supabase SQL editor, then save again.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-amber-200 bg-white p-3 text-xs text-slate-800">
                {LEDGER_DELIVERY_AND_ORIGIN_SETUP_SQL}
              </pre>
            </div>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : null}
          <Button type="submit" loading={isSubmitting || saving}>
            Add unpaid charges
          </Button>
        </form>
      ) : null}
    </div>
  );
}
