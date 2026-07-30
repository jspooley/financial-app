"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { BudgetClientActions } from "@/components/budget/BudgetClientActions";
import { BudgetPlanner } from "@/components/budget/BudgetPlanner";
import {
  BudgetItemForm,
  type BudgetItemFormDefaults,
} from "@/components/forms/BudgetItemForm";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { RowActions } from "@/components/ui/RowActions";
import { type BudgetPlannerState } from "@/lib/budget-planner-state";
import {
  groupBudgetItemsByRoom,
  sortBudgetRooms,
  type BudgetPlanSnapshot,
} from "@/lib/budget-utils";
import { createClient } from "@/lib/supabase/client";
import { BUDGET_DB_SETUP_SQL } from "@/lib/budget-db";
import { BUDGET_ROOM_OPTIONS, type BudgetItem, type Client, type ClientPoNumber } from "@/lib/types";
import { selectFieldClass } from "@/components/ui/FormFields";
import { formatCurrency } from "@/lib/utils";

type BudgetView = "items" | "planner";
type ItemsSortBy = "room" | "item";

const EMPTY_PLAN: BudgetPlanSnapshot = { rooms: [], grandTotal: 0 };
const PLANNER_DRAFT_STORAGE_KEY = "budget-planner-draft-v2";
const ITEMS_SORT_STORAGE_KEY = "budget-items-sort-v1";
const PLANNER_DRAFT_VERSION = 2;

interface PlannerDraft {
  version: typeof PLANNER_DRAFT_VERSION;
  clientId: string;
  poId: string;
  plannerState: BudgetPlannerState;
}

function readItemsSortBy(): ItemsSortBy {
  if (typeof window === "undefined") return "room";
  try {
    const raw = sessionStorage.getItem(ITEMS_SORT_STORAGE_KEY);
    if (raw === "room" || raw === "item") return raw;
  } catch {
    // Ignore storage failures.
  }
  return "room";
}

function writeItemsSortBy(value: ItemsSortBy) {
  if (typeof window === "undefined") return;
  try {
    if (value === "room") {
      sessionStorage.removeItem(ITEMS_SORT_STORAGE_KEY);
    } else {
      sessionStorage.setItem(ITEMS_SORT_STORAGE_KEY, value);
    }
  } catch {
    // Ignore quota / private mode failures.
  }
}

function compareBudgetRooms(a: string, b: string) {
  const orderIndex = new Map<string, number>(
    BUDGET_ROOM_OPTIONS.map((room, index) => [room, index])
  );
  const aIndex = orderIndex.get(a);
  const bIndex = orderIndex.get(b);
  if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
  if (aIndex !== undefined) return -1;
  if (bIndex !== undefined) return 1;
  return a.localeCompare(b);
}

function viewButtonClass(active: boolean) {
  return `inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition ${
    active
      ? "bg-brand-600 text-white"
      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
  }`;
}

function budgetItemDefaults(item: BudgetItem): BudgetItemFormDefaults {
  return {
    room: item.room,
    item_description: item.item_description,
    include_in_budget: item.include_in_budget,
    quantity: item.quantity,
    low_amount: item.low_amount,
    medium_amount: item.medium_amount,
    high_amount: item.high_amount,
  };
}

function isPlannerState(value: unknown): value is BudgetPlannerState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    !!record.includedRooms &&
    typeof record.includedRooms === "object" &&
    !!record.includedItems &&
    typeof record.includedItems === "object" &&
    !!record.quantities &&
    typeof record.quantities === "object" &&
    !!record.sliderPercents &&
    typeof record.sliderPercents === "object"
  );
}

function readPlannerDraft(): PlannerDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PLANNER_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlannerDraft>;
    if (
      parsed?.version !== PLANNER_DRAFT_VERSION ||
      typeof parsed.clientId !== "string" ||
      !parsed.clientId ||
      typeof parsed.poId !== "string" ||
      !parsed.poId ||
      !isPlannerState(parsed.plannerState)
    ) {
      return null;
    }
    return {
      version: PLANNER_DRAFT_VERSION,
      clientId: parsed.clientId,
      poId: parsed.poId,
      plannerState: parsed.plannerState,
    };
  } catch {
    return null;
  }
}

