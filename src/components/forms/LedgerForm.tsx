"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { ledgerFormToDb } from "@/lib/ledger-db";
import type { Client, Invoice, LedgerEntry, Purchaser, TradePartner } from "@/lib/types";
import {
  calculateCustomerPrice,
  calculateTaxFromRetailPrice,
  defaultLedgerDiscountPercent,
  formatCurrency,
  getLedgerInvoicedAmount,
} from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import {
  CheckboxField,
  InputField,
  SelectField,
  TextareaField,
} from "@/components/ui/FormFields";

const schema = z.object({
  entry_date: z.string().min(1, "Date is required"),
  designer_cost: z.coerce
    .number({ invalid_type_error: "Designer cost is required" })
    .positive("Designer cost must be greater than 0"),
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be at least 1"),
  credit_debit: z.enum(["credit", "debit"]),
  description: z.string().optional(),
  wholesale_retail: z.enum(["wholesale", "retail"]),
  trade_partner_id: z.string().optional(),
  discount_percent: z.coerce
    .number()
    .min(0)
    .max(100, "Discount cannot exceed 100%"),
  shipping_receiving_amount: z.coerce.number().min(0),
  retail_price: z.coerce
    .number({ invalid_type_error: "Retail price is required" })
    .positive("Retail price must be greater than 0"),
  tax_amount: z.coerce.number().min(0),
  invoiced: z.boolean(),
  sales_and_use_tax_paid: z.boolean(),
  client_id: z.string().uuid("Select a client"),
  po_number: z.string().optional(),
  purchaser: z.enum(["Jess", "Molly"]),
});

