"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, type Control, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { ledgerFormToDb } from "@/lib/ledger-db";
import type { Client, Invoice, LedgerEntry, Purchaser, TradePartner } from "@/lib/types";
import {
  getLedgerOutstandingBalance,
  isLedgerLineFullyPaid,
  poNumbersMatch,
} from "@/lib/invoice-utils";
import {
  calculateCustomerPrice,
  calculateDesignerCostFromTradePartner,
  calculateTaxFromRetailPrice,
  defaultLedgerDiscountPercent,
  formatCurrency,
  formatDate,
  getLedgerInvoicedAmount,
  getLedgerRetailSubtotal,
  getLedgerTotalDesignerCost,
  roundMoney,
} from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import {
  CheckboxField,
  fieldClass,
  InputField,
  SelectField,
  TextareaField,
} from "@/components/ui/FormFields";

const schema = z.object({
  entry_date: z.string().min(1, "Date is required"),
  designer_cost: z.coerce
    .number({ invalid_type_error: "Designer cost is required" })
    .positive("Designer cost must be greater than 0")
    .transform(roundMoney),
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be at least 1"),
  credit_debit: z.enum(["credit", "debit"]),
  description: z.string().trim().min(1, "Description is required"),
  wholesale_retail: z.enum(["wholesale", "retail"]),
  trade_partner_id: z.string().optional(),
  discount_percent: z.coerce
    .number({ invalid_type_error: "Discount is required" })
    .min(0, "Discount is required")
    .max(100, "Discount cannot exceed 100%"),
  shipping_receiving_amount: z.coerce.number().min(0).transform(roundMoney),
  retail_price: z.coerce
    .number({ invalid_type_error: "Retail price is required" })
    .positive("Retail price must be greater than 0")
    .transform(roundMoney),
  tax_amount: z.coerce.number().min(0).transform(roundMoney),
  client_id: z.string().uuid("Select a client"),
  po_number: z.string().trim().min(1, "PO number is required"),
  purchaser: z.enum(["Jess", "Molly"], {
    required_error: "Purchaser is required",
  }),
});

type FormValues = z.infer<typeof schema>;

type MoneyFieldName =
  | "retail_price"
  | "designer_cost"
  | "shipping_receiving_amount"
  | "tax_amount";

const currencyInputClass = `${fieldClass} py-2 pl-7 pr-3`;

function CurrencyField({
  control,
  name,
  error,
  hint,
  label,
  required,
  allowZero = false,
  disabled,
  computedValue,
  onUserEdit,
  onValueChange,
}: {
  control: Control<FormValues>;
  name: MoneyFieldName;
  error?: string;
  hint?: string;
  label: string;
  required?: boolean;
  allowZero?: boolean;
  disabled?: boolean;
  computedValue?: number;
  onUserEdit?: () => void;
  onValueChange?: () => void;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const rawValue = field.value as number | "" | null | undefined;
        const num =
          computedValue !== undefined ? computedValue : Number(field.value);
        const hasValue = allowZero
          ? rawValue !== "" && rawValue != null && !Number.isNaN(num)
          : num > 0;
        const displayValue = focused
          ? hasValue
            ? String(num)
            : ""
          : hasValue
            ? num.toFixed(2)
            : "";

        return (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">
              {label}
              {required && <span className="text-red-600"> *</span>}
            </span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                $
              </span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                required={required}
                disabled={disabled}
                className={currencyInputClass}
                value={displayValue}
                onFocus={() => setFocused(true)}
                onChange={(e) => {
                  onUserEdit?.();
                  onValueChange?.();
                  const raw = e.target.value.replace(/[^0-9.]/g, "");
                  if (raw === "" || raw === ".") {
                    field.onChange(allowZero ? 0 : ("" as unknown as number));
                    return;
                  }
                  const parsed = Number(raw);
                  if (!Number.isNaN(parsed)) field.onChange(parsed);
                }}
                onBlur={() => {
                  if (hasValue) field.onChange(roundMoney(num));
                  setFocused(false);
                  field.onBlur();
                }}
              />
            </div>
            {hint && <span className="block text-xs text-slate-500">{hint}</span>}
            {error && <span className="block text-xs text-red-600">{error}</span>}
          </label>
        );
      }}
    />
  );
}

