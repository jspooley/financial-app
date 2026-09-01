"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { collectClientPoOptions } from "@/lib/client-po-db";
import { cashflowClassificationFlags, isRecordedTransferCoa } from "@/lib/coa";
import { accountMoveFields, personalCardRoleFields } from "@/lib/account-move";
import { normalizeInvoiceId, poNumbersMatch } from "@/lib/invoice-utils";
import { normalizeLedgerRow } from "@/lib/ledger-db";
import {
  deletePartnerTransferMate,
  syncPartnerTransferMate,
} from "@/lib/partner-transfer";
import {
  deleteCardReimburseMate,
  isCheckingCardReimbursement,
  syncCardReimburseMate,
} from "@/lib/card-reimbursement";
import {
  CASHFLOW_ACCOUNTS,
  CASHFLOW_DEPARTMENTS,
  type ChartOfAccount,
  type LedgerEntry,
  type Purchaser,
} from "@/lib/types";
import { Button } from "@/components/ui/Button";
import {
  InputField,
  SelectField,
  TextareaField,
} from "@/components/ui/FormFields";
import { checkingAccountForPurchaser, formatMoneyInput, roundMoney } from "@/lib/utils";

const schema = z
  .object({
    entry_date: z.string().min(1, "Date is required"),
    department: z
      .string()
      .min(1, "Choose a department")
      .refine(
        (value): value is (typeof CASHFLOW_DEPARTMENTS)[number] =>
          (CASHFLOW_DEPARTMENTS as readonly string[]).includes(value),
        "Choose a department"
      ),
    description: z.string().optional(),
    debit_amount: z.coerce.number().min(0, "Debit must be 0 or greater"),
    credit_amount: z.coerce.number().min(0, "Credit must be 0 or greater"),
    account: z.enum(CASHFLOW_ACCOUNTS),
    designer: z.enum(["Jess", "Molly"]),
    coa_category: z.string().min(1, "Chart of Accounts category is required"),
    invoice_id: z.string().optional(),
    paid_to: z.enum(["", "Jess", "Molly"]),
  })
  .refine((values) => values.debit_amount > 0 || values.credit_amount > 0, {
    message: "Enter a debit amount, credit amount, or both",
    path: ["debit_amount"],
  });

type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

type InvoiceOptionRow = {
  client_id: string;
  po_number: string;
  invoice_id: string;
};

interface ExpenseFormProps {
  initial?: LedgerEntry | null;
  chartOfAccounts?: ChartOfAccount[];
  defaultDesigner?: Purchaser;
  onSuccess: () => void;
  onCancel: () => void;
  onDeleted?: () => void;
  onReassignCardCharges?: () => void;
}

