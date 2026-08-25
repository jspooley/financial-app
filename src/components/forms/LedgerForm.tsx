"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, type Control, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { ledgerFormToDb, normalizeLedgerRow, type LedgerDbRow } from "@/lib/ledger-db";
import { accountMoveFields } from "@/lib/account-move";
import { syncCostCompanions } from "@/lib/cost-companions";
import { syncPaymentCompanionFromParent } from "@/lib/payment-companions";
import { deriveLedgerPaidFlag } from "@/lib/invoice-utils";
import {
  CASHFLOW_ACCOUNTS,
  CASHFLOW_DEPARTMENTS,
  type CashflowAccount,
  type Client,
  type ClientPoNumber,
  type LedgerEntry,
  type Purchaser,
  type TradePartner,
} from "@/lib/types";
import {
  collectClientPoOptions,
  poNumbersForClient,
  poNumbersFromLedgerEntries,
} from "@/lib/client-po-db";
import {
  getLedgerOutstandingBalance,
  isLedgerLineFullyPaid,
  isPaidLedgerRecord,
} from "@/lib/invoice-utils";
import {
  calculateCustomerPrice,
  calculateDesignerCostFromTradePartner,
  calculateRetailPriceFromTradePartner,
  calculateRetailPriceFromMarkup,
  calculateMarkupPercentFromPricing,
  calculateTaxFromCustomerPrice,
  checkingAccountForPurchaser,
  formatCurrency,
  formatPercent,
  formatSandUTaxPercent,
  formatMoneyInput,
  formatDate,
  getLedgerInvoicedAmount,
  getLedgerRetailSubtotal,
  getLedgerTotalDesignerCost,
  roundMoney,
  tradePartnerDiscountPercent,
} from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import {
  CheckboxField,
  fieldClass,
  InputField,
  SelectField,
  TextareaField,
} from "@/components/ui/FormFields";

