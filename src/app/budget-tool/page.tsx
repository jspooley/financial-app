"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { BudgetClientActions } from "@/components/budget/BudgetClientActions";
import { BudgetPlanner } from "@/components/budget/BudgetPlanner";
import { BudgetItemForm } from "@/components/forms/BudgetItemForm";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { RowActions } from "@/components/ui/RowActions";
import { sortBudgetRooms, type BudgetPlanSnapshot } from "@/lib/budget-utils";
import { createClient } from "@/lib/supabase/client";
import { BUDGET_DB_SETUP_SQL } from "@/lib/budget-db";
import { BUDGET_ROOM_OPTIONS, type BudgetItem, type Client, type ClientPoNumber } from "@/lib/types";
import { SelectField } from "@/components/ui/FormFields";
import { formatCurrency } from "@/lib/utils";

type BudgetView = "items" | "planner";

const EMPTY_PLAN: BudgetPlanSnapshot = { rooms: [], grandTotal: 0 };

function viewButtonClass(active: boolean) {
  return `rounded-lg px-3 py-2 text-sm font-medium transition ${
    active
      ? "bg-brand-600 text-white"
      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
  }`;
}

export default function BudgetToolPage() {
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsDbSetup, setNeedsDbSetup] = useState(false);
  const [view, setView] = useState<BudgetView>("planner");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BudgetItem | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [poNumbers, setPoNumbers] = useState<ClientPoNumber[]>([]);
  const [plan, setPlan] = useState<BudgetPlanSnapshot>(EMPTY_PLAN);
  const [roomFilter, setRoomFilter] = useState("");

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNeedsDbSetup(false);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("budget_items")
      .select("*")
      .order("room", { ascending: true })
      .order("item_description", { ascending: true });

    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes("budget_items") || message.includes("schema cache")) {
        setNeedsDbSetup(true);
      }
      setLoadError(error.message);
      setItems([]);
    } else {
      setItems(
        (data ?? []).map((row) => ({
          ...row,
          quantity: Number(row.quantity ?? 0),
          low_amount: Number(row.low_amount),
          medium_amount: Number(row.medium_amount),
          high_amount: Number(row.high_amount),
        }))
      );
    }
    setLoading(false);
  }, []);

  const loadClients = useCallback(async () => {
    const supabase = createClient();
    const [{ data: clientData }, { data: poData }] = await Promise.all([
      supabase.from("clients").select("*").order("name", { ascending: true }),
      supabase
        .from("client_po_numbers")
        .select("id, client_id, po_number, budget")
        .order("po_number", { ascending: true }),
    ]);

    setClients(
      (clientData ?? []).map((row) => ({
        ...row,
        budget: Number(row.budget ?? 0),
      }))
    );
    setPoNumbers(
      (poData ?? []).map((row) => ({
        ...row,
        budget: Number(row.budget ?? 0),
      }))
    );
  }, []);

  useEffect(() => {
    loadItems();
    loadClients();
  }, [loadItems, loadClients]);

  const customRooms = useMemo(
    () => [...new Set(items.map((item) => item.room))],
    [items]
  );

  const roomFilterOptions = useMemo(
    () => sortBudgetRooms(customRooms, BUDGET_ROOM_OPTIONS),
    [customRooms]
  );

  const filteredItems = useMemo(() => {
    if (!roomFilter) return items;
    return items.filter((item) => item.room === roomFilter);
  }, [items, roomFilter]);

  useEffect(() => {
    if (roomFilter && !roomFilterOptions.includes(roomFilter)) {
      setRoomFilter("");
    }
  }, [roomFilter, roomFilterOptions]);

  async function handleDelete(item: BudgetItem) {
    if (
      !confirm(
        `Delete "${item.item_description}" from ${item.room}?`
      )
    ) {
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.from("budget_items").delete().eq("id", item.id);
    if (error) {
      alert(error.message);
      return;
    }
    loadItems();
  }

  return (
    <AppShell>
      <PageHeader
        title="Budget Tool"
        description="Manage room budget items and explore save-to-splurge scenarios."
        action={
          view === "items" &&
          !showForm && (
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              Add Item
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={viewButtonClass(view === "planner")}
          onClick={() => {
            setView("planner");
            setShowForm(false);
            setEditing(null);
          }}
        >
          Budget Tool
        </button>
        <button
          type="button"
          className={viewButtonClass(view === "items")}
          onClick={() => setView("items")}
        >
          Manage Items
        </button>
      </div>

      {needsDbSetup && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-medium">Budget table not set up yet.</p>
          <p className="mt-1">
            Run the SQL below once in Supabase, then refresh this page.
          </p>
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-white p-3 text-xs text-slate-800 ring-1 ring-amber-200">
            {BUDGET_DB_SETUP_SQL}
          </pre>
        </div>
      )}

      {loadError && !needsDbSetup && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Could not load budget items.</p>
          <p className="mt-1">{loadError}</p>
          <Button variant="secondary" className="mt-3" onClick={() => loadItems()}>
            Retry
          </Button>
        </div>
      )}

      {view === "planner" ? (
        loading ? (
          <p className="text-sm text-slate-500">Loading budget items...</p>
        ) : (
          <>
            <BudgetClientActions clients={clients} poNumbers={poNumbers} plan={plan} />
            <BudgetPlanner items={items} onPlanChange={setPlan} />
          </>
        )
      ) : showForm ? (
        <BudgetItemForm
          initial={editing}
          customRooms={customRooms}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSuccess={() => {
            setShowForm(false);
            setEditing(null);
            loadItems();
          }}
        />
      ) : loading ? (
        <p className="text-sm text-slate-500">Loading budget items...</p>
      ) : (
        <>
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <SelectField
              label="Filter by room"
              value={roomFilter}
              onChange={(event) => setRoomFilter(event.target.value)}
              className="max-w-xs"
            >
              <option value="">All rooms</option>
              {roomFilterOptions.map((room) => (
                <option key={room} value={room}>
                  {room}
                </option>
              ))}
            </SelectField>
          </div>

          <DataTable
            stickyFirstColumn
            mobileTitleKey="description"
            columns={[
              { key: "actions", label: "Actions" },
              { key: "room", label: "Room" },
              { key: "description", label: "Item" },
              { key: "quantity", label: "Qty" },
              { key: "low", label: "Low" },
              { key: "medium", label: "Medium" },
              { key: "high", label: "High" },
            ]}
            rows={filteredItems.map((item) => ({
              actions: (
                <RowActions
                  onEdit={() => {
                    setEditing(item);
                    setShowForm(true);
                  }}
                  onDelete={() => handleDelete(item)}
                />
              ),
              room: item.room,
              description: item.item_description,
              quantity: item.quantity,
              low: formatCurrency(item.low_amount),
              medium: formatCurrency(item.medium_amount),
              high: formatCurrency(item.high_amount),
            }))}
            emptyMessage={
              roomFilter
                ? `No items in ${roomFilter}.`
                : "No budget items yet."
            }
          />
        </>
      )}
    </AppShell>
  );
}