function uniqueInvoiceIds(rows: InvoiceOptionRow[], clientId: string, poNumber: string) {
  const ids = new Set<string>();
  for (const row of rows) {
    if (clientId && row.client_id !== clientId) continue;
    if (poNumber && !poNumbersMatch(row.po_number, poNumber)) continue;
    const id = normalizeInvoiceId(row.invoice_id);
    if (id) ids.add(id);
  }
  return [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function ExpenseForm({
  initial,
  chartOfAccounts = [],
  defaultDesigner = "Jess",
  onSuccess,
  onCancel,
  onDeleted,
  onReassignCardCharges,
}: ExpenseFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [invoiceRows, setInvoiceRows] = useState<InvoiceOptionRow[]>([]);
  const [clientId, setClientId] = useState("");
  const [poNumber, setPoNumber] = useState("");

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      entry_date: initial?.entry_date ?? new Date().toISOString().slice(0, 10),
      department: initial?.department ?? "",
      description: initial?.description ?? "",
      debit_amount: initial?.debit_amount ?? 0,
      credit_amount: initial?.credit_amount ?? 0,
      account: initial?.account ?? checkingAccountForPurchaser(defaultDesigner),
      designer: initial?.purchaser ?? defaultDesigner,
      coa_category: initial?.coa_category ?? "",
      invoice_id: initial?.invoice_id ?? "",
      paid_to:
        initial?.paid_to === "Jess" || initial?.paid_to === "Molly"
          ? initial.paid_to
          : "",
    },
  });

  const invoiceId = useWatch({ control, name: "invoice_id" }) ?? "";
  const coaCategory = useWatch({ control, name: "coa_category" }) ?? "";
  const showPaidTo = isRecordedTransferCoa(coaCategory);

  useEffect(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.from("clients").select("id, name").order("name", { ascending: true }),
      supabase.from("client_po_numbers").select("client_id, po_number"),
      supabase.from("invoicing").select("client_id, po_number, invoice_id"),
      supabase
        .from("ledger")
        .select("client_id, po_number, invoice_id")
        .not("invoice_id", "is", null),
    ]).then(([clientRes, poRes, invoiceRes, ledgerRes]) => {
      setClients((clientRes.data ?? []) as Array<{ id: string; name: string }>);

      const rows: InvoiceOptionRow[] = [];
      const sources: Array<
        Array<{
          client_id?: string | null;
          po_number?: string | null;
          invoice_id?: string | null;
        }>
      > = [
        poRes.data ?? [],
        invoiceRes.data ?? [],
        ledgerRes.data ?? [],
      ];
      for (const source of sources) {
        for (const row of source) {
          const client = String(row.client_id ?? "");
          const po = String(row.po_number ?? "").trim();
          const invoice = normalizeInvoiceId(row.invoice_id ?? null);
          if (!invoice && !client) continue;
          rows.push({
            client_id: client,
            po_number: po,
            invoice_id: invoice,
          });
        }
      }
      setInvoiceRows(rows);

      const existingInvoice = normalizeInvoiceId(initial?.invoice_id);
      if (!existingInvoice) return;
      const match = rows.find(
        (row) => normalizeInvoiceId(row.invoice_id) === existingInvoice
      );
      if (match) {
        setClientId(match.client_id);
        setPoNumber(match.po_number);
      }
    });
  }, [initial?.invoice_id]);

  const poOptions = useMemo(() => {
    if (!clientId) return [];
    return collectClientPoOptions(
      invoiceRows
        .filter((row) => row.client_id === clientId)
        .map((row) => row.po_number)
    );
  }, [clientId, invoiceRows]);

  const invoiceOptions = useMemo(() => {
    const options = uniqueInvoiceIds(invoiceRows, clientId, poNumber);
    const current = normalizeInvoiceId(invoiceId);
    if (current && !options.includes(current)) options.unshift(current);
    return options;
  }, [clientId, poNumber, invoiceRows, invoiceId]);

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    setPoNumber("");
    setValue("invoice_id", "");
  }

  function handlePoChange(nextPo: string) {
    setPoNumber(nextPo);
    setValue("invoice_id", "");
  }

  async function onSubmit(values: FormValues) {
    setError(null);
    const debit = roundMoney(values.debit_amount);
    const credit = roundMoney(values.credit_amount);
    const supabase = createClient();
    const payload = {
      entry_date: values.entry_date,
      department: values.department,
      // Classification is CoA Category; stop writing the duplicate expense_type.
      expense_type: null,
      description: values.description?.trim() || null,
      debit_amount: debit,
      credit_amount: credit,
      ...(initial
        ? {
            ...accountMoveFields(initial, values.account),
            ...personalCardRoleFields(initial, values.account),
          }
        : { account: values.account }),
      purchaser: values.designer,
      coa_category: values.coa_category,
      ...cashflowClassificationFlags(values.coa_category),
      credit_debit: debit >= credit ? ("debit" as const) : ("credit" as const),
      designer_cost: 0,
      quantity: 1,
      wholesale_retail: "retail" as const,
      trade_partner_id: null,
      discount_percent: 0,
      shipping_receiving_amount: 0,
      receiving_amount: 0,
      retail_price: 0,
      tax_amount: 0,
      client_id: null,
      po_number: null,
      expense_amount: 0,
      invoice_id: values.invoice_id?.trim() || null,
      paid_to:
        values.paid_to === "Jess" || values.paid_to === "Molly"
          ? values.paid_to
          : null,
    };

    const { data: saved, error: dbError } = initial
      ? await supabase
          .from("ledger")
          .update(payload)
          .eq("id", initial.id)
          .select("*")
          .single()
      : await supabase.from("ledger").insert(payload).select("*").single();

    if (dbError) {
      setError(dbError.message);
      return;
    }

    const mateError = saved
      ? await syncPartnerTransferMate(supabase, normalizeLedgerRow(saved))
      : null;
    if (mateError) {
      setError(mateError);
      return;
    }
    const cardMateError = saved
      ? await syncCardReimburseMate(supabase, normalizeLedgerRow(saved))
      : null;
    if (cardMateError) {
      setError(cardMateError);
      return;
    }

    onSuccess();
  }

  async function handleDelete() {
    if (!initial) return;
    const label = initial.description?.trim() || initial.entry_date;
    if (!confirm(`Delete cashflow entry "${label}"?`)) return;

    setError(null);
    setDeleting(true);
    const supabase = createClient();
    const mateError = await deletePartnerTransferMate(supabase, initial.id);
    if (mateError) {
      setDeleting(false);
      setError(mateError);
      return;
    }
    const cardMateError = await deleteCardReimburseMate(supabase, initial.id);
    if (cardMateError) {
      setDeleting(false);
      setError(cardMateError);
      return;
    }
    const { error: dbError } = await supabase
      .from("ledger")
      .delete()
      .eq("id", initial.id);
    setDeleting(false);

    if (dbError) {
      setError(dbError.message);
      return;
    }

    (onDeleted ?? onSuccess)();
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <h2 className="text-lg font-semibold text-slate-900">
        {initial ? "Edit Cashflow Entry" : "New Cashflow Entry"}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          label="Date"
          type="date"
          required
          error={errors.entry_date?.message}
          {...register("entry_date")}
        />
        <SelectField
          label="Designer"
          required
          error={errors.designer?.message}
          {...register("designer")}
        >
          <option value="Jess">Jess</option>
          <option value="Molly">Molly</option>
        </SelectField>
        <SelectField
          label="Department"
          required
          error={errors.department?.message}
          {...register("department")}
        >
          <option value="">Choose Department</option>
          {CASHFLOW_DEPARTMENTS.map((department) => (
            <option key={department} value={department}>
              {department}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Account"
          required
          error={errors.account?.message}
          {...register("account")}
        >
          {CASHFLOW_ACCOUNTS.map((account) => (
            <option key={account} value={account}>
              {account}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="CoA Category"
          required
          error={errors.coa_category?.message}
          hint={
            chartOfAccounts.length === 0
              ? "Add categories on the Chart of Accounts page first."
              : undefined
          }
          {...register("coa_category")}
        >
          <option value="">Select category...</option>
          {chartOfAccounts.map((entry) => (
            <option key={entry.id} value={entry.category}>
              {entry.category}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Client"
          value={clientId}
          onChange={(event) => handleClientChange(event.target.value)}
          hint="Optional. Choose a client to link this entry to a sales invoice."
        >
          <option value="">None</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="PO"
          value={poNumber}
          onChange={(event) => handlePoChange(event.target.value)}
          hint={
            clientId && poOptions.length === 0
              ? "No POs for this client yet."
              : "POs for the selected client."
          }
          disabled={!clientId}
        >
          <option value="">{clientId ? "Select PO..." : "Select a client first"}</option>
          {poOptions.map((po) => (
            <option key={po} value={po}>
              {po}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Invoice"
          error={errors.invoice_id?.message}
          value={invoiceId}
          onChange={(event) => setValue("invoice_id", event.target.value)}
          hint="Optional. Link this cashflow row to a sales invoice (for example MJ-WD-202608-1). Client and PO can narrow the list."
        >
          <option value="">None</option>
          {invoiceOptions.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </SelectField>
        {showPaidTo ? (
          <SelectField
            label="Paid To"
            error={errors.paid_to?.message}
            hint="Who received this transfer. Sending to the other partner also posts the matching amount on their checking account."
            {...register("paid_to")}
          >
            <option value="">Not tagged</option>
            <option value="Jess">Jess</option>
            <option value="Molly">Molly</option>
          </SelectField>
        ) : null}
        <InputField
          label="Debit Amount"
          type="number"
          step="0.01"
          min="0"
          error={errors.debit_amount?.message}
          {...register("debit_amount", {
            setValueAs: (value) => {
              if (value === "" || value == null) return 0;
              return Number(value);
            },
          })}
          onFocus={(event) => {
            event.currentTarget.value = formatMoneyInput(
              Number(event.currentTarget.value) || 0
            );
          }}
        />
        <InputField
          label="Credit Amount"
          type="number"
          step="0.01"
          min="0"
          error={errors.credit_amount?.message}
          {...register("credit_amount", {
            setValueAs: (value) => {
              if (value === "" || value == null) return 0;
              return Number(value);
            },
          })}
          onFocus={(event) => {
            event.currentTarget.value = formatMoneyInput(
              Number(event.currentTarget.value) || 0
            );
          }}
        />
      </div>

      <TextareaField
        label="Description"
        rows={3}
        error={errors.description?.message}
        {...register("description")}
      />

      {initial && isCheckingCardReimbursement(initial) && onReassignCardCharges ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
          <p className="text-sm font-medium text-amber-950">
            Card purchases on this repayment
          </p>
          <p className="mt-1 text-xs text-amber-900/80">
            Choose which card purchases this checking 308 paid. Boxes start
            unchecked. Check the same purchase to keep it, pick another, or
            cancel the picker to leave the saved match.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3 min-h-[33px] px-3 py-1.5"
            onClick={onReassignCardCharges}
            disabled={isSubmitting || deleting}
          >
            Reassign Card Charges
          </Button>
        </div>
      ) : null}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting || deleting}>
          {isSubmitting ? "Saving..." : initial ? "Save Changes" : "Add Entry"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={isSubmitting || deleting}
        >
          Cancel
        </Button>
        {initial && onDeleted && (
          <Button
            type="button"
            variant="danger"
            onClick={() => void handleDelete()}
            disabled={isSubmitting || deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        )}
      </div>
    </form>
  );
}