const schema = z
  .object({
    entry_date: z.string().min(1, "Date is required"),
    designer_cost: z.coerce
      .number({ invalid_type_error: "Designer cost is required" })
      .min(0, "Designer cost cannot be negative")
      .transform(roundMoney),
    quantity: z.coerce
      .number()
      .positive("Quantity must be greater than 0")
      .transform(roundMoney),
    credit_debit: z.enum(["credit", "debit"]),
    description: z.string().trim().min(1, "Description is required"),
    wholesale_retail: z.enum(["wholesale", "retail", "service"]),
    trade_partner_id: z.string().optional(),
    discount_percent: z.coerce
      .number({ invalid_type_error: "Must be a number" })
      .min(0, "Cannot be negative"),
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
    account: z.enum(CASHFLOW_ACCOUNTS, {
      required_error: "Account is required",
    }),
    department: z.enum(CASHFLOW_DEPARTMENTS, {
      required_error: "Department is required",
    }),
    income_statement: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const usesMarkup =
      values.wholesale_retail === "retail" &&
      !(values.trade_partner_id ?? "").trim();
    if (!usesMarkup && values.discount_percent > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Discount cannot exceed 100%",
        path: ["discount_percent"],
      });
    }
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
  const [editText, setEditText] = useState<string | null>(null);

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
          ? (editText ?? "")
          : hasValue
            ? formatMoneyInput(num)
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
                onFocus={() => {
                  setFocused(true);
                  setEditText(hasValue ? formatMoneyInput(num) : "");
                }}
                onChange={(e) => {
                  onUserEdit?.();
                  onValueChange?.();
                  const raw = e.target.value.replace(/[^0-9.]/g, "");
                  const parts = raw.split(".");
                  const normalized =
                    parts.length > 2
                      ? `${parts[0]}.${parts.slice(1).join("")}`
                      : raw;
                  const [whole, fraction] = normalized.split(".");
                  const limited =
                    fraction !== undefined
                      ? `${whole}.${fraction.slice(0, 2)}`
                      : normalized;
                  setEditText(limited);
                  if (limited === "" || limited === ".") {
                    field.onChange(allowZero ? 0 : ("" as unknown as number));
                    return;
                  }
                  const parsed = Number(limited);
                  if (!Number.isNaN(parsed)) field.onChange(parsed);
                }}
                onBlur={() => {
                  if (hasValue) field.onChange(roundMoney(num));
                  setEditText(null);
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
  clientPoNumbers: ClientPoNumber[];
  ledgerEntries?: LedgerEntry[];
  defaultPurchaser?: Purchaser | null;
  initial?: LedgerEntry | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function LedgerForm({
  clients,
  tradePartners,
  clientPoNumbers,
  ledgerEntries = [],
  defaultPurchaser,
  initial,
  onSuccess,
  onCancel,
}: LedgerFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [needsQuantityColumn, setNeedsQuantityColumn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingZeroDiscountValues, setPendingZeroDiscountValues] =
    useState<FormValues | null>(null);
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
        initial != null && initial.designer_cost != null
          ? roundMoney(Number(initial.designer_cost) || 0)
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
      account:
        initial?.account ??
        checkingAccountForPurchaser(defaultPurchaser),
      department: initial?.department ?? "Interior Design",
      income_statement: initial?.income_statement ?? false,
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
  const storedPaymentFee = roundMoney(initial?.payment_fee ?? 0);
  const skipPoReset = useRef(true);
  const previousClientIdRef = useRef<string | null>(null);
  const previousTradePartnerIdRef = useRef<string | null>(null);
  const skipDesignerCostReset = useRef(!!initial);
  const skipRetailFromDesignerReset = useRef(!!initial);
  const designerCostManuallyEdited = useRef(!!initial);
  const retailManuallyEdited = useRef(!!initial);

  const numericQty = Number(quantity) || 0;
  const numericDiscount = Number(discountPercent) || 0;
  const numericShipping = Number(shippingAmount) || 0;
  const numericRetailPrice = Number(retailPrice) || 0;
  const numericDesignerCost = Number(designerCost) || 0;
  const isWholesale = wholesaleRetail === "wholesale";
  const isService = wholesaleRetail === "service";
  const isRetail = wholesaleRetail === "retail";
  const hasTradePartner = Boolean(selectedTradePartnerId);
  /** Retail without a trade partner: % field is markup; customer pays full retail. */
  const usesCostMarkup = isRetail && !hasTradePartner;

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId),
    [clients, selectedClientId]
  );
  const clientSandUTaxRate = Number(selectedClient?.sand_u_tax ?? 0) || 0;
  const isPersonalUse = Boolean(selectedClient?.personal_use);

  const autoTax = useMemo(
    () =>
      isWholesale
        ? calculateTaxFromCustomerPrice(
            numericRetailPrice,
            numericQty,
            numericDiscount,
            clientSandUTaxRate
          )
        : 0,
    [
      isWholesale,
      numericRetailPrice,
      numericQty,
      numericDiscount,
      clientSandUTaxRate,
    ]
  );

  const selectedTradePartner = useMemo(
    () => tradePartners.find((tp) => tp.id === selectedTradePartnerId),
    [tradePartners, selectedTradePartnerId]
  );

  const tradePartnerDiscount = useMemo(
    () =>
      selectedTradePartner ? tradePartnerDiscountPercent(selectedTradePartner) : 0,
    [selectedTradePartner]
  );

  const autoDesignerCost = useMemo(
    () =>
      calculateDesignerCostFromTradePartner(
        numericRetailPrice,
        tradePartnerDiscount
      ),
    [numericRetailPrice, tradePartnerDiscount]
  );

  const autoRetailPrice = useMemo(
    () =>
      calculateRetailPriceFromTradePartner(
        numericDesignerCost,
        tradePartnerDiscount
      ),
    [numericDesignerCost, tradePartnerDiscount]
  );

  const markedUpRetailPrice = useMemo(
    () => calculateRetailPriceFromMarkup(numericDesignerCost, numericDiscount),
    [numericDesignerCost, numericDiscount]
  );

  const effectiveTax = isWholesale ? autoTax : 0;

  const effectiveDesignerCost = isService
    ? numericDesignerCost
    : !hasTradePartner || designerCostManuallyEdited.current
      ? numericDesignerCost
      : autoDesignerCost;

  const effectiveRetailPrice = numericRetailPrice;

  const poOptions = useMemo(() => {
    const registered = poNumbersForClient(clientPoNumbers, selectedClientId);
    const fromLedger = poNumbersFromLedgerEntries(ledgerEntries, selectedClientId);
    return collectClientPoOptions(registered, fromLedger, selectedPoNumber);
  }, [clientPoNumbers, ledgerEntries, selectedClientId, selectedPoNumber]);

  const customerPrice = useMemo(() => {
    if (usesCostMarkup) {
      return roundMoney(numericRetailPrice * numericQty);
    }
    return calculateCustomerPrice(
      numericRetailPrice,
      numericQty,
      numericDiscount
    );
  }, [usesCostMarkup, numericRetailPrice, numericQty, numericDiscount]);

  const invoicedAmount = useMemo(
    () =>
      getLedgerInvoicedAmount({
        retail_price: effectiveRetailPrice,
        quantity: numericQty,
        discount_percent: numericDiscount,
        tax_amount: effectiveTax,
        shipping_receiving_amount: numericShipping,
        wholesale_retail: wholesaleRetail,
        payment_fee: storedPaymentFee,
        balance_sheet: isPersonalUse,
        designer_cost: numericDesignerCost,
        trade_partner_id: selectedTradePartnerId || null,
      }),
    [
      effectiveRetailPrice,
      numericQty,
      numericDiscount,
      effectiveTax,
      numericShipping,
      wholesaleRetail,
      storedPaymentFee,
      isPersonalUse,
      numericDesignerCost,
      selectedTradePartnerId,
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
        retail_price: effectiveRetailPrice,
        quantity: numericQty,
      }),
    [effectiveRetailPrice, numericQty]
  );

  const outstandingBalance = useMemo(() => {
    if (!initial || initial.credit_debit !== "debit") return null;
    return getLedgerOutstandingBalance({
      retail_price: effectiveRetailPrice,
      quantity: numericQty,
      discount_percent: numericDiscount,
      tax_amount: effectiveTax,
      shipping_receiving_amount: numericShipping,
      wholesale_retail: wholesaleRetail,
      designer_cost: numericDesignerCost,
      trade_partner_id: selectedTradePartnerId || null,
      payment_fee: storedPaymentFee,
      payment_amount: initial.payment_amount,
      expense: initial.expense,
      expense_amount: initial.expense_amount,
      variance_accepted: initial.variance_accepted,
      variance_amount: initial.variance_amount,
      // Personal use lines invoice tax only, so the balance must use the same basis.
      balance_sheet: isPersonalUse,
    });
  }, [
    initial,
    effectiveRetailPrice,
    numericQty,
    numericDiscount,
    effectiveTax,
    numericShipping,
    wholesaleRetail,
    numericDesignerCost,
    selectedTradePartnerId,
    storedPaymentFee,
    isPersonalUse,
  ]);

  useEffect(() => {
    setValue("tax_amount", effectiveTax, { shouldValidate: true });
  }, [effectiveTax, setValue]);

  // Retail with no trade partner: retail follows markup when markup is the source.
  useEffect(() => {
    if (!isRetail || hasTradePartner) return;
    if (retailManuallyEdited.current) return;
    if (numericDesignerCost <= 0) return;
    if (Math.abs(numericRetailPrice - markedUpRetailPrice) < 0.005) return;
    setValue("retail_price", markedUpRetailPrice, { shouldValidate: true });
  }, [
    isRetail,
    hasTradePartner,
    numericDesignerCost,
    markedUpRetailPrice,
    numericRetailPrice,
    setValue,
  ]);

  // Retail with no trade partner: markup follows retail when retail is the source.
  useEffect(() => {
    if (!isRetail || hasTradePartner) return;
    if (!retailManuallyEdited.current) return;
    if (numericDesignerCost <= 0 || numericRetailPrice <= 0) return;
    const nextMarkup = Math.max(
      0,
      calculateMarkupPercentFromPricing(numericRetailPrice, numericDesignerCost)
    );
    if (Math.abs(numericDiscount - nextMarkup) < 0.005) return;
    setValue("discount_percent", nextMarkup, { shouldValidate: true });
  }, [
    isRetail,
    hasTradePartner,
    numericDesignerCost,
    numericRetailPrice,
    numericDiscount,
    setValue,
  ]);

  useEffect(() => {
    if (isService) return;
    if (skipDesignerCostReset.current) {
      skipDesignerCostReset.current = false;
      return;
    }
    if (!hasTradePartner) return;
    if (!designerCostManuallyEdited.current && numericRetailPrice > 0) {
      setValue("designer_cost", autoDesignerCost, { shouldValidate: true });
    }
  }, [
    isService,
    hasTradePartner,
    autoDesignerCost,
    numericRetailPrice,
    setValue,
  ]);

  useEffect(() => {
    if (isService) return;
    if (skipRetailFromDesignerReset.current) {
      skipRetailFromDesignerReset.current = false;
      return;
    }
    if (!hasTradePartner) return;
    if (
      designerCostManuallyEdited.current &&
      !retailManuallyEdited.current &&
      numericDesignerCost > 0
    ) {
      setValue("retail_price", autoRetailPrice, { shouldValidate: true });
    }
  }, [
    isService,
    hasTradePartner,
    autoRetailPrice,
    numericDesignerCost,
    setValue,
  ]);

  useEffect(() => {
    if (isService) return;
    const currentTradePartnerId = selectedTradePartnerId ?? "";
    const previousTradePartnerId = previousTradePartnerIdRef.current;
    previousTradePartnerIdRef.current = currentTradePartnerId;
    // Only reset discount when the trade partner actually changes — not on mount/edit open.
    if (previousTradePartnerId === null) return;
    if (previousTradePartnerId === currentTradePartnerId) return;

    setValue("discount_percent", 0, { shouldValidate: true });
    const retail = Number(getValues("retail_price")) || 0;
    const designer = Number(getValues("designer_cost")) || 0;
    if (retail > 0) {
      designerCostManuallyEdited.current = false;
    } else if (designer > 0) {
      retailManuallyEdited.current = false;
      designerCostManuallyEdited.current = true;
    } else {
      designerCostManuallyEdited.current = false;
    }
  }, [isService, selectedTradePartnerId, setValue, getValues]);

  // Wholesale: purchaser is always the trade partner account owner (read-only in the UI).
  useEffect(() => {
    if (!isWholesale) return;
    const owner = selectedTradePartner?.account_owner;
    if (owner === "Jess" || owner === "Molly") {
      setValue("purchaser", owner, { shouldValidate: true });
    }
  }, [isWholesale, selectedTradePartner?.account_owner, setValue]);

  function resetDesignerCostAutoCalc() {
    retailManuallyEdited.current = true;
    designerCostManuallyEdited.current = false;
  }

  function markDesignerCostAsSource() {
    designerCostManuallyEdited.current = true;
    retailManuallyEdited.current = false;
  }

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

  const paidLocked = Boolean(initial && isPaidLedgerRecord(initial));

  async function onSubmit(values: FormValues) {
    const isNoTradeRetail =
      values.wholesale_retail === "retail" &&
      !(values.trade_partner_id ?? "").trim();
    if (
      !initial &&
      values.wholesale_retail !== "service" &&
      !isNoTradeRetail &&
      Math.abs(Number(values.discount_percent) || 0) < 0.005
    ) {
      setPendingZeroDiscountValues(values);
      return;
    }
    await saveEntry(values);
  }

  async function saveEntry(values: FormValues) {
    if (paidLocked) {
      setError("This ledger entry is paid and cannot be edited.");
      return;
    }
    setError(null);
    setNeedsQuantityColumn(false);
    setPendingZeroDiscountValues(null);
    setSaving(true);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      setError("You must be signed in to save. Go to Login and sign in first.");
      return;
    }

    const poNumber = (values.po_number ?? getValues("po_number") ?? "").trim();
    if (!poNumber) {
      setSaving(false);
      setError("PO number is required. Select a PO for this client.");
      return;
    }

    const tradePartner = tradePartners.find((tp) => tp.id === values.trade_partner_id);
    const wholesaleOwner = tradePartner?.account_owner;
    const purchaserForSave =
      values.wholesale_retail === "wholesale" &&
      (wholesaleOwner === "Jess" || wholesaleOwner === "Molly")
        ? wholesaleOwner
        : values.purchaser;

    if (
      values.wholesale_retail === "wholesale" &&
      values.trade_partner_id &&
      wholesaleOwner !== "Jess" &&
      wholesaleOwner !== "Molly"
    ) {
      setSaving(false);
      setError(
        "This trade partner has no account owner. Set Molly or Jess on the Trade Partners page before saving a wholesale line."
      );
      return;
    }

    const personalUse = Boolean(
      clients.find((client) => client.id === values.client_id)?.personal_use
    );

    const payload = {
      ...ledgerFormToDb({
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
        tax_amount: effectiveTax,
        sand_u_tax: clientSandUTaxRate,
        client_id: values.client_id,
        po_number: poNumber,
        purchaser: purchaserForSave,
        department: values.department,
        balance_sheet: personalUse,
      }),
      account: values.account as CashflowAccount,
      income_statement: values.income_statement,
      balance_sheet: personalUse,
      ...(initial
        ? accountMoveFields(initial, values.account as CashflowAccount)
        : {}),
    };

    const paid = deriveLedgerPaidFlag({
      ...(initial ?? {}),
      ...payload,
      variance_accepted: initial?.variance_accepted,
      variance_amount: initial?.variance_amount,
      payment_amount: initial?.payment_amount ?? 0,
      payment_fee: initial?.payment_fee ?? 0,
      expense: initial?.expense,
      expense_amount: initial?.expense_amount,
    });
    const savePayload = { ...payload, paid };

    const { data, error: dbError } = initial
      ? await supabase
          .from("ledger")
          .update(savePayload)
          .eq("id", initial.id)
          .select("*, clients(name)")
          .single()
      : await supabase
          .from("ledger")
          .insert(savePayload)
          .select("*, clients(name)")
          .single();

    if (dbError) {
      setSaving(false);
      if (dbError.message.includes("ledger_invoicing_fk")) {
        setError("PO number must be registered for the selected client.");
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
      setSaving(false);
      setError("Save failed — no row was written. Check that you are signed in.");
      return;
    }

    if (!data.po_number?.trim()) {
      setSaving(false);
      setError(
        "Entry saved but PO number is missing. Select a PO from the list for this client and save again."
      );
      return;
    }

    // Tax and shipping each get their own CoA-classified companion row.
    const savedParent = normalizeLedgerRow(
      data as LedgerDbRow & Record<string, unknown>
    );
    const companionError = await syncCostCompanions(supabase, savedParent);
    if (companionError) {
      setSaving(false);
      setError(companionError);
      return;
    }

    const paymentCompanionError = await syncPaymentCompanionFromParent(
      supabase,
      savedParent
    );
    if (paymentCompanionError) {
      setSaving(false);
      setError(paymentCompanionError);
      return;
    }

    setSaving(false);
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

  return (
    <form
      onSubmit={handleSubmit(onSubmit, onInvalid)}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <h2 className="text-lg font-semibold text-slate-900">
        {initial ? "Edit Ledger Entry" : "New Ledger Entry"}
      </h2>
      {paidLocked ? (
        <p className="text-sm text-amber-800">
          This ledger entry is paid and cannot be edited. Change payments on the
          Payments page.
        </p>
      ) : null}

      <div className="space-y-4">
        {/* Top: client/date/trade partner left, description + PO/wholesale-retail right */}
        <div className="grid gap-4 lg:grid-cols-2 lg:grid-rows-[auto_auto_auto_auto_auto_auto]">
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
            {isPersonalUse && (
              <p className="mt-1.5 text-sm text-slate-600">
                This entry is for personal use only.
              </p>
            )}
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
              label="Department"
              required
              error={errors.department?.message}
              {...register("department")}
            >
              {CASHFLOW_DEPARTMENTS.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="lg:col-start-1 lg:row-start-4">
            <SelectField
              label="Credit / Debit"
              error={errors.credit_debit?.message}
              {...register("credit_debit")}
            >
              <option value="debit">Client Debit</option>
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
              {poOptions.map((po) => (
                <option key={po} value={po}>
                  {po}
                </option>
              ))}
            </SelectField>
            {selectedClientId && poOptions.length === 0 && (
              <p className="text-sm text-amber-800 lg:col-start-2 lg:row-start-4">
                No PO numbers for this client.{" "}
                <Link href="/clients" className="font-medium text-brand-700 underline">
                  Add a PO on the Clients page
                </Link>
                .
              </p>
            )}
          </div>

          <div className="lg:col-start-1 lg:row-start-6">
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
              label="Wholesale / Retail / Service"
              required
              error={errors.wholesale_retail?.message}
              {...register("wholesale_retail")}
            >
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
              <option value="service">Service</option>
            </SelectField>
          </div>
        </div>

        {/* Pricing row: qty, retail price, subtotal */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          <InputField
            label="Quantity"
            type="number"
            step="0.01"
            min="0.01"
            required
            error={errors.quantity?.message}
            {...register("quantity", { valueAsNumber: true })}
          />
          <CurrencyField
            control={control}
            name="retail_price"
            label="Retail Price"
            required
            hint={
              isService
                ? "Customer-facing service price before discount %."
                : hasTradePartner
                  ? `Enter retail, or enter designer cost to auto-fill as designer ÷ (1 − ${formatPercent(tradePartnerDiscount)}).`
                  : "No trade partner: set retail or markup % (customer pays full retail × qty)."
            }
            error={errors.retail_price?.message}
            onValueChange={isService ? undefined : resetDesignerCostAutoCalc}
          />
          <InputField
            label="Retail Price × Qty"
            value={formatCurrency(retailSubtotal)}
            readOnly
            disabled
          />
        </div>

        {/* Cost row: purchaser, account, designer cost, total designer cost */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          <SelectField
            label="Purchaser"
            required
            error={errors.purchaser?.message}
            hint={
              isWholesale
                ? selectedTradePartner?.account_owner
                  ? "Locked to the trade partner account owner for wholesale."
                  : "Select a trade partner with an account owner (Molly or Jess)."
                : undefined
            }
            {...register("purchaser")}
            disabled={isWholesale}
          >
            <option value="Jess">Jess</option>
            <option value="Molly">Molly</option>
          </SelectField>
          <SelectField
            label="Account"
            required
            error={errors.account?.message}
            hint="Defaults to the signed-in user's checking account."
            {...register("account")}
          >
            {CASHFLOW_ACCOUNTS.map((account) => (
              <option key={account} value={account}>
                {account}
              </option>
            ))}
          </SelectField>
          <CurrencyField
            control={control}
            name="designer_cost"
            label="Designer Cost"
            allowZero
            hint={
              isService
                ? "Optional. Use 0 when the service has no designer cost."
                : hasTradePartner
                  ? `From retail: retail × (1 − ${formatPercent(tradePartnerDiscount)}). Or enter 0 when there is no designer cost.`
                  : "Enter cost, or 0 when there is no designer cost. Markup % or retail sets the sell price."
            }
            error={errors.designer_cost?.message}
            computedValue={
              isService ||
              !hasTradePartner ||
              designerCostManuallyEdited.current
                ? undefined
                : autoDesignerCost
            }
            onUserEdit={isService ? undefined : markDesignerCostAsSource}
            onValueChange={isService ? undefined : markDesignerCostAsSource}
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
              hint={
                usesCostMarkup
                  ? "= Retail Price × Qty (full retail)"
                  : "=( Retail Price x Qty ) x (1 - Discount %)"
              }
            />
            <div>
              <InputField
                label={usesCostMarkup ? "Markup (%)" : "Discount (%)"}
                type="number"
                step="0.01"
                min="0"
                max={usesCostMarkup ? undefined : 100}
                required
                hint={
                  isService
                    ? "0% = customer pays full retail. Applied as (retail × qty) × (1 − discount %)."
                    : isRetail && !hasTradePartner
                      ? "((retail − designer) ÷ designer) × 100. Edit to set retail from cost, or set retail to auto-fill."
                      : hasTradePartner
                        ? "Applied to retail for customer price. Defaults to 0%."
                        : "Applied to retail for customer price."
                }
                error={errors.discount_percent?.message}
                {...register("discount_percent", {
                  setValueAs: (value) => {
                    if (value === "" || value == null) return 0;
                    const n = Number(value);
                    return Number.isFinite(n) ? n : 0;
                  },
                  onChange: () => {
                    if (isRetail && !hasTradePartner) {
                      retailManuallyEdited.current = false;
                    }
                  },
                })}
              />
              {!isService && tradePartnerDiscount > 0 ? (
                <p className="mt-1 text-sm text-slate-600">
                  Trade discount:{" "}
                  <span className="font-medium text-slate-800">
                    {formatPercent(tradePartnerDiscount)}
                  </span>
                </p>
              ) : null}
            </div>
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
            <InputField
              label="Tax Amount"
              value={isWholesale ? formatCurrency(effectiveTax) : "N/A"}
              readOnly
              disabled
              hint={
                isWholesale
                  ? selectedClient
                    ? `Customer price × qty × client S&U tax (${formatSandUTaxPercent(clientSandUTaxRate)})`
                    : "Select a client to apply their S&U tax rate"
                  : undefined
              }
            />
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
              hint={
                isPersonalUse
                  ? "Personal use: tax amount only"
                  : "Customer price × qty + shipping + payment fee + tax amount"
              }
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
                label="Expense"
                disabled
                checked={initial?.expense ?? false}
                readOnly
              />
              <InputField
                label="Expense Amount"
                value={
                  initial?.credit_debit === "debit"
                    ? formatCurrency(Number(initial.expense_amount ?? 0))
                    : "—"
                }
                readOnly
                disabled
              />
              <CheckboxField
                label="Variance Accepted"
                disabled
                checked={initial?.variance_accepted ?? false}
                readOnly
              />
              <InputField
                label="Variance Amount"
                value={
                  initial?.credit_debit === "debit"
                    ? formatCurrency(Number(initial.variance_amount ?? 0))
                    : "—"
                }
                readOnly
                disabled
              />
              {(initial?.variance_accepted ||
                Math.abs(Number(initial?.variance_amount ?? 0)) >= 0.005) && (
                <div className="col-span-3">
                  <InputField
                    label="Variance Notes"
                    value={initial?.variance_notes?.trim() || "—"}
                    readOnly
                    disabled
                  />
                </div>
              )}
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
        <Button type="submit" loading={isSubmitting || saving} disabled={paidLocked}>
          {initial ? "Save Changes" : "Create Entry"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {pendingZeroDiscountValues && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="zero-discount-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2
              id="zero-discount-title"
              className="text-lg font-semibold text-slate-900"
            >
              Confirm 0% discount?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Discount is set to 0%. Save this new ledger entry with no customer
              discount?
            </p>
            {tradePartnerDiscount > 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                Trade partner discount is{" "}
                <span className="font-medium text-slate-800">
                  {formatPercent(tradePartnerDiscount)}
                </span>
                .
              </p>
            ) : null}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPendingZeroDiscountValues(null)}
              >
                Go back
              </Button>
              <Button
                type="button"
                loading={saving}
                onClick={() => void saveEntry(pendingZeroDiscountValues)}
              >
                Yes — save with 0%
              </Button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
