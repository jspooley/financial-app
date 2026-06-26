"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ClientForm } from "@/components/forms/ClientForm";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/client";
import type { Client } from "@/lib/types";

function ClientsPageContent() {
  const searchParams = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(searchParams.get("add") === "1");
  const [editing, setEditing] = useState<Client | null>(null);

  const loadClients = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("clients")
      .select("*")
      .order("name", { ascending: true });
    setClients(data ?? []);
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
        description="Manage client contact details and unique IDs."
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
          columns={[
            { key: "name", label: "Name" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
            { key: "actions", label: "Actions", className: "text-right" },
          ]}
          rows={clients.map((client) => ({
            name: client.name,
            email: client.email ?? "—",
            phone: client.phone ?? "—",
            actions: (
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(client);
                    setShowForm(true);
                  }}
                >
                  Edit
                </Button>
                <Button variant="danger" onClick={() => handleDelete(client)}>
                  Delete
                </Button>
              </div>
            ),
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
