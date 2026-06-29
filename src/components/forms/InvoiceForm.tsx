"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { normalizeLedgerRow } from "@/lib/ledger-db";
import {
  formatInvoiceId,
  INVOICE_DB_SETUP_SQL,
  isLedgerLineUninvoiced,
  nextInvoiceSequence,
  parseInvoiceDbError,
  poNumbersMatch,
  type InvoiceLineItem,
} from "@/lib/invoice-utils";
import type { Client, Invoice, LedgerEntry } from "@/lib/types";
import { formatCurrency, formatDate, getLedgerInvoicedAmount } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { CheckboxField, InputField, SelectField, TextareaField } from "@/components/ui/FormFields";
import { InvoiceDetailView } from "@/components/invoicing/InvoiceDetailView";

const schema = z.object({
  client_id: z.string().uuid("Select a client"),
  po_number: z.string().min(1, "PO number is required"),
  invoice_date: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface InvoiceFormProps {
  clients: Client[];
  initial?: Invoice | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function InvoiceForm({
  clients,
  initial,
  onSuccess,
  onCancel,
}: InvoiceFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [needsDbSetup, setNeedsDbSetup] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [poOptions, setPoOptions] = useState<string[]>([]);
  const [uninvoicedLines, setUninvoicedLines] = useState<LedgerEntry[]>([]);
  const [invoicedLines, setInvoicedLines] = useState<InvoiceLineItem[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [previewSequence, setPreviewSequence] = useState(1);
  const [loadingLines, setLoadingLines] = useState(false);
  const [currentInvoiceLines, setCurrentInvoiceLines] = useState<InvoiceLineItem[]>([]);
  const [viewInvoice, setViewInvoice] = useState<{
    invoice: Invoice;
    lines: InvoiceLineItem[];
  } | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      client_id: initial?.client_id ?? "",
      po_number: initial?.po_number ?? "",
      invoice_date: initial?.invoice_date ?? new Date().toISOString().slice(0, 10),
      notes: initial?.notes ?? "",
    },
  });

  const clientId = useWatch({ control, name: "client_id" });
  const poNumber = useWatch({ control, name: "po_number" });

  const previewInvoiceId = useMemo(() => {
    if (initial?.invoice_id) return initial.invoice_id;
    if (!poNumber?.trim()) return "—";
    return formatInvoiceId(poNumber, previewSequence);
  }, [initial?.invoice_id, poNumber, previewSequence]);

  const priorInvoices = useMemo(() => {
    const byInvoiceId = new Map<string, InvoiceLineItem[]>();
    for (const line of invoicedLines) {
      if (!line.invoice_id) continue;
      const list = byInvoiceId.get(line.invoice_id) ?? [];
      list.push(line);
      byInvoiceId.set(line.invoice_id, list);
    }
    return Array.from(byInvoiceId.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [invoicedLines]);

  const loadClientData = useCallback(async () => {
    if (!clientId) {
      setPoOptions([]);
      setUninvoicedLines([]);
      setInvoicedLines([]);
      return;
    }

    setLoadingLines(true);
    const supabase = createClient();

    const [{ data: ledgerData, error: ledgerError }, { data: invoiceData }, { data: clientPoData }] =
      await Promise.all([
        supabase.from("ledger").select("*").eq("client_id", clientId),
        supabase
          .from("invoicing")
          .select("po_number, invoice_sequence")
          .eq("client_id", clientId),
        supabase
          .from("client_po_numbers")
          .select("po_number")
          .eq("client_id", clientId)
          .order("po_number", { ascending: true }),
      ]);

    if (ledgerError) {
      setError(ledgerError.message);
      setLoadingLines(false);
      return;
    }

    const pos = new Set<string>();
    for (const row of clientPoData ?? []) {
      if (row.po_number?.trim()) pos.add(row.po_number.trim());
    }
    for (const row of ledgerData ?? []) {
      if (row.po_number?.trim()) pos.add(row.po_number.trim());
    }
    for (const row of invoiceData ?? []) {
      if (row.po_number?.trim()) pos.add(row.po_number.trim());
    }
    setPoOptions(Array.from(pos).sort());

    const allLines = (ledgerData ?? []).map((row) => normalizeLedgerRow(row));
    setUninvoicedLines(allLines.filter((line) => isLedgerLineUninvoiced(line)));
    setInvoicedLines(
      allLines.filter((line) => !isLedgerLineUninvoiced(line)) as InvoiceLineItem[]
    );

    if (poNumber?.trim()) {
      const sequences = (invoiceData ?? [])
        .filter((inv) => poNumbersMatch(inv.po_number, poNumber))
        .map((inv) => Number(inv.invoice_sequence) || 0);
      setPreviewSequence(nextInvoiceSequence(sequences));
    }

    setLoadingLines(false);
  }, [clientId, poNumber]);

  useEffect(() => {
    loadClientData();
  }, [loadClientData]);

  useEffect(() => {
    setSelectedLineIds(new Set());
  }, [clientId, poNumber, initial?.id]);

  useEffect(() => {
    if (!initial?.invoice_id) {
      setCurrentInvoiceLines([]);
      return;
    }
    const supabase = createClient();
    supabase
      .from("ledger")
      .select("*")
      .eq("invoice_id", initial.invoice_id)
      .then(({ data }) => {
        setCurrentInvoiceLines(
          (data ?? []).map((row) => normalizeLedgerRow(row) as InvoiceLineItem)
        );
      });
  }, [initial?.invoice_id]);

  const linesForPo = useMemo(
    () =>
      uninvoicedLines.filter((line) => poNumbersMatch(line.po_number, poNumber)),
    [uninvoicedLines, poNumber]
  );

  const ledgerSummary = useMemo(() => {
    const po = poNumber?.trim();
    if (!po) return null;
    const forClient = uninvoicedLines.length + invoicedLines.length;
    const matchingPo = [...uninvoicedLines, ...invoicedLines].filter((line) =>
      poNumbersMatch(line.po_number, po)
    );
    const noPo = [...uninvoicedLines, ...invoicedLines].filter(
      (line) => !line.po_number?.trim()
    );
    return { forClient, matchingPo: matchingPo.length, noPo: noPo.length };
  }, [uninvoicedLines, invoicedLines, poNumber]);

  function toggleLine(id: string) {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function linkLinesToInvoice(invoiceId: string, lineIds: string[]) {
    const supabase = createClient();
    const { error: ledgerError } = await supabase
      .from("ledger")
      .update({ invoiced: true, invoice_id: invoiceId })
      .in("id", lineIds);

    if (ledgerError) {
      return { ok: false as const, error: ledgerError };
    }

    const { data: linked, error: verifyError } = await supabase
      .from("ledger")
      .select("id")
      .eq("invoice_id", invoiceId)
      .in("id", lineIds);

    if (verifyError) {
      return { ok: false as const, error: verifyError };
    }

    if ((linked ?? []).length !== lineIds.length) {
      return {
        ok: false as const,
        error: {
          message:
            "Ledger items were not linked. Check that invoice_id and invoiced columns exist on the ledger table.",
        },
      };
    }

    return { ok: true as const };
  }

  async function openViewForInvoiceId(invoiceId: string) {
    const supabase = createClient();
    const [{ data: invoiceRow }, { data: lines }] = await Promise.all([
      supabase.from("invoicing").select("*, clients(name)").eq("invoice_id", invoiceId).single(),
      supabase.from("ledger").select("*").eq("invoice_id", invoiceId),
    ]);

    if (!invoiceRow) {
      setError("Could not load invoice details.");
      return;
    }

    setViewInvoice({
      invoice: invoiceRow as Invoice,
      lines: (lines ?? []).map((row) => normalizeLedgerRow(row) as InvoiceLineItem),
    });
  }

  async function onSubmit(values: FormValues) {
    setError(null);
    setNeedsDbSetup(false);
    setSetupMessage(null);
    const supabase = createClient();
    const po = values.po_number.trim();

    if (initial) {
      const invoiceId = initial.invoice_id;
      if (!invoiceId) {
        setError("This invoice has no Invoice ID. Delete it and create a new invoice.");
        return;
      }

      const { error: dbError } = await supabase
        .from("invoicing")
        .update({
          client_id: values.client_id,
          po_number: po,
          invoice_date: values.invoice_date || null,
          notes: values.notes || null,
        })
        .eq("id", initial.id);

      if (dbError) {
        setError(dbError.message);
        return;
      }

      if (selectedLineIds.size > 0) {
        const linkResult = await linkLinesToInvoice(
          invoiceId,
          Array.from(selectedLineIds)
        );
        if (!linkResult.ok) {
          const parsed = parseInvoiceDbError(linkResult.error);
          if (parsed.needsSetup) {
            setNeedsDbSetup(true);
            setSetupMessage(parsed.message);
          } else {
            setError(parsed.message);
          }
          return;
        }
      }

      onSuccess();
      return;
    }

    if (selectedLineIds.size === 0) {
      setError("Select at least one ledger item to include on this invoice.");
      return;
    }

    const { data: existingInvoices } = await supabase
      .from("invoicing")
      .select("invoice_sequence")
      .eq("client_id", values.client_id)
      .eq("po_number", po);

    const sequence = nextInvoiceSequence(
      (existingInvoices ?? []).map((row) => Number(row.invoice_sequence) || 0)
    );
    const invoiceId = formatInvoiceId(po, sequence);

    const { data: newInvoice, error: insertError } = await supabase
      .from("invoicing")
      .insert({
        client_id: values.client_id,
        po_number: po,
        invoice_id: invoiceId,
        invoice_sequence: sequence,
        invoice_date: values.invoice_date || null,
        notes: values.notes || null,
      })
      .select("id")
      .single();

    if (insertError) {
      const parsed = parseInvoiceDbError(insertError);
      if (parsed.needsSetup) {
        setNeedsDbSetup(true);
        setSetupMessage(parsed.message);
      } else {
        setError(parsed.message);
      }
      return;
    }

    if (!newInvoice?.id) {
      setError("Invoice was not created.");
      return;
    }

    const lineIds = Array.from(selectedLineIds);
    const linkResult = await linkLinesToInvoice(invoiceId, lineIds);

    if (!linkResult.ok) {
      await supabase.from("invoicing").delete().eq("id", newInvoice.id);
      const parsed = parseInvoiceDbError(linkResult.error);
      if (parsed.needsSetup) {
        setNeedsDbSetup(true);
        setSetupMessage(parsed.message);
      } else {
        setError(parsed.message);
      }
      return;
    }

    onSuccess();
  }

  return (
    <>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
      >
        <h2 className="text-lg font-semibold text-slate-900">
          {initial ? "Edit Invoice" : "New Invoice"}
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
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

          {poOptions.length > 0 ? (
            <SelectField
              label="PO Number"
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
          ) : (
            <div>
              <p className="text-sm font-medium text-slate-700">PO Number</p>
              <p className="mt-1 text-sm text-amber-800">
                No PO numbers for this client.{" "}
                <Link href="/clients" className="font-medium text-brand-700 underline">
                  Add a PO on the Clients page
                </Link>{" "}
                before creating an invoice.
              </p>
            </div>
          )}

          <InputField
            label="Invoice ID"
            value={previewInvoiceId}
            readOnly
            disabled
            hint="Format: PO Number-sequence (e.g. JOB100-1, JOB100-2)"
          />
          <InputField label="Invoice Date" type="date" {...register("invoice_date")} />
          <TextareaField
            label="Notes"
            className="sm:col-span-2"
            {...register("notes")}
          />
        </div>

        {(initial || (clientId && poNumber)) && (
          <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <h3 className="font-medium text-slate-900">
              {initial ? "Add ledger items to this invoice" : "Include in this invoice"}
            </h3>
            {initial && currentInvoiceLines.length > 0 && (
              <div className="space-y-1 text-sm text-slate-600">
                <p className="font-medium text-slate-800">Already on this invoice:</p>
                <ul className="list-disc pl-5">
                  {currentInvoiceLines.map((line) => (
                    <li key={line.id}>
                      {formatDate(line.entry_date)} —{" "}
                      {line.description?.trim() || "Item"} —{" "}
                      {formatCurrency(getLedgerInvoicedAmount(line))}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-sm text-slate-600">
              {initial
                ? "Select additional uninvoiced items to add:"
                : <>Uninvoiced ledger items for PO <strong>{poNumber}</strong></>}
            </p>
            {loadingLines ? (
              <p className="text-sm text-slate-500">Loading ledger items...</p>
            ) : linesForPo.length === 0 ? (
              <div className="space-y-2 text-sm text-slate-500">
                <p>No uninvoiced ledger items for PO <strong>{poNumber}</strong>.</p>
                {ledgerSummary && ledgerSummary.noPo > 0 && (
                  <p>
                    {ledgerSummary.noPo} ledger item
                    {ledgerSummary.noPo === 1 ? " has" : "s have"} no PO assigned — edit
                    it on the Ledger page and set PO to <strong>{poNumber}</strong>.
                  </p>
                )}
                {ledgerSummary && ledgerSummary.matchingPo > 0 && (
                  <p>
                    {ledgerSummary.matchingPo} item
                    {ledgerSummary.matchingPo === 1 ? " is" : "s are"} already marked
                    invoiced for this PO.
                  </p>
                )}
                {ledgerSummary && ledgerSummary.forClient === 0 && (
                  <p>Add ledger entries for this client first.</p>
                )}
              </div>
            ) : (
              <ul className="space-y-2">
                {linesForPo.map((line) => (
                  <li key={line.id}>
                    <CheckboxField
                      label={`${formatDate(line.entry_date)} — ${line.description?.trim() || "Item"} — ${formatCurrency(getLedgerInvoicedAmount(line))}`}
                      checked={selectedLineIds.has(line.id)}
                      onChange={() => toggleLine(line.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {clientId && (
          <section className="space-y-3 rounded-lg border border-slate-200 p-4">
            <h3 className="font-medium text-slate-900">Previously invoiced</h3>
            {loadingLines ? (
              <p className="text-sm text-slate-500">Loading...</p>
            ) : priorInvoices.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing invoiced for this client.</p>
            ) : (
              <ul className="space-y-2">
                {priorInvoices.map(([invoiceId, lines]) => (
                  <li
                    key={invoiceId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2"
                  >
                    <div className="text-sm">
                      <span className="font-medium text-slate-900">{invoiceId}</span>
                      <span className="text-slate-500">
                        {" "}
                        · {lines.length} item{lines.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => openViewForInvoiceId(invoiceId)}
                    >
                      View Invoice
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {needsDbSetup && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Database setup required for invoicing</p>
            {setupMessage && <p className="mt-2">{setupMessage}</p>}
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
                → SQL Editor → New query
              </li>
              <li>Paste only the SQL below and click Run</li>
              <li>Refresh this page and create the invoice again</li>
            </ol>
            <pre className="mt-3 overflow-x-auto rounded-md border border-amber-200 bg-white p-3 text-xs text-slate-800">
              {INVOICE_DB_SETUP_SQL}
            </pre>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={isSubmitting}>
            {initial ? "Save Changes" : "Create Invoice"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>

      {viewInvoice && (
        <InvoiceDetailView
          invoice={viewInvoice.invoice}
          lines={viewInvoice.lines}
          onClose={() => setViewInvoice(null)}
        />
      )}
    </>
  );
}