interface LedgerFormProps {
  clients: Client[];
  tradePartners: TradePartner[];
  invoices: Invoice[];
  defaultPurchaser?: Purchaser | null;
  initial?: LedgerEntry | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function LedgerForm({
  clients,
  tradePartners,
  invoices,
  defaultPurchaser,
  initial,
  onSuccess,
  onCancel,
}: LedgerFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [needsQuantityColumn, setNeedsQuantityColumn] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      entry_date: initial?.entry_date ?? new Date().toISOString().slice(0, 10),
      designer_cost:
        initial?.designer_cost != null && initial.designer_cost > 0
          ? roundMoney(initial.designer_cost)
          : ("" as unknown as number),
      quantity: initial?.quantity ?? 1,
      credit_debit: initial?.credit_debit ?? "debit",
      description: initial?.description ?? "",
      wholesale_retail: initial?.wholesale_retail ?? "retail",
      trade_partner_id: initial?.trade_partner_id ?? "",
      discount_percent: initial?.discount_percent ?? 0,
      shipping_receiving_amount: roundMoney(initial?.shipping_receiving_amount ?? 0),
      retail_price:
        initial?.retail_price != null && initial.retail_price > 0
          ? roundMoney(initial.retail_price)
          : ("" as unknown as number),
      tax_amount: roundMoney(initial?.tax_amount ?? 0),
      client_id: initial?.client_id ?? "",
      po_number: initial?.po_number?.trim() ?? "",
      purchaser: initial?.purchaser ?? defaultPurchaser ?? "Jess",
    },
  });

  const selectedClientId = useWatch({ control, name: "client_id" });
  const selectedPoNumber = useWatch({ control, name: "po_number" });
  const selectedTradePartnerId = useWatch({ control, name: "trade_partner_id" });
  const quantity = useWatch({ control, name: "quantity" });
  const discountPercent = useWatch({ control, name: "discount_percent" });
  const wholesaleRetail = useWatch({ control, name: "wholesale_retail" });
  const shippingAmount = useWatch({ control, name: "shipping_receiving_amount" });
  const retailPrice = useWatch({ control, name: "retail_price" });
  const designerCost = useWatch({ control, name: "designer_cost" });
  const taxAmount = useWatch({ control, name: "tax_amount" });
  const storedPaymentFee = roundMoney(initial?.payment_fee ?? 0);
  const skipPoReset = useRef(true);
  const previousClientIdRef = useRef<string | null>(null);
  const skipDiscountReset = useRef(!!initial);
  const skipDesignerCostReset = useRef(!!initial);
  const taxManuallyEdited = useRef(false);
  const designerCostManuallyEdited = useRef(!!initial);

  const numericQty = Number(quantity) || 0;
  const numericDiscount = Number(discountPercent) || 0;
  const numericShipping = Number(shippingAmount) || 0;
  const numericRetailPrice = Number(retailPrice) || 0;
  const isWholesale = wholesaleRetail === "wholesale";

  const autoTax = useMemo(
    () =>
      isWholesale
        ? calculateTaxFromRetailPrice(numericRetailPrice, numericQty)
        : 0,
    [isWholesale, numericRetailPrice, numericQty]
  );

  const selectedTradePartner = useMemo(
    () => tradePartners.find((tp) => tp.id === selectedTradePartnerId),
    [tradePartners, selectedTradePartnerId]
  );

  const autoDesignerCost = useMemo(
    () =>
      calculateDesignerCostFromTradePartner(
        numericRetailPrice,
        Number(selectedTradePartner?.discount_amount ?? 0)
      ),
    [numericRetailPrice, selectedTradePartner]
  );

  const effectiveTax = isWholesale
    ? taxManuallyEdited.current
      ? Number(taxAmount) || 0
      : autoTax
    : 0;

  const effectiveDesignerCost = designerCostManuallyEdited.current
    ? Number(designerCost) || 0
    : autoDesignerCost;

  const clientInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.client_id === selectedClientId),
    [invoices, selectedClientId]
  );

  const poOptions = useMemo(() => {
    const options = clientInvoices.map((invoice) => ({
      id: invoice.id,
      po_number: invoice.po_number.trim(),
    }));
    const current = selectedPoNumber?.trim();
    if (
      current &&
      !options.some((option) => poNumbersMatch(option.po_number, current))
    ) {
      options.unshift({ id: `saved-${current}`, po_number: current });
    }
    return options;
  }, [clientInvoices, selectedPoNumber]);

  const customerPrice = useMemo(
    () => calculateCustomerPrice(numericRetailPrice, numericQty, numericDiscount),
    [numericRetailPrice, numericQty, numericDiscount]
  );

  const invoicedAmount = useMemo(
    () =>
      getLedgerInvoicedAmount({
        retail_price: numericRetailPrice,
        quantity: numericQty,
        discount_percent: numericDiscount,
        tax_amount: effectiveTax,
        shipping_receiving_amount: numericShipping,
        wholesale_retail: wholesaleRetail,
        payment_fee: storedPaymentFee,
      }),
    [
      numericRetailPrice,
      numericQty,
      numericDiscount,
      effectiveTax,
      numericShipping,
      wholesaleRetail,
      storedPaymentFee,
    ]
  );

  const totalDesignerCost = useMemo(
    () =>
      getLedgerTotalDesignerCost({
        designer_cost: effectiveDesignerCost,
        quantity: numericQty,
      }),
    [effectiveDesignerCost, numericQty]
  );

  const retailSubtotal = useMemo(
    () =>
      getLedgerRetailSubtotal({
        retail_price: numericRetailPrice,
        quantity: numericQty,
      }),
    [numericRetailPrice, numericQty]
  );

  const outstandingBalance = useMemo(() => {
    if (!initial || initial.credit_debit !== "debit") return null;
    return getLedgerOutstandingBalance({
      retail_price: numericRetailPrice,
      quantity: numericQty,
      discount_percent: numericDiscount,
      tax_amount: effectiveTax,
      shipping_receiving_amount: numericShipping,
      wholesale_retail: wholesaleRetail,
      payment_fee: storedPaymentFee,
      payment_amount: initial.payment_amount,
      write_off: initial.write_off,
      write_off_amount: initial.write_off_amount,
    });
  }, [
    initial,
    numericRetailPrice,
    numericQty,
    numericDiscount,
    effectiveTax,
    numericShipping,
    wholesaleRetail,
    storedPaymentFee,
  ]);

  useEffect(() => {
    if (!isWholesale) {
      taxManuallyEdited.current = false;
      setValue("tax_amount", 0, { shouldValidate: true });
      return;
    }
    if (!taxManuallyEdited.current) {
      setValue("tax_amount", autoTax, { shouldValidate: true });
    }
  }, [isWholesale, autoTax, setValue]);

  useEffect(() => {
    if (skipDesignerCostReset.current) {
      skipDesignerCostReset.current = false;
      return;
    }
    if (!designerCostManuallyEdited.current && numericRetailPrice > 0) {
      setValue("designer_cost", autoDesignerCost, { shouldValidate: true });
    }
  }, [autoDesignerCost, numericRetailPrice, setValue]);

  useEffect(() => {
    if (skipDiscountReset.current) {
      skipDiscountReset.current = false;
      return;
    }
    if (!selectedTradePartnerId) return;
    const partner = tradePartners.find((tp) => tp.id === selectedTradePartnerId);
    if (partner) {
      setValue(
        "discount_percent",
        defaultLedgerDiscountPercent(Number(partner.discount_amount))
      );
    }
    designerCostManuallyEdited.current = false;
  }, [selectedTradePartnerId, tradePartners, setValue]);

  useEffect(() => {
    if (skipPoReset.current) {
      skipPoReset.current = false;
      previousClientIdRef.current = selectedClientId;
      return;
    }
    if (
      previousClientIdRef.current !== null &&
      previousClientIdRef.current !== selectedClientId
    ) {
      setValue("po_number", "");
    }
    previousClientIdRef.current = selectedClientId;
  }, [selectedClientId, setValue]);

  async function onSubmit(values: FormValues) {
    setError(null);
    setNeedsQuantityColumn(false);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be signed in to save. Go to Login and sign in first.");
      return;
    }

    const poNumber = (values.po_number ?? getValues("po_number") ?? "").trim();
    if (!poNumber) {
      setError("PO number is required. Select a PO for this client.");
      return;
    }

    const payload = ledgerFormToDb({
      entry_date: values.entry_date,
      designer_cost: values.designer_cost,
      quantity: values.quantity,
      credit_debit: values.credit_debit,
      description: values.description,
      wholesale_retail: values.wholesale_retail,
      trade_partner_id: values.trade_partner_id,
      discount_percent: values.discount_percent,
      shipping_receiving_amount: values.shipping_receiving_amount,
      retail_price: values.retail_price,
      tax_amount: values.tax_amount,
      tax_manually_edited: taxManuallyEdited.current,
      client_id: values.client_id,
      po_number: poNumber,
      purchaser: values.purchaser,
    });

    const { data, error: dbError } = initial
      ? await supabase
          .from("ledger")
          .update(payload)
          .eq("id", initial.id)
          .select("id, po_number")
          .single()
      : await supabase.from("ledger").insert(payload).select("id, po_number").single();

    if (dbError) {
      if (dbError.message.includes("ledger_invoicing_fk")) {
        setError("PO number must match an existing invoice for the selected client.");
      } else if (dbError.message.includes("row-level security")) {
        setError("Permission denied. Sign out and sign back in, then try again.");
      } else if (dbError.message.toLowerCase().includes("quantity")) {
        setNeedsQuantityColumn(true);
      } else {
        setError(dbError.message);
      }
      return;
    }

    if (!data?.id) {
      setError("Save failed — no row was written. Check that you are signed in.");
      return;
    }

    if (!data.po_number?.trim()) {
      setError(
        "Entry saved but PO number is missing. Select a PO from the list for this client and save again."
      );
      return;
    }

    onSuccess();
  }

  function onInvalid(fieldErrors: typeof errors) {
    const firstError = Object.values(fieldErrors).find((e) => e?.message)?.message;
    setError(
      firstError
        ? `Could not save: ${firstError}`
        : "Please fix the highlighted fields before saving."
    );
  }

  function resetAutoCalculatedFields() {
    taxManuallyEdited.current = false;
    designerCostManuallyEdited.current = false;
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit, onInvalid)}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <h2 className="text-lg font-semibold text-slate-900">
        {initial ? "Edit Ledger Entry" : "New Ledger Entry"}
      </h2>

      <div className="space-y-4">
        {/* Top: client/date/trade partner left, description + PO/wholesale-retail right */}
        <div className="grid gap-4 lg:grid-cols-2 lg:grid-rows-[auto_auto_auto_auto]">
          <div className="lg:col-start-1 lg:row-start-1">
            <SelectField
              label="Client"
              required
              error={errors.client_id?.message}
              {...register("client_id")}
            >
              <option value="">Select client...</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="lg:col-start-2 lg:row-start-1 lg:row-span-2">
            <TextareaField
              label="Description"
              rows={5}
              className="min-h-[8.5rem]"
              required
              error={errors.description?.message}
              {...register("description")}
            />
          </div>

          <div className="lg:col-start-1 lg:row-start-2">
            <InputField
              label="Date"
              type="date"
              required
              error={errors.entry_date?.message}
              {...register("entry_date")}
            />
          </div>

          <div className="lg:col-start-1 lg:row-start-3">
            <SelectField
              label="Credit / Debit"
              error={errors.credit_debit?.message}
              {...register("credit_debit")}
            >
              <option value="debit">Debit (expense)</option>
              <option value="credit">Credit (receivable)</option>
            </SelectField>
          </div>

          <div className="lg:col-start-2 lg:row-start-3">
            <SelectField
              label="PO Number"
              required
              error={errors.po_number?.message}
              {...register("po_number")}
            >
              <option value="">Select PO...</option>
              {poOptions.map((option) => (
                <option key={option.id} value={option.po_number}>
                  {option.po_number}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="lg:col-start-1 lg:row-start-4">
            <SelectField label="Trade Partner" {...register("trade_partner_id")}>
              <option value="">No trade partner</option>
              {tradePartners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.company_name}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="lg:col-start-2 lg:row-start-4">
            <SelectField
              label="Wholesale / Retail"
              required
              error={errors.wholesale_retail?.message}
              {...register("wholesale_retail", { onChange: resetAutoCalculatedFields })}
            >
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
            </SelectField>
          </div>
        </div>

        {/* Pricing row: qty, retail price, subtotal */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          <InputField
            label="Quantity"
            type="number"
            step="1"
            min="1"
            required
            error={errors.quantity?.message}
            {...register("quantity", {
              valueAsNumber: true,
              onChange: resetAutoCalculatedFields,
            })}
          />
          <CurrencyField
            control={control}
            name="retail_price"
            label="Retail Price"
            required
            hint="Used to calculate tax: retail price × quantity × 0.06."
            error={errors.retail_price?.message}
            onValueChange={resetAutoCalculatedFields}
          />
          <InputField
            label="Retail Price × Qty"
            value={formatCurrency(retailSubtotal)}
            readOnly
            disabled
          />
        </div>

        {/* Cost row: purchaser, designer cost, total designer cost */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          <SelectField
            label="Purchaser"
            required
            error={errors.purchaser?.message}
            {...register("purchaser")}
          >
            <option value="Jess">Jess</option>
            <option value="Molly">Molly</option>
          </SelectField>
          <CurrencyField
            control={control}
            name="designer_cost"
            label="Designer Cost"
            required
            hint={
              selectedTradePartner
                ? `Retail price × (1 − ${selectedTradePartner.discount_amount}% trade partner discount). Edit to override.`
                : "Select a trade partner to auto-calculate from retail price. Edit to override."
            }
            error={errors.designer_cost?.message}
            computedValue={
              designerCostManuallyEdited.current ? undefined : autoDesignerCost
            }
            onUserEdit={() => {
              designerCostManuallyEdited.current = true;
            }}
          />
          <InputField
            label="Total Designer Cost"
            value={formatCurrency(totalDesignerCost)}
            readOnly
            disabled
            hint="Designer cost × quantity"
          />
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            <InputField
              label="Customer Price × Qty"
              value={formatCurrency(customerPrice)}
              readOnly
              disabled
              hint="(Retail price × qty) − (Discount % × retail price × qty)"
            />
            <InputField
              label="Discount (%)"
              type="number"
              step="0.01"
              min="0"
              max="100"
              required
              hint="Defaults to half of the trade partner discount."
              error={errors.discount_percent?.message}
              {...register("discount_percent", { valueAsNumber: true })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            <CurrencyField
              control={control}
              name="shipping_receiving_amount"
              label="Shipping"
              allowZero
              error={errors.shipping_receiving_amount?.message}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            {isWholesale ? (
              <CurrencyField
                control={control}
                name="tax_amount"
                label="Tax Amount"
                allowZero
                hint="Retail price × quantity × 0.06"
                error={errors.tax_amount?.message}
                computedValue={
                  taxManuallyEdited.current ? undefined : autoTax
                }
                onUserEdit={() => {
                  taxManuallyEdited.current = true;
                }}
              />
            ) : (
              <InputField
                label="Tax Amount"
                value="N/A"
                readOnly
                disabled
              />
            )}
            <CheckboxField
              label="Sales and Use Tax Paid"
              disabled
              checked={initial?.sales_and_use_tax_paid ?? false}
              readOnly
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            <InputField
              label="Payment Fee"
              value={formatCurrency(storedPaymentFee)}
              readOnly
              disabled
            />
            <InputField
              label="Payment Type"
              value={
                initial?.credit_debit === "debit" ? (initial.payment_type ?? "—") : "—"
              }
              readOnly
              disabled
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            <InputField
              label="Invoiced Amount"
              value={formatCurrency(invoicedAmount)}
              readOnly
              disabled
              hint="Customer price × qty + shipping + payment fee + tax amount"
            />
          </div>
        </div>

        {/* Payment & status (read-only) */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            <CheckboxField
              label="Invoiced"
              disabled
              checked={initial?.invoiced ?? false}
              readOnly
            />
            <InputField
              label="Invoice ID"
              value={initial?.invoice_id ?? "—"}
              readOnly
              disabled
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            <CheckboxField
              label="Paid"
              disabled
              checked={
                initial?.credit_debit === "debit"
                  ? isLedgerLineFullyPaid(initial)
                  : false
              }
              readOnly
            />
            <InputField
              label="Paid Amount"
              value={
                initial?.credit_debit === "debit"
                  ? formatCurrency(Number(initial.payment_amount ?? 0))
                  : "—"
              }
              readOnly
              disabled
            />
            <InputField
              label="Date Paid"
              value={
                initial?.date_paid && initial.credit_debit === "debit"
                  ? formatDate(initial.date_paid)
                  : "—"
              }
              readOnly
              disabled
            />
            <InputField
              label="Paid To"
              value={
                initial?.credit_debit === "debit" ? (initial.paid_to ?? "—") : "—"
              }
              readOnly
              disabled
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
            <div className="col-span-3 grid grid-cols-3 gap-3">
              <InputField
                label="Outstanding Balance"
                value={
                  outstandingBalance !== null ? formatCurrency(outstandingBalance) : "—"
                }
                readOnly
                disabled
              />
              <CheckboxField
                label="Write Off"
                disabled
                checked={initial?.write_off ?? false}
                readOnly
              />
              <InputField
                label="Write Off Amount"
                value={
                  initial?.credit_debit === "debit"
                    ? formatCurrency(Number(initial.write_off_amount ?? 0))
                    : "—"
                }
                readOnly
                disabled
              />
            </div>
          </div>
        </div>
      </div>

      {needsQuantityColumn ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">One-time setup: add quantity column in Supabase</p>
          <p className="mt-2">
            The app cannot save quantity until this column exists. This is a database change, not
            an app bug.
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5">
            <li>
              Open{" "}
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-800 underline"
              >
                supabase.com/dashboard
              </a>{" "}
              and select your project
            </li>
            <li>
              Click <strong>SQL Editor</strong> → <strong>New query</strong>
            </li>
            <li>
              Copy <strong>only</strong> the SQL below (do not paste this whole yellow box)
            </li>
            <li>
              Click <strong>Run</strong>, then refresh this page and save again
            </li>
          </ol>
          <pre className="mt-3 overflow-x-auto rounded-md border border-amber-200 bg-white p-3 text-xs text-slate-800">
{`ALTER TABLE ledger
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(12, 2) NOT NULL DEFAULT 1;

NOTIFY pgrst, 'reload schema';`}
          </pre>
        </div>
      ) : (
        error && <p className="text-sm text-red-600">{error}</p>
      )}

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