type FormValues = z.infer<typeof schema>;

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
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      entry_date: initial?.entry_date ?? new Date().toISOString().slice(0, 10),
      designer_cost: initial?.designer_cost ?? ("" as unknown as number),
      quantity: initial?.quantity ?? 1,
      credit_debit: initial?.credit_debit ?? "debit",
      description: initial?.description ?? "",
      wholesale_retail: initial?.wholesale_retail ?? "retail",
      trade_partner_id: initial?.trade_partner_id ?? "",
      discount_percent: initial?.discount_percent ?? 0,
      shipping_receiving_amount: initial?.shipping_receiving_amount ?? 0,
      retail_price: initial?.retail_price ?? ("" as unknown as number),
      tax_amount: initial?.tax_amount ?? 0,
      invoiced: initial?.invoiced ?? false,
      sales_and_use_tax_paid: initial?.sales_and_use_tax_paid ?? false,
      client_id: initial?.client_id ?? "",
      po_number: initial?.po_number ?? "",
      purchaser: initial?.purchaser ?? defaultPurchaser ?? "Jess",
    },
  });

  const selectedClientId = useWatch({ control, name: "client_id" });
  const selectedTradePartnerId = useWatch({ control, name: "trade_partner_id" });
  const quantity = useWatch({ control, name: "quantity" });
  const discountPercent = useWatch({ control, name: "discount_percent" });
  const wholesaleRetail = useWatch({ control, name: "wholesale_retail" });
  const shippingAmount = useWatch({ control, name: "shipping_receiving_amount" });
  const retailPrice = useWatch({ control, name: "retail_price" });
  const taxAmount = useWatch({ control, name: "tax_amount" });
  const skipPoReset = useRef(true);
  const skipDiscountReset = useRef(!!initial);
  const taxManuallyEdited = useRef(false);

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

  const effectiveTax = isWholesale
    ? taxManuallyEdited.current
      ? Number(taxAmount) || 0
      : autoTax
    : 0;

  const clientInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.client_id === selectedClientId),
    [invoices, selectedClientId]
  );

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
        payment_fee: initial?.payment_fee ?? 0,
      }),
    [
      numericRetailPrice,
      numericQty,
      numericDiscount,
      effectiveTax,
      numericShipping,
      wholesaleRetail,
      initial?.payment_fee,
    ]
  );

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
  }, [selectedTradePartnerId, tradePartners, setValue]);

  useEffect(() => {
    if (skipPoReset.current) {
      skipPoReset.current = false;
      return;
    }
    setValue("po_number", "");
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
      invoiced: initial ? initial.invoiced : false,
      sales_and_use_tax_paid: values.sales_and_use_tax_paid,
      client_id: values.client_id,
      po_number: values.po_number,
      purchaser: values.purchaser,
    });

    const { data, error: dbError } = initial
      ? await supabase.from("ledger").update(payload).eq("id", initial.id).select("id").single()
      : await supabase.from("ledger").insert(payload).select("id").single();

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

  const toBool = (value: unknown) => value === true || value === "on";

  function resetAutoTax() {
    taxManuallyEdited.current = false;
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit, onInvalid)}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <h2 className="text-lg font-semibold text-slate-900">
        {initial ? "Edit Ledger Entry" : "New Ledger Entry"}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          label="Date"
          type="date"
          error={errors.entry_date?.message}
          {...register("entry_date")}
        />
        <InputField
          label="Designer Cost"
          type="number"
          step="0.01"
          min="0.01"
          required
          placeholder="0.00"
          error={errors.designer_cost?.message}
          {...register("designer_cost", { valueAsNumber: true })}
        />
        <InputField
          label="Quantity"
          type="number"
          step="1"
          min="1"
          error={errors.quantity?.message}
          {...register("quantity", {
            valueAsNumber: true,
            onChange: resetAutoTax,
          })}
        />
        <SelectField
          label="Credit / Debit"
          error={errors.credit_debit?.message}
          {...register("credit_debit")}
        >
          <option value="debit">Debit (expense)</option>
          <option value="credit">Credit (receivable)</option>
        </SelectField>
        <SelectField
          label="Wholesale / Retail"
          error={errors.wholesale_retail?.message}
          {...register("wholesale_retail", { onChange: resetAutoTax })}
        >
          <option value="retail">Retail</option>
          <option value="wholesale">Wholesale</option>
        </SelectField>
        <SelectField
          label="Client"
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
        <SelectField label="PO Number" {...register("po_number")}>
          <option value="">No PO / not invoiced</option>
          {clientInvoices.map((invoice) => (
            <option key={invoice.id} value={invoice.po_number}>
              {invoice.po_number}
            </option>
          ))}
        </SelectField>
        <SelectField label="Trade Partner" {...register("trade_partner_id")}>
          <option value="">No trade partner</option>
          {tradePartners.map((partner) => (
            <option key={partner.id} value={partner.id}>
              {partner.company_name}
            </option>
          ))}
        </SelectField>
        <InputField
          label="Discount (%)"
          type="number"
          step="0.01"
          min="0"
          max="100"
          hint="Defaults to half of the trade partner discount. You can override."
          error={errors.discount_percent?.message}
          {...register("discount_percent", { valueAsNumber: true })}
        />
        <InputField
          label="Retail Price"
          type="number"
          step="0.01"
          min="0.01"
          required
          placeholder="0.00"
          hint="Used to calculate tax: retail price × quantity × 0.06."
          error={errors.retail_price?.message}
          {...register("retail_price", {
            valueAsNumber: true,
            onChange: resetAutoTax,
          })}
        />
        <InputField
          label="Shipping"
          type="number"
          step="0.01"
          error={errors.shipping_receiving_amount?.message}
          {...register("shipping_receiving_amount")}
        />
        {isWholesale ? (
          <Controller
            name="tax_amount"
            control={control}
            render={({ field }) => (
              <InputField
                label="Tax Amount"
                type="number"
                step="0.01"
                hint="Auto-calculated: retail price × quantity × 0.06. You can override."
                error={errors.tax_amount?.message}
                name={field.name}
                value={
                  taxManuallyEdited.current ? Number(field.value) || 0 : autoTax
                }
                onChange={(event) => {
                  taxManuallyEdited.current = true;
                  field.onChange(event.target.valueAsNumber || 0);
                }}
                onBlur={field.onBlur}
                ref={field.ref}
              />
            )}
          />
        ) : (
          <InputField
            label="Tax Amount"
            value="N/A"
            readOnly
            disabled
            hint="Tax is not applied to retail items."
          />
        )}
        <InputField
          label="Customer Price × Qty"
          value={formatCurrency(customerPrice)}
          readOnly
          disabled
          hint="(Retail price × qty) − (Discount % × retail price × qty)"
        />
        <InputField
          label="Invoiced Amount"
          value={formatCurrency(invoicedAmount)}
          readOnly
          disabled
          hint="Customer price + tax + shipping + payment fee"
          className="sm:col-span-2"
        />
        <CheckboxField
          label="Invoiced"
          hint="Set automatically when you include this item on an invoice (Invoicing page). Cannot be changed here."
          disabled
          checked={initial?.invoiced ?? false}
          readOnly
        />
        <CheckboxField
          label="Sales and Use Tax Paid"
          hint="Not saved to the database yet. Run the SQL below in Supabase to enable."
          className="sm:col-span-2"
          error={errors.sales_and_use_tax_paid?.message}
          {...register("sales_and_use_tax_paid", { setValueAs: toBool })}
        />
        <SelectField
          label="Purchaser"
          error={errors.purchaser?.message}
          {...register("purchaser")}
        >
          <option value="Jess">Jess</option>
          <option value="Molly">Molly</option>
        </SelectField>
        <TextareaField
          label="Description"
          className="sm:col-span-2"
          {...register("description")}
        />
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
