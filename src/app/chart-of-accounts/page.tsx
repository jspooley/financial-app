"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ChartOfAccountForm } from "@/components/forms/ChartOfAccountForm";
import { useRecordLocks } from "@/components/RecordLockProvider";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { RowActions } from "@/components/ui/RowActions";
import { createClient } from "@/lib/supabase/client";
import type { ChartOfAccount } from "@/lib/types";

export default function ChartOfAccountsPage() {
  const { acquireLocks, releaseLocks } = useRecordLocks();
  const [entries, setEntries] = useState<ChartOfAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ChartOfAccount | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("chart_of_accounts")
      .select("*")
      .order("category", { ascending: true });
    if (error) {
      setLoadError(error.message);
      setEntries([]);
    } else {
      setEntries(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  function closeForm() {
    void releaseLocks();
    setShowForm(false);
    setEditing(null);
  }

  async function startEdit(entry: ChartOfAccount) {
    const ok = await acquireLocks([{ table: "chart_of_accounts", id: entry.id }]);
    if (!ok) return;
    setEditing(entry);
    setShowForm(true);
  }

  async function handleDelete(entry: ChartOfAccount) {
    if (!confirm(`Delete chart of accounts entry "${entry.category}"?`)) return;
    const targets = [{ table: "chart_of_accounts" as const, id: entry.id }];
    const ok = await acquireLocks(targets);
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("chart_of_accounts")
      .delete()
      .eq("id", entry.id);
    await releaseLocks(targets);
    if (error) {
      alert(error.message);
      return;
    }
    loadEntries();
  }

  return (
    <AppShell>
      <PageHeader
        title="Chart of Accounts"
        description="Manage income, expense, and transfer categories for cashflow."
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

      {showForm ? (
        <ChartOfAccountForm
          initial={editing}
          onCancel={closeForm}
          onSuccess={() => {
            closeForm();
            loadEntries();
          }}
        />
      ) : loading ? (
        <p className="text-sm text-slate-500">Loading chart of accounts...</p>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Could not load chart of accounts.</p>
          <p className="mt-1">{loadError}</p>
          <p className="mt-2 text-xs text-red-700/80">
            If the table is missing, run migration{" "}
            <code className="rounded bg-red-100 px-1">
              054_chart_of_accounts.sql
            </code>{" "}
            in Supabase.
          </p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => loadEntries()}
          >
            Retry
          </Button>
        </div>
      ) : (
        <DataTable
          stickyFirstColumn
          mobileTitleKey="category"
          columns={[
            { key: "actions", label: "Actions" },
            { key: "category", label: "Category" },
          ]}
          rows={entries.map((entry) => ({
            actions: (
              <RowActions
                onEdit={() => {
                  void startEdit(entry);
                }}
                onDelete={() => handleDelete(entry)}
              />
            ),
            category: entry.category,
          }))}
          emptyMessage="No chart of accounts entries yet."
        />
      )}
    </AppShell>
  );
}
