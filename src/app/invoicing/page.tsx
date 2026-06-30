"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { InvoiceForm } from "@/components/forms/InvoiceForm";
import { DeleteInvoiceDialog } from "@/components/invoicing/DeleteInvoiceDialog";
import { InvoiceDetailView } from "@/components/invoicing/InvoiceDetailView";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { SelectField, selectFieldClass } from "@/components/ui/FormFields";
import { createClient } from "@/lib/supabase/client";
import { normalizeLedgerRow, type LedgerDbRow } from "@/lib/ledger-db";
import type { InvoiceLineItem } from "@/lib/invoice-utils";
import { groupLedgerByInvoiceId, isInvoiceFullyPaid, isLedgerLineUninvoiced, summarizeToBeInvoiced } from "@/lib/invoice-utils";
import type { Client, Invoice, LedgerEntry } from "@/lib/types";
import { formatCurrency, formatDate, getLedgerInvoicedAmount, roundMoney } from "@/lib/utils";

type InvoiceView = "outstanding" | "history";

export default function InvoicingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<InvoiceView>("outstanding");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [historyClientId, setHistoryClientId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [prefillClientId, setPrefillClientId] = useState<string | undefined>();
  const [viewInvoice, setViewInvoice] = useState<{
    invoice: Invoice;
    lines: InvoiceLineItem[];
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    invoice: Invoice;
    lines: InvoiceLineItem[];
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [invoiceAmounts, setInvoiceAmounts] = useState<Record<string, number>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [{ data: invoiceData }, { data: clientData }, { data: ledgerData }] =
      await Promise.all([
        supabase
          .from("invoicing")
          .select("*, clients(name, address)")
          .order("created_at", { ascending: false }),
        supabase.from("clients").select("*").order("name", { ascending: true }),
        supabase.from("ledger").select("*, clients(name)"),
      ]);
    setInvoices((invoiceData ?? []) as Invoice[]);
    setClients(clientData ?? []);
    const normalizedLedger = (ledgerData ?? []).map((row) =>
      normalizeLedgerRow(row as LedgerDbRow & Record<string, unknown>)
    );
    setLedgerEntries(normalizedLedger);
    const amounts: Record<string, number> = {};
    for (const entry of normalizedLedger) {
      const invoiceId = entry.invoice_id?.trim();
      if (!invoiceId) continue;
      amounts[invoiceId] = roundMoney(
        (amounts[invoiceId] ?? 0) + getLedgerInvoicedAmount(entry)
      );
    }
    setInvoiceAmounts(amounts);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const uninvoicedEntries = useMemo(
    () => ledgerEntries.filter(isLedgerLineUninvoiced),
    [ledgerEntries]
  );

  const clientsWithUninvoiced = useMemo(() => {
    const byId = new Map<string, string>();
    for (const entry of uninvoicedEntries) {
      if (!entry.client_id) continue;
      const name =
        entry.clients?.name ??
        clients.find((client) => client.id === entry.client_id)?.name ??
        "Unknown client";
      byId.set(entry.client_id, name);
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [uninvoicedEntries, clients]);

  const clientsWithInvoices = useMemo(() => {
    const byId = new Map<string, string>();
    for (const invoice of invoices) {
      if (!invoice.client_id) continue;
      byId.set(
        invoice.client_id,
        invoice.clients?.name ??
          clients.find((client) => client.id === invoice.client_id)?.name ??
          "Unknown client"
      );
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [invoices, clients]);

  const filteredUninvoiced = useMemo(() => {
    if (!selectedClientId) return [];
    return uninvoicedEntries
      .filter((entry) => entry.client_id === selectedClientId)
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }, [uninvoicedEntries, selectedClientId]);

  const clientToBeInvoiced = useMemo(
    () => summarizeToBeInvoiced(filteredUninvoiced),
    [filteredUninvoiced]
  );

  const filteredInvoices = useMemo(() => {
    const rows = historyClientId
      ? invoices.filter((invoice) => invoice.client_id === historyClientId)
      : invoices;
    return rows;
  }, [invoices, historyClientId]);

  const invoicePaidById = useMemo(() => {
    const grouped = groupLedgerByInvoiceId(
      ledgerEntries.filter((entry) => entry.invoice_id) as InvoiceLineItem[]
    );
    const result: Record<string, boolean> = {};
    for (const [invoiceId, lines] of grouped) {
      result[invoiceId] = isInvoiceFullyPaid(lines);
    }
    return result;
  }, [ledgerEntries]);

  const historyInvoiceTotal = useMemo(
    () =>
      roundMoney(
        filteredInvoices.reduce((sum, invoice) => {
          const invoiceId = invoice.invoice_id ?? "";
          return sum + (invoiceAmounts[invoiceId] ?? 0);
        }, 0)
      ),
    [filteredInvoices, invoiceAmounts]
  );

  useEffect(() => {
    if (
      selectedClientId &&
      !clientsWithUninvoiced.some((client) => client.id === selectedClientId)
    ) {
      setSelectedClientId("");
    }
  }, [clientsWithUninvoiced, selectedClientId]);

  useEffect(() => {
    if (
      historyClientId &&
      !clientsWithInvoices.some((client) => client.id === historyClientId)
    ) {
      setHistoryClientId("");
    }
  }, [clientsWithInvoices, historyClientId]);

  async function handleView(invoice: Invoice) {
    const supabase = createClient();
    const { data: lines } = await supabase
      .from("ledger")
      .select("*")
      .eq("invoice_id", invoice.invoice_id);

    setViewInvoice({
      invoice,
      lines: (lines ?? []).map((row) => normalizeLedgerRow(row) as InvoiceLineItem),
    });
  }

  async function handleDeleteClick(invoice: Invoice) {
    const invoiceId = invoice.invoice_id ?? "";
    if (invoicePaidById[invoiceId]) {
      alert("This invoice is fully paid and cannot be deleted.");
      return;
    }

    const supabase = createClient();
    const { data: lines } = await supabase
      .from("ledger")
      .select("*")
      .eq("invoice_id", invoice.invoice_id);

    setDeleteConfirm({
      invoice,
      lines: (lines ?? []).map((row) => normalizeLedgerRow(row) as InvoiceLineItem),
    });
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    setDeleting(true);
    const supabase = createClient();
    const { invoice } = deleteConfirm;

    await supabase
      .from("ledger")
      .update({ invoiced: false, invoice_id: null })
      .eq("invoice_id", invoice.invoice_id);

    const { error } = await supabase.from("invoicing").delete().eq("id", invoice.id);
    setDeleting(false);

    if (error) {
      alert(error.message);
      return;
    }

    setDeleteConfirm(null);
    loadData();
  }

  function openNewInvoice() {
    setEditing(null);
    setPrefillClientId(selectedClientId || undefined);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setPrefillClientId(undefined);
  }

  function renderInvoiceTable(rows: Invoice[]) {
    return (
      <DataTable
        mobileTitleKey="client"
        stickyFirstColumn
        stickyLastColumn
        rowKey={(_, index) => rows[index]?.id ?? String(index)}
        columns={[
          { key: "actions", label: "Actions" },
          { key: "invoiceId", label: "Invoice ID" },
          { key: "client", label: "Client" },
          { key: "po", label: "PO Number" },
          { key: "date", label: "Invoice Date" },
          { key: "notes", label: "Notes" },
          { key: "invoiceAmount", label: "Invoice Amount", className: "text-right" },
          { key: "viewInvoice", label: "View", className: "text-right" },
        ]}
        rows={rows.map((invoice) => {
          const invoiceId = invoice.invoice_id ?? "";
          const isPaid = invoicePaidById[invoiceId] ?? false;
          return {
            actions: (
              <div className="flex w-21 flex-col gap-1.5">
                <Button
                  variant="secondary"
                  className="w-full min-h-[33px] px-3 py-1.5"
                  onClick={() => {
                    setEditing(invoice);
                    setPrefillClientId(undefined);
                    setShowForm(true);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  className="w-full min-h-[33px] px-3 py-1.5"
                  disabled={isPaid}
                  onClick={() => handleDeleteClick(invoice)}
                >
                  Delete
                </Button>
              </div>
            ),
            invoiceId: (
              <span>
                {invoiceId || "—"}
                {isPaid && (
                  <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-xs font-medium text-brand-800">
                    Paid
                  </span>
                )}
              </span>
            ),
            client: invoice.clients?.name ?? "—",
            po: invoice.po_number,
            date: formatDate(invoice.invoice_date),
            notes: invoice.notes ?? "—",
            invoiceAmount: formatCurrency(invoiceAmounts[invoiceId] ?? 0),
            viewInvoice: (
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => handleView(invoice)}>
                  View Invoice
                </Button>
              </div>
            ),
          };
        })}
        emptyMessage="No invoices yet. Create an invoice from uninvoiced ledger items."
      />
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Invoicing"
        description="Create invoices from ledger items. Each invoice gets a unique ID: PO-1, PO-2, …"
      />

      {showForm ? (
        clients.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Add at least one client before creating an invoice.
          </div>
        ) : (
          <InvoiceForm
            key={editing?.id ?? `new-${prefillClientId ?? "none"}`}
            clients={clients}
            initial={editing}
            defaultClientId={prefillClientId}
            onCancel={closeForm}
            onSuccess={() => {
              closeForm();
              loadData();
            }}
          />
        )
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant={view === "outstanding" ? "primary" : "secondary"}
              onClick={() => setView("outstanding")}
            >
              Outstanding
            </Button>
            <Button
              type="button"
              variant={view === "history" ? "primary" : "secondary"}
              onClick={() => setView("history")}
            >
              Invoice History
            </Button>
          </div>

          {view === "outstanding" ? (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Client</span>
                  <div className="mt-1.5 flex flex-row items-center gap-3">
                    <select
                      className={`${selectFieldClass} min-w-0 flex-1`}
                      value={selectedClientId}
                      onChange={(event) => setSelectedClientId(event.target.value)}
                    >
                      <option value="">Select client...</option>
                      {clientsWithUninvoiced.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      className="min-h-11 shrink-0 whitespace-nowrap"
                      disabled={!selectedClientId || loading}
                      onClick={openNewInvoice}
                    >
                      New Invoice
                    </Button>
                  </div>
                  <span className="mt-1.5 block text-xs text-slate-500">
                    Select a client to view uninvoiced items or create a new invoice.
                  </span>
                </label>
              </div>

              {loading ? (
                <p className="text-sm text-slate-500">Loading items...</p>
              ) : clientsWithUninvoiced.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                  <p>No uninvoiced ledger items found.</p>
                  {invoices.length > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-4"
                      onClick={() => setView("history")}
                    >
                      View Invoice History
                    </Button>
                  )}
                </div>
              ) : !selectedClientId ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                  Select a client to view uninvoiced ledger items.
                </div>
              ) : (
                <>
                  <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      To Be Invoiced
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">
                      {formatCurrency(clientToBeInvoiced.amount)}
                    </p>
                    {clientToBeInvoiced.count === 0 ? (
                      <p className="mt-1 text-sm text-slate-600">
                        No outstanding items to be invoiced for this client
                      </p>
                    ) : (
                      <>
                        <p className="mt-1 text-sm text-slate-600">
                          {clientToBeInvoiced.count} outstanding{" "}
                          {clientToBeInvoiced.count === 1 ? "item" : "items"} to be
                          invoiced
                        </p>
                        <Link
                          href="/ledger?uninvoiced=1"
                          className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline"
                        >
                          View in Ledger →
                        </Link>
                      </>
                    )}
                  </div>

                  {filteredUninvoiced.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                      No uninvoiced ledger items for this client.
                    </div>
                  ) : (
                    <DataTable
                      mobileTitleKey="description"
                      rowKey={(_, index) => filteredUninvoiced[index]?.id ?? String(index)}
                      columns={[
                        { key: "date", label: "Date" },
                        { key: "po", label: "PO Number" },
                        { key: "description", label: "Description" },
                        {
                          key: "invoicedAmount",
                          label: "Invoiced Amount",
                          className: "text-right",
                        },
                      ]}
                      rows={filteredUninvoiced.map((entry) => ({
                        date: formatDate(entry.entry_date),
                        po: entry.po_number ?? "—",
                        description: entry.description?.trim() || "—",
                        invoicedAmount: formatCurrency(getLedgerInvoicedAmount(entry)),
                      }))}
                      emptyMessage="No uninvoiced items for this client."
                    />
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <SelectField
                  label="Client"
                  hint="Filter invoice history by client, or leave blank to show all."
                  value={historyClientId}
                  onChange={(event) => setHistoryClientId(event.target.value)}
                >
                  <option value="">All clients</option>
                  {clientsWithInvoices.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </SelectField>
              </div>

              {loading ? (
                <p className="text-sm text-slate-500">Loading invoice history...</p>
              ) : filteredInvoices.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                  <p>No invoices yet.</p>
                  {clientsWithUninvoiced.length > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-4"
                      onClick={() => setView("outstanding")}
                    >
                      View Outstanding
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {historyClientId ? "Filtered invoice total" : "Total invoices shown"}
                    </p>
                    <p className="mt-1 text-xl font-semibold text-slate-900">
                      {formatCurrency(historyInvoiceTotal)}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {filteredInvoices.length}{" "}
                      {filteredInvoices.length === 1 ? "invoice" : "invoices"}
                    </p>
                  </div>
                  {renderInvoiceTable(filteredInvoices)}
                </>
              )}
            </>
          )}
        </>
      )}

      {viewInvoice && (
        <InvoiceDetailView
          invoice={viewInvoice.invoice}
          lines={viewInvoice.lines}
          onClose={() => setViewInvoice(null)}
        />
      )}

      {deleteConfirm && (
        <DeleteInvoiceDialog
          invoice={deleteConfirm.invoice}
          lines={deleteConfirm.lines}
          deleting={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </AppShell>
  );
}
