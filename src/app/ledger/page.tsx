"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { LedgerForm } from "@/components/forms/LedgerForm";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/client";
import { normalizeLedgerRow, type LedgerDbRow } from "@/lib/ledger-db";
import type { Client, Invoice, LedgerEntry, TradePartner } from "@/lib/types";
import { formatCurrency, formatDate, getLedgerCustomerPrice, getLedgerTotalDesignerCost, purchaserFromEmail } from "@/lib/utils";

export default function LedgerPage() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [tradePartners, setTradePartners] = useState<TradePartner[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [defaultPurchaser, setDefaultPurchaser] = useState<"Jess" | "Molly" | null>(
    null
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const [
      { data: ledgerData, error: ledgerError },
      { data: clientData, error: clientError },
      { data: tradeData, error: tradeError },
      { data: invoiceData, error: invoiceError },
      { data: userData },
    ] = await Promise.all([
      supabase
        .from("ledger")
        .select("*, clients(name), trade_partners(company_name)")
        .order("entry_date", { ascending: false }),
      supabase.from("clients").select("*").order("name", { ascending: true }),
      supabase.from("trade_partners").select("*").order("company_name", { ascending: true }),
      supabase.from("invoicing").select("*"),
      supabase.auth.getUser(),
    ]);

    const error = ledgerError ?? clientError ?? tradeError ?? invoiceError;
    if (error) {
      setLoadError(error.message);
      setEntries([]);
    } else {
      setEntries(
        (ledgerData ?? []).map((row) =>
          normalizeLedgerRow(row as LedgerDbRow & Record<string, unknown>)
        )
      );
    }
    setClients(clientData ?? []);
    setTradePartners(tradeData ?? []);
    setInvoices(invoiceData ?? []);
    setDefaultPurchaser(purchaserFromEmail(userData.user?.email));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("add") === "1") {
      setEditing(null);
      setShowForm(true);
    }
  }, []);

  async function handleDelete(entry: LedgerEntry) {
    if (!confirm("Delete this ledger entry?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("ledger").delete().eq("id", entry.id);
    if (error) {
      alert(error.message);
      return;
    }
    loadData();
  }

  function startEdit(entry: LedgerEntry) {
    setEditing(entry);
    setShowForm(true);
  }

  function entryActions(entry: LedgerEntry) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => startEdit(entry)}>
          Edit
        </Button>
        <Button variant="danger" onClick={() => handleDelete(entry)}>
          Delete
        </Button>
      </div>
    );
  }

  const debitEntries = entries.filter((entry) => entry.credit_debit === "debit");
  const creditEntries = entries.filter((entry) => entry.credit_debit === "credit");

  return (
    <AppShell>
      <PageHeader
        title="Ledger"
        description="Record expenses and receivables with client, PO, and trade partner links."
        action={
          !showForm && (
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              Add Entry
            </Button>
          )
        }
      />

      {loadError && !showForm && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Could not load ledger: {loadError}
        </div>
      )}

      {showForm ? (
        clients.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            <p className="font-medium">Add at least one client before creating a ledger entry.</p>
            <p className="mt-1">
              Clients hold the contact info and ID used on every ledger row and invoice.
            </p>
            <Link
              href="/clients?add=1"
              className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Go to Clients and Add One
            </Link>
          </div>
        ) : (
          <LedgerForm
            key={editing?.id ?? "new"}
            clients={clients}
            tradePartners={tradePartners}
            invoices={invoices}
            defaultPurchaser={defaultPurchaser}
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
        <p className="text-sm text-slate-500">Loading ledger...</p>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No ledger entries yet.
        </div>
      ) : (
        <>
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
            <p>
              <strong>{debitEntries.length}</strong> debit
              {debitEntries.length === 1 ? "" : "s"} · <strong>{creditEntries.length}</strong>{" "}
              credit{creditEntries.length === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-slate-500">
              Debits are expenses (default when you add an entry). Scroll down to the{" "}
              <strong>Debits</strong> section — on desktop, scroll the table left/right for all
              columns including Invoiced and Paid.
            </p>
            {entries.length > 0 && debitEntries.length === 0 && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
                All {entries.length} ledger{" "}
                {entries.length === 1 ? "entry is" : "entries are"} type <strong>credit</strong>.
                Edit an entry and set <strong>Credit / Debit</strong> to{" "}
                <strong>Debit (expense)</strong> to see it in the Debits table.
              </p>
            )}
          </div>

          <div className="space-y-5 md:hidden">
            {[
              { title: "Debits", rows: debitEntries },
              { title: "Credits", rows: creditEntries },
            ].map((group) => (
              <section key={group.title} className="space-y-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  {group.title} ({group.rows.length})
                </h2>
                {group.rows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
                    No {group.title.toLowerCase()} entries yet.
                  </div>
                ) : (
                  group.rows.map((entry) => (
                    <article
                      key={entry.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900">
                            {entry.clients?.name ?? "—"}
                          </p>
                          <p className="text-sm text-slate-500">
                            {formatDate(entry.entry_date)} · {entry.credit_debit} /{" "}
                            {entry.wholesale_retail}
                          </p>
                        </div>
                        <p className="text-right font-semibold text-brand-800">
                          {formatCurrency(getLedgerCustomerPrice(entry))}
                        </p>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <div>
                          <dt className="text-slate-500">Designer cost</dt>
                          <dd>{formatCurrency(Number(entry.designer_cost))}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Qty</dt>
                          <dd>{Math.round(Number(entry.quantity))}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Total designer cost</dt>
                          <dd>{formatCurrency(getLedgerTotalDesignerCost(entry))}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">PO</dt>
                          <dd>{entry.po_number ?? "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Purchaser</dt>
                          <dd>{entry.purchaser}</dd>
                        </div>
                        {entry.credit_debit === "debit" && (
                          <>
                            <div>
                              <dt className="text-slate-500">Paid</dt>
                              <dd>{entry.paid ? "Yes" : "No"}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">Date Paid</dt>
                              <dd>{entry.date_paid ? formatDate(entry.date_paid) : "—"}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">Paid To</dt>
                              <dd>{entry.paid_to ?? "—"}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">Payment Amount</dt>
                              <dd>{formatCurrency(Number(entry.payment_amount ?? 0))}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">Payment Type</dt>
                              <dd>{entry.payment_type ?? "—"}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">Payment Fee</dt>
                              <dd>{formatCurrency(Number(entry.payment_fee ?? 0))}</dd>
                            </div>
                          </>
                        )}
                      </dl>
                      <div className="mt-4 border-t border-slate-100 pt-4">{entryActions(entry)}</div>
                    </article>
                  ))
                )}
              </section>
            ))}
          </div>

          <div className="hidden space-y-6 md:block">
            <section>
              <h2 className="mb-1 text-lg font-semibold text-slate-900">
                Debits ({debitEntries.length})
              </h2>
              <p className="mb-3 text-sm text-slate-500">
                Expense entries — includes Invoiced, Invoice ID, Paid, and payment columns.
              </p>
              <DataTable
                stickyLastColumn
                rowKey={(_, index) => debitEntries[index]?.id ?? String(index)}
                columns={[
                  { key: "date", label: "Date" },
                  { key: "client", label: "Client" },
                  { key: "type", label: "Type" },
                  { key: "designerCost", label: "Designer Cost" },
                  { key: "qty", label: "Qty" },
                  { key: "totalDesignerCost", label: "Total Designer Cost" },
                  { key: "discount", label: "Discount %" },
                  { key: "customerPrice", label: "Customer Price" },
                  { key: "po", label: "PO" },
                  { key: "tax", label: "Tax" },
                  { key: "invoiced", label: "Invoiced" },
                  { key: "invoiceId", label: "Invoice ID" },
                  { key: "paid", label: "Paid" },
                  { key: "datePaid", label: "Date Paid" },
                  { key: "paidTo", label: "Paid To" },
                  { key: "paymentAmount", label: "Payment Amount" },
                  { key: "paymentType", label: "Payment Type" },
                  { key: "paymentFee", label: "Payment Fee" },
                  { key: "salesUseTaxPaid", label: "Sales and Use Tax Paid" },
                  { key: "purchaser", label: "Purchaser" },
                  { key: "actions", label: "Actions", className: "text-right" },
                ]}
                rows={debitEntries.map((entry) => ({
                  date: formatDate(entry.entry_date),
                  client: entry.clients?.name ?? "—",
                  type: `${entry.credit_debit} / ${entry.wholesale_retail}`,
                  designerCost: formatCurrency(Number(entry.designer_cost)),
                  qty: Math.round(Number(entry.quantity)),
                  totalDesignerCost: formatCurrency(getLedgerTotalDesignerCost(entry)),
                  discount: `${Number(entry.discount_percent)}%`,
                  customerPrice: formatCurrency(getLedgerCustomerPrice(entry)),
                  po: entry.po_number ?? "—",
                  tax:
                    entry.wholesale_retail === "retail"
                      ? "N/A"
                      : formatCurrency(Number(entry.tax_amount)),
                  invoiced: entry.invoiced ? "Yes" : "No",
                  invoiceId: entry.invoice_id ?? "—",
                  paid: entry.paid ? "Yes" : "No",
                  datePaid: entry.date_paid ? formatDate(entry.date_paid) : "—",
                  paidTo: entry.paid_to ?? "—",
                  paymentAmount: formatCurrency(Number(entry.payment_amount ?? 0)),
                  paymentType: entry.payment_type ?? "—",
                  paymentFee: formatCurrency(Number(entry.payment_fee ?? 0)),
                  salesUseTaxPaid: entry.sales_and_use_tax_paid ? "Yes" : "No",
                  purchaser: entry.purchaser,
                  actions: entryActions(entry),
                }))}
                emptyMessage="No debit entries yet."
              />
            </section>

            <section>
              <h2 className="mb-1 text-lg font-semibold text-slate-900">
                Credits ({creditEntries.length})
              </h2>
              <p className="mb-3 text-sm text-slate-500">Receivable entries.</p>
            <DataTable
              stickyLastColumn
              rowKey={(_, index) => creditEntries[index]?.id ?? String(index)}
              columns={[
                { key: "date", label: "Date" },
                { key: "client", label: "Client" },
                { key: "type", label: "Type" },
                { key: "designerCost", label: "Designer Cost" },
                { key: "qty", label: "Qty" },
                { key: "totalDesignerCost", label: "Total Designer Cost" },
                { key: "discount", label: "Discount %" },
                { key: "customerPrice", label: "Customer Price" },
                { key: "po", label: "PO" },
                { key: "tax", label: "Tax" },
                { key: "invoiced", label: "Invoiced" },
                { key: "invoiceId", label: "Invoice ID" },
                { key: "salesUseTaxPaid", label: "Sales and Use Tax Paid" },
                { key: "purchaser", label: "Purchaser" },
                { key: "actions", label: "Actions", className: "text-right" },
              ]}
              rows={creditEntries.map((entry) => ({
                date: formatDate(entry.entry_date),
                client: entry.clients?.name ?? "—",
                type: `${entry.credit_debit} / ${entry.wholesale_retail}`,
                designerCost: formatCurrency(Number(entry.designer_cost)),
                qty: Math.round(Number(entry.quantity)),
                totalDesignerCost: formatCurrency(getLedgerTotalDesignerCost(entry)),
                discount: `${Number(entry.discount_percent)}%`,
                customerPrice: formatCurrency(getLedgerCustomerPrice(entry)),
                po: entry.po_number ?? "—",
                tax:
                  entry.wholesale_retail === "retail"
                    ? "N/A"
                    : formatCurrency(Number(entry.tax_amount)),
                invoiced: entry.invoiced ? "Yes" : "No",
                invoiceId: entry.invoice_id ?? "—",
                salesUseTaxPaid: entry.sales_and_use_tax_paid ? "Yes" : "No",
                purchaser: entry.purchaser,
                actions: entryActions(entry),
              }))}
              emptyMessage="No credit entries yet."
            />
            </section>
          </div>
        </>
      )}
    </AppShell>
  );
}
