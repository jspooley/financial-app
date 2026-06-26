"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { InvoiceForm } from "@/components/forms/InvoiceForm";
import { DeleteInvoiceDialog } from "@/components/invoicing/DeleteInvoiceDialog";
import { InvoiceDetailView } from "@/components/invoicing/InvoiceDetailView";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/client";
import { normalizeLedgerRow } from "@/lib/ledger-db";
import type { InvoiceLineItem } from "@/lib/invoice-utils";
import type { Client, Invoice } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export default function InvoicingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [viewInvoice, setViewInvoice] = useState<{
    invoice: Invoice;
    lines: InvoiceLineItem[];
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    invoice: Invoice;
    lines: InvoiceLineItem[];
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [{ data: invoiceData }, { data: clientData }] = await Promise.all([
      supabase
        .from("invoicing")
        .select("*, clients(name, address)")
        .order("created_at", { ascending: false }),
      supabase.from("clients").select("*").order("name", { ascending: true }),
    ]);
    setInvoices((invoiceData ?? []) as Invoice[]);
    setClients(clientData ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  return (
    <AppShell>
      <PageHeader
        title="Invoicing"
        description="Create invoices from ledger items. Each invoice gets a unique ID: PO-1, PO-2, …"
        action={
          !showForm && (
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              New Invoice
            </Button>
          )
        }
      />

      {showForm ? (
        clients.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Add at least one client before creating an invoice.
          </div>
        ) : (
          <InvoiceForm
            key={editing?.id ?? "new"}
            clients={clients}
            initial={editing}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
            onSuccess={() => {
              setShowForm(false);
              setEditing(null);
              loadData();
            }}
          />
        )
      ) : loading ? (
        <p className="text-sm text-slate-500">Loading invoices...</p>
      ) : (
        <DataTable
          stickyLastColumn
          rowKey={(_, index) => invoices[index]?.id ?? String(index)}
          columns={[
            { key: "invoiceId", label: "Invoice ID" },
            { key: "client", label: "Client" },
            { key: "po", label: "PO Number" },
            { key: "date", label: "Invoice Date" },
            { key: "notes", label: "Notes" },
            { key: "actions", label: "Actions", className: "text-right" },
          ]}
          rows={invoices.map((invoice) => ({
            invoiceId: invoice.invoice_id ?? "—",
            client: invoice.clients?.name ?? "—",
            po: invoice.po_number,
            date: formatDate(invoice.invoice_date),
            notes: invoice.notes ?? "—",
            actions: (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => handleView(invoice)}>
                  View Invoice
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(invoice);
                    setShowForm(true);
                  }}
                >
                  Edit
                </Button>
                <Button variant="danger" onClick={() => handleDeleteClick(invoice)}>
                  Delete
                </Button>
              </div>
            ),
          }))}
          emptyMessage="No invoices yet. Create an invoice from uninvoiced ledger items."
        />
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
