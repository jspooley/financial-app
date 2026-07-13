"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientForm } from "@/components/forms/ClientForm";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { RowActions } from "@/components/ui/RowActions";
import { createClient } from "@/lib/supabase/client";
import type { Client } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

function ClientsPageContent() {
  const searchParams = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsPoMigration, setNeedsPoMigration] = useState(false);
  const [needsBudgetMigration, setNeedsBudgetMigration] = useState(false);
  const [showForm, setShowForm] = useState(searchParams.get("add") === "1");
  const [editing, setEditing] = useState<Client | null>(null);

  const loadClients = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNeedsPoMigration(false);
    setNeedsBudgetMigration(false);
    const supabase = createClient();

    const { data, error } = await supabase
      .from("clients")
      .select("*, client_po_numbers(id, po_number, budget)")
      .order("name", { ascending: true });

    if (!error) {
      setClients(
        (data ?? []).map((row) => ({
          ...row,
          budget: Number(row.budget ?? 0),
          client_po_numbers: (row.client_po_numbers ?? []).map(
            (po: { id: string; po_number: string; budget?: number }) => ({
              ...po,
              budget: Number(po.budget ?? 0),
            })
          ),
        }))
      );
      setLoading(false);
      return;
    }

    const message = error.message.toLowerCase();
    if (message.includes("client_po_numbers")) {
      const { data: fallback, error: fallbackError } = await supabase
        .from("clients")
        .select("*")
        .order("name", { ascending: true });

      if (fallbackError) {
        setLoadError(fallbackError.message);
        setClients([]);
        setLoading(false);
        return;
      }

      setClients(
        (fallback ?? []).map((row) => ({
          ...row,
          budget: Number(row.budget ?? 0),
        }))
      );
      setNeedsPoMigration(true);
      setLoading(false);
      return;
    }

    if (message.includes("budget")) {
      const { data: fallback, error: fallbackError } = await supabase
        .from("clients")
        .select("*, client_po_numbers(id, po_number)")
        .order("name", { ascending: true });

      if (fallbackError) {
        setLoadError(fallbackError.message);
        setClients([]);
        setLoading(false);
        return;
      }

      setClients(
        (fallback ?? []).map((row) => ({
          ...row,
          budget: 0,
          client_po_numbers: (row.client_po_numbers ?? []).map(
            (po: { id: string; po_number: string }) => ({
              ...po,
              budget: 0,
            })
          ),
        }))
      );
      setNeedsBudgetMigration(true);
      setLoading(false);
      return;
    }

    setLoadError(error.message);
    setClients([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setShowForm(true);
      setEditing(null);
    }
  }, [searchParams]);

  async function handleDelete(client: Client) {
    if (!confirm(`Delete client "${client.name}"?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("clients").delete().eq("id", client.id);
    if (error) {
      alert(error.message);
      return;
    }
    loadClients();
  }

  return (
    <AppShell>
      <PageHeader
        title="Clients"
        description="Manage client contact details and PO numbers for ledger and invoicing."
        action={
          !showForm && (
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              Add Client
            </Button>
          )
        }
      />

      {loadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </div>
      )}
      {needsPoMigration && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">Database setup required for PO numbers</p>
          <p className="mt-1">
            Your clients are still in the database. Run migration{" "}
            <code className="rounded bg-amber-100 px-1">024_client_po_numbers.sql</code> in
            Supabase, then refresh this page to manage PO numbers per client.
          </p>
        </div>
      )}

      {needsBudgetMigration && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">Database setup required for PO budgets</p>
          <p className="mt-1">
            Run migration{" "}
            <code className="rounded bg-amber-100 px-1">028_client_budget.sql</code> in Supabase,
            then refresh to view and edit budget amounts per PO.
          </p>
        </div>
      )}

      {showForm ? (
        <ClientForm
          initial={editing}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSuccess={() => {
            setShowForm(false);
            setEditing(null);
            loadClients();
          }}
        />
      ) : loading ? (
        <p className="text-sm text-slate-500">Loading clients...</p>
      ) : clients.length === 0 ? (
        <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50 p-8 text-center">
          <p className="text-sm font-medium text-brand-900">No clients yet</p>
          <p className="mt-1 text-sm text-brand-800">
            Add your first client before creating ledger entries or invoices.
          </p>
          <Button
            className="mt-4"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            Add Your First Client
          </Button>
        </div>
      ) : (
        <DataTable
          stickyFirstColumn
          mobileTitleKey="name"
          columns={[
            { key: "actions", label: "Actions" },
            { key: "name", label: "Name" },
            { key: "personalUse", label: "Personal Use" },
            { key: "poBudget", label: "PO / Budget" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
          ]}
          rows={clients.map((client) => ({
            actions: (
              <RowActions
                onEdit={() => {
                  setEditing(client);
                  setShowForm(true);
                }}
                onDelete={() => handleDelete(client)}
              />
            ),
            name: client.name,
            personalUse: client.personal_use ? "Yes" : "No",
            poBudget:
              (client.client_po_numbers ?? []).length === 0 ? (
                "—"
              ) : (
                <div className="space-y-1.5 text-sm">
                  {[...(client.client_po_numbers ?? [])]
                    .sort((a, b) => a.po_number.localeCompare(b.po_number))
                    .map((po) => (
                      <div
                        key={po.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5"
                      >
                        <span className="font-medium text-slate-800">{po.po_number}</span>
                        <span className="tabular-nums text-brand-800">
                          {formatCurrency(Number(po.budget ?? 0))}
                        </span>
                      </div>
                    ))}
                </div>
              ),
            email: client.email ?? "—",
            phone: client.phone ?? "—",
          }))}
        />
      )}
    </AppShell>
  );
}

export default function ClientsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-slate-500">Loading...</p>}>
      <ClientsPageContent />
    </Suspense>
  );
}