function writePlannerDraft(draft: PlannerDraft) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PLANNER_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Ignore quota / private mode failures.
  }
}

function clearPlannerDraft() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PLANNER_DRAFT_STORAGE_KEY);
    // Clear legacy draft key from earlier sessions.
    sessionStorage.removeItem("budget-planner-draft-v1");
  } catch {
    // Ignore storage failures.
  }
}

export default function BudgetToolPage() {
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsDbSetup, setNeedsDbSetup] = useState(false);
  const [view, setView] = useState<BudgetView>("planner");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BudgetItem | null>(null);
  const [formDefaults, setFormDefaults] = useState<BudgetItemFormDefaults | null>(
    null
  );
  const [clients, setClients] = useState<Client[]>([]);
  const [poNumbers, setPoNumbers] = useState<ClientPoNumber[]>([]);
  const [plan, setPlan] = useState<BudgetPlanSnapshot>(EMPTY_PLAN);
  const [plannerState, setPlannerState] = useState<BudgetPlannerState>({
    includedRooms: {},
    includedItems: {},
    quantities: {},
    sliderPercents: {},
  });
  const [loadedPlanState, setLoadedPlanState] = useState<BudgetPlannerState | null>(null);
  const [loadPlanToken, setLoadPlanToken] = useState(0);
  const [draftReady, setDraftReady] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedPoId, setSelectedPoId] = useState("");
  const [plannerDirty, setPlannerDirty] = useState(false);
  const [roomFilter, setRoomFilter] = useState("");
  const [itemsSortBy, setItemsSortBy] = useState<ItemsSortBy>("room");
  const [itemsSortReady, setItemsSortReady] = useState(false);
  const skipDraftWriteRef = useRef(false);
  const ignorePlannerDirtyRef = useRef(true);
  const listScrollYRef = useRef(0);
  const restoreListScrollRef = useRef(false);

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
        .select("id, client_id, po_number, budget, budget_plan, budget_pdf_path")
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

  useEffect(() => {
    setItemsSortBy(readItemsSortBy());
    setItemsSortReady(true);
  }, []);

  useEffect(() => {
    if (!itemsSortReady) return;
    writeItemsSortBy(itemsSortBy);
  }, [itemsSortBy, itemsSortReady]);

  useEffect(() => {
    if (loading || draftReady) return;
    const draft = readPlannerDraft();
    if (draft) {
      // Avoid overwriting the restored draft with empty planner state.
      skipDraftWriteRef.current = true;
      ignorePlannerDirtyRef.current = true;
      setSelectedClientId(draft.clientId);
      setSelectedPoId(draft.poId);
      setPlannerState(draft.plannerState);
      setLoadedPlanState(draft.plannerState);
      setLoadPlanToken((token) => token + 1);
      setPlannerDirty(true);
    }
    setDraftReady(true);
  }, [loading, draftReady]);

  useEffect(() => {
    if (!draftReady) return;
    if (skipDraftWriteRef.current) {
      skipDraftWriteRef.current = false;
      return;
    }

    // Only keep a draft when client + PO are selected and work is unsaved.
    if (!selectedClientId || !selectedPoId || !plannerDirty) {
      clearPlannerDraft();
      return;
    }

    writePlannerDraft({
      version: PLANNER_DRAFT_VERSION,
      clientId: selectedClientId,
      poId: selectedPoId,
      plannerState,
    });
  }, [
    plannerState,
    selectedClientId,
    selectedPoId,
    plannerDirty,
    draftReady,
  ]);

  const customRooms = useMemo(
    () => [...new Set(items.map((item) => item.room))],
    [items]
  );

  const plannerRooms = useMemo(() => {
    const grouped = groupBudgetItemsByRoom(items);
    return sortBudgetRooms([...grouped.keys()], BUDGET_ROOM_OPTIONS);
  }, [items]);

  const handlePlanChange = useCallback((nextPlan: BudgetPlanSnapshot) => {
    setPlan(nextPlan);
  }, []);

  const handlePlannerStateChange = useCallback((state: BudgetPlannerState) => {
    setPlannerState(state);
    if (ignorePlannerDirtyRef.current) {
      ignorePlannerDirtyRef.current = false;
      return;
    }
    setPlannerDirty(true);
  }, []);

  const handleLoadPlan = useCallback((state: BudgetPlannerState) => {
    ignorePlannerDirtyRef.current = true;
    setPlannerDirty(false);
    clearPlannerDraft();
    setLoadedPlanState(state);
    setLoadPlanToken((token) => token + 1);
  }, []);

  const handlePlannerSaved = useCallback(() => {
    ignorePlannerDirtyRef.current = true;
    setPlannerDirty(false);
    clearPlannerDraft();
  }, []);

  const handleSelectedClientIdChange = useCallback((clientId: string) => {
    setSelectedClientId(clientId);
  }, []);

  const handleSelectedPoIdChange = useCallback((poId: string) => {
    setSelectedPoId(poId);
  }, []);

  function closeItemForm() {
    setShowForm(false);
    setEditing(null);
    setFormDefaults(null);
  }

  function rememberListScroll() {
    listScrollYRef.current = window.scrollY;
    restoreListScrollRef.current = true;
  }

  function showPlannerView() {
    restoreListScrollRef.current = false;
    closeItemForm();
    ignorePlannerDirtyRef.current = true;
    setLoadedPlanState(plannerState);
    setLoadPlanToken((token) => token + 1);
    setView("planner");
  }

  function openCreateForm() {
    rememberListScroll();
    setEditing(null);
    setFormDefaults(null);
    setShowForm(true);
  }

  function openEditForm(item: BudgetItem) {
    rememberListScroll();
    setEditing(item);
    setFormDefaults(null);
    setShowForm(true);
  }

  function openDuplicateForm(item: BudgetItem) {
    rememberListScroll();
    setEditing(null);
    setFormDefaults(budgetItemDefaults(item));
    setShowForm(true);
  }

  const roomFilterOptions = useMemo(
    () => sortBudgetRooms(customRooms, BUDGET_ROOM_OPTIONS),
    [customRooms]
  );

  const filteredItems = useMemo(() => {
    const list = roomFilter
      ? items.filter((item) => item.room === roomFilter)
      : [...items];

    return list.sort((a, b) => {
      if (itemsSortBy === "room") {
        const roomCmp = compareBudgetRooms(a.room, b.room);
        if (roomCmp !== 0) return roomCmp;
        return a.item_description.localeCompare(b.item_description);
      }
      const itemCmp = a.item_description.localeCompare(b.item_description);
      if (itemCmp !== 0) return itemCmp;
      return compareBudgetRooms(a.room, b.room);
    });
  }, [items, roomFilter, itemsSortBy]);

  useEffect(() => {
    if (roomFilter && !roomFilterOptions.includes(roomFilter)) {
      setRoomFilter("");
    }
  }, [roomFilter, roomFilterOptions]);

  useLayoutEffect(() => {
    if (
      showForm ||
      view !== "items" ||
      loading ||
      !restoreListScrollRef.current
    ) {
      return;
    }
    restoreListScrollRef.current = false;
    const y = listScrollYRef.current;
    requestAnimationFrame(() => {
      window.scrollTo(0, y);
    });
  }, [showForm, view, loading, filteredItems]);

  async function handleDelete(item: BudgetItem) {
    rememberListScroll();
    if (
      !confirm(
        `Delete "${item.item_description}" from ${item.room}?`
      )
    ) {
      const y = listScrollYRef.current;
      restoreListScrollRef.current = false;
      requestAnimationFrame(() => {
        window.scrollTo(0, y);
      });
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.from("budget_items").delete().eq("id", item.id);
    if (error) {
      restoreListScrollRef.current = false;
      alert(error.message);
      return;
    }
    setItems((current) => current.filter((row) => row.id !== item.id));
  }

  const formKey = editing
    ? `edit-${editing.id}`
    : formDefaults
      ? `dup-${formDefaults.room}-${formDefaults.item_description}-${formDefaults.low_amount}-${formDefaults.medium_amount}-${formDefaults.high_amount}`
      : "new";

  return (
    <AppShell>
      <PageHeader
        title="Budget Tool"
        description="Manage room budget items and explore save-to-splurge scenarios."
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={viewButtonClass(view === "planner")}
            onClick={showPlannerView}
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

        {view === "items" && !showForm && (
          <div className="flex flex-wrap items-center gap-3">
            <Button className="min-h-11" onClick={openCreateForm}>
              Add Item
            </Button>
            <div className="flex min-h-11 items-center gap-4 rounded-xl border border-slate-200 bg-white py-1.5 pl-4 pr-2 shadow-sm">
              <span className="shrink-0 text-sm font-medium text-slate-700 whitespace-nowrap">
                Filter by room
              </span>
              <select
                value={roomFilter}
                onChange={(event) => setRoomFilter(event.target.value)}
                disabled={loading}
                className={`${selectFieldClass} !h-9 !min-h-9 !py-1.5 w-full min-w-48 sm:w-56`}
                aria-label="Filter by room"
              >
                <option value="">All rooms</option>
                {roomFilterOptions.map((room) => (
                  <option key={room} value={room}>
                    {room}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-h-11 items-center gap-4 rounded-xl border border-slate-200 bg-white py-1.5 pl-4 pr-2 shadow-sm">
              <span className="shrink-0 text-sm font-medium text-slate-700 whitespace-nowrap">
                Sort by
              </span>
              <select
                value={itemsSortBy}
                onChange={(event) =>
                  setItemsSortBy(event.target.value as ItemsSortBy)
                }
                disabled={loading}
                className={`${selectFieldClass} !h-9 !min-h-9 !py-1.5 w-full min-w-36 sm:w-44`}
                aria-label="Sort by"
              >
                <option value="room">Room</option>
                <option value="item">Item</option>
              </select>
            </div>
          </div>
        )}
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
            <BudgetClientActions
              clients={clients}
              poNumbers={poNumbers}
              items={items}
              rooms={plannerRooms}
              plan={plan}
              plannerState={plannerState}
              selectedClientId={selectedClientId}
              selectedPoId={selectedPoId}
              onSelectedClientIdChange={handleSelectedClientIdChange}
              onSelectedPoIdChange={handleSelectedPoIdChange}
              onClientsUpdated={loadClients}
              onLoadPlan={handleLoadPlan}
              onSaved={handlePlannerSaved}
            />
            <BudgetPlanner
              items={items}
              onPlanChange={handlePlanChange}
              onPlannerStateChange={handlePlannerStateChange}
              loadedPlanState={loadedPlanState}
              loadPlanToken={loadPlanToken}
            />
          </>
        )
      ) : showForm ? (
        <BudgetItemForm
          key={formKey}
          initial={editing}
          defaults={formDefaults}
          customRooms={customRooms}
          onCancel={closeItemForm}
          onSuccess={() => {
            closeItemForm();
            loadItems();
          }}
        />
      ) : loading ? (
        <p className="text-sm text-slate-500">Loading budget items...</p>
      ) : (
        <DataTable
          stickyFirstColumn
          mobileTitleKey="description"
          columns={[
            { key: "actions", label: "Actions" },
            { key: "room", label: "Room" },
            { key: "description", label: "Item" },
            { key: "low", label: "Low" },
            { key: "medium", label: "Medium" },
            { key: "high", label: "High" },
          ]}
          rows={filteredItems.map((item) => ({
            actions: (
              <RowActions
                onEdit={() => openEditForm(item)}
                onDuplicate={() => openDuplicateForm(item)}
                onDelete={() => handleDelete(item)}
              />
            ),
            room: item.room,
            description: item.item_description,
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
      )}
    </AppShell>
  );
}
