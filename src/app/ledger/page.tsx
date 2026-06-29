"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LedgerForm } from "@/components/forms/LedgerForm";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { isLedgerLineUninvoiced } from "@/lib/invoice-utils";
import { ledgerDetailFields, ledgerDetailColumns, mapLedgerTableRow } from "@/lib/ledger-display";
import { createClient } from "@/lib/supabase/client";
import { normalizeLedgerRow, type LedgerDbRow } from "@/lib/ledger-db";
import type { Client, Invoice, LedgerEntry, TradePartner } from "@/lib/types";
import { formatCurrency, formatDate, getLedgerInvoicedAmount, purchaserFromEmail } from "@/lib/utils";

export default function LedgerPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-slate-500">Loading...</p>}>
      <LedgerPageContent />
    </Suspense>
  );
}

function LedgerPageContent() {
  const searchParams = useSearchParams();
  const uninvoicedOnly = searchParams.get("uninvoiced") === "1";
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

  const visibleEntries = useMemo(
    () =>
      uninvoicedOnly ? entries.filter(isLedgerLineUninvoiced) : entries,
    [entries, uninvoicedOnly]
  );

  const debitEntries = visibleEntries.filter((entry) => entry.credit_debit === "debit");
  const creditEntries = visibleEntries.filter((entry) => entry.credit_debit === "credit");

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

      {uninvoicedOnly && !showForm && !loading && (
        <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-slate-800">
          Showing outstanding items to be invoiced ({visibleEntries.length}{" "}
          {visibleEntries.length === 1 ? "item" : "items"}).{" "}
          <Link href="/ledger" className="font-medium text-brand-700 hover:underline">
            Show all ledger entries
          </Link>
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
      ) : uninvoicedOnly && visibleEntries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          <p>No outstanding items to be invoiced.</p>
          <Link href="/ledger" className="mt-3 inline-block font-medium text-brand-700 hover:underline">
            Show all ledger entries
          </Link>
        </div>
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
              Client debits are the default when you add an entry. Scroll down to the{" "}
              <strong>Debits</strong> section — on desktop, scroll the table left/right for all
              columns including Invoiced and Paid.
            </p>
            {entries.length > 0 && debitEntries.length === 0 && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
                All {entries.length} ledger{" "}
                {entries.length === 1 ? "entry is" : "entries are"} type <strong>credit</strong>.
                Edit an entry and set <strong>Credit / Debit</strong> to{" "}
                <strong>Client Debit</strong> to see it in the Debits table.
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
                        <p className="text-sm font-medium text-slate-500">Invoiced Amount</p>
                        <p className="text-right font-semibold text-brand-800">
                          {formatCurrency(getLedgerInvoicedAmount(entry))}
                        </p>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        {ledgerDetailFields(entry).map((field) => (
                          <div key={field.label}>
                            <dt className="text-slate-500">{field.label}</dt>
                            <dd>{field.value}</dd>
                          </div>
                        ))}
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
                Client Debits — includes Invoiced, Invoice ID, Paid, and payment columns.
              </p>
              <DataTable
                stickyFirstColumn
                stickyLastColumn
                rowKey={(_, index) => debitEntries[index]?.id ?? String(index)}
                columns={[
                  ...ledgerDetailColumns,
                  { key: "actions", label: "Actions", className: "text-right" },
                ]}
                rows={debitEntries.map((entry) => ({
                  ...mapLedgerTableRow(entry),
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
                ...ledgerDetailColumns,
                { key: "actions", label: "Actions", className: "text-right" },
              ]}
              rows={creditEntries.map((entry) => ({
                ...mapLedgerTableRow(entry),
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
