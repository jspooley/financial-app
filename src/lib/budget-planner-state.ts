import {
  BUDGET_SLIDER_DEFAULT_PERCENT,
  amountToSliderPercent,
  normalizeBudgetQuantity,
  sliderPercentToAmount,
  type BudgetPlanSnapshot,
} from "@/lib/budget-utils";
import type { BudgetItem } from "@/lib/types";

export const CLIENT_BUDGET_PLAN_VERSION = 1;

export interface BudgetPlannerState {
  includedRooms: Record<string, boolean>;
  includedItems: Record<string, boolean>;
  quantities: Record<string, number>;
  sliderPercents: Record<string, number>;
  /** Exact unit amounts; preferred over slider-derived values when present. */
  unitAmounts: Record<string, number>;
  notes: string;
}

export interface ClientBudgetPlanSaved extends BudgetPlannerState {
  version: typeof CLIENT_BUDGET_PLAN_VERSION;
  grandTotal: number;
  savedAt: string;
  /** Authoritative line items at save time; used to restore selections if IDs drift. */
  snapshot?: BudgetPlanSnapshot;
}

export function defaultBudgetPlannerState(
  items: BudgetItem[],
  rooms: string[]
): BudgetPlannerState {
  const includedRooms: Record<string, boolean> = {};
  for (const room of rooms) {
    includedRooms[room] = true;
  }

  const includedItems: Record<string, boolean> = {};
  const quantities: Record<string, number> = {};
  const sliderPercents: Record<string, number> = {};
  const unitAmounts: Record<string, number> = {};

  for (const item of items) {
    includedItems[item.id] = false;
    quantities[item.id] = normalizeBudgetQuantity(item.quantity);
    sliderPercents[item.id] = BUDGET_SLIDER_DEFAULT_PERCENT;
    unitAmounts[item.id] = sliderPercentToAmount(
      item.low_amount,
      item.medium_amount,
      item.high_amount,
      BUDGET_SLIDER_DEFAULT_PERCENT
    );
  }

  return {
    includedRooms,
    includedItems,
    quantities,
    sliderPercents,
    unitAmounts,
    notes: "",
  };
}

/**
 * Prefer the visible plan snapshot when saving so notes edits cannot persist
 * without the line items currently shown in the PDF/plan.
 */
export function alignPlannerStateWithPlan(
  plan: BudgetPlanSnapshot,
  plannerState: BudgetPlannerState
): BudgetPlannerState {
  const includedRooms = { ...plannerState.includedRooms };
  const includedItems = { ...plannerState.includedItems };
  const quantities = { ...plannerState.quantities };
  const unitAmounts = { ...plannerState.unitAmounts };
  const sliderPercents = { ...plannerState.sliderPercents };

  for (const room of plan.rooms) {
    includedRooms[room.room] = true;
    for (const line of room.lines) {
      includedItems[line.itemId] = true;
      quantities[line.itemId] = line.quantity;
      unitAmounts[line.itemId] = line.unitAmount;
    }
  }

  return {
    includedRooms,
    includedItems,
    quantities,
    sliderPercents,
    unitAmounts,
    notes: plan.notes || plannerState.notes,
  };
}

function applySnapshotToState(
  state: BudgetPlannerState,
  snapshot: BudgetPlanSnapshot | undefined,
  items: BudgetItem[]
): BudgetPlannerState {
  if (!snapshot?.rooms?.length) return state;

  const includedRooms = { ...state.includedRooms };
  const includedItems = { ...state.includedItems };
  const quantities = { ...state.quantities };
  const unitAmounts = { ...state.unitAmounts };
  const sliderPercents = { ...state.sliderPercents };

  const byId = new Map(items.map((item) => [item.id, item]));
  const byRoomDescription = new Map(
    items.map((item) => [`${item.room}::${item.item_description}`, item])
  );

  for (const room of snapshot.rooms) {
    includedRooms[room.room] = true;
    for (const line of room.lines) {
      const match =
        byId.get(line.itemId) ??
        byRoomDescription.get(`${room.room}::${line.description}`);
      if (!match) continue;

      includedItems[match.id] = true;
      quantities[match.id] = normalizeBudgetQuantity(line.quantity);
      unitAmounts[match.id] = line.unitAmount;
      sliderPercents[match.id] = amountToSliderPercent(
        match.low_amount,
        match.medium_amount,
        match.high_amount,
        line.unitAmount
      );
    }
  }

  return {
    ...state,
    includedRooms,
    includedItems,
    quantities,
    unitAmounts,
    sliderPercents,
    notes:
      typeof snapshot.notes === "string" && snapshot.notes
        ? snapshot.notes
        : state.notes,
  };
}

export function mergeLoadedBudgetPlan(
  saved: ClientBudgetPlanSaved,
  items: BudgetItem[],
  rooms: string[]
): BudgetPlannerState {
  const defaults = defaultBudgetPlannerState(items, rooms);
  const unitAmounts = { ...defaults.unitAmounts, ...saved.unitAmounts };

  for (const item of items) {
    if (saved.unitAmounts[item.id] !== undefined) continue;
    const percent =
      saved.sliderPercents[item.id] ??
      defaults.sliderPercents[item.id] ??
      BUDGET_SLIDER_DEFAULT_PERCENT;
    unitAmounts[item.id] = sliderPercentToAmount(
      item.low_amount,
      item.medium_amount,
      item.high_amount,
      percent
    );
  }

  const merged: BudgetPlannerState = {
    includedRooms: {
      ...defaults.includedRooms,
      ...saved.includedRooms,
    },
    includedItems: {
      ...defaults.includedItems,
      ...saved.includedItems,
    },
    quantities: {
      ...defaults.quantities,
      ...saved.quantities,
    },
    sliderPercents: {
      ...defaults.sliderPercents,
      ...saved.sliderPercents,
    },
    unitAmounts,
    notes: typeof saved.notes === "string" ? saved.notes : "",
  };

  return applySnapshotToState(merged, saved.snapshot, items);
}

export function buildClientBudgetPlanSaved(
  state: BudgetPlannerState,
  grandTotal: number,
  snapshot?: BudgetPlanSnapshot
): ClientBudgetPlanSaved {
  return {
    version: CLIENT_BUDGET_PLAN_VERSION,
    includedRooms: state.includedRooms,
    includedItems: state.includedItems,
    quantities: state.quantities,
    sliderPercents: state.sliderPercents,
    unitAmounts: state.unitAmounts,
    notes: state.notes,
    grandTotal,
    savedAt: new Date().toISOString(),
    ...(snapshot ? { snapshot } : {}),
  };
}

function parseSnapshot(value: unknown): BudgetPlanSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.rooms) || typeof record.grandTotal !== "number") {
    return undefined;
  }

  const rooms = [];
  for (const roomValue of record.rooms) {
    if (!roomValue || typeof roomValue !== "object") continue;
    const room = roomValue as Record<string, unknown>;
    if (typeof room.room !== "string" || !Array.isArray(room.lines)) continue;

    const lines = [];
    for (const lineValue of room.lines) {
      if (!lineValue || typeof lineValue !== "object") continue;
      const line = lineValue as Record<string, unknown>;
      if (
        typeof line.itemId !== "string" ||
        typeof line.description !== "string" ||
        typeof line.quantity !== "number" ||
        typeof line.unitAmount !== "number" ||
        typeof line.lineTotal !== "number"
      ) {
        continue;
      }
      lines.push({
        itemId: line.itemId,
        description: line.description,
        quantity: line.quantity,
        unitAmount: line.unitAmount,
        lineTotal: line.lineTotal,
      });
    }

    if (lines.length === 0) continue;
    rooms.push({
      room: room.room,
      total: typeof room.total === "number" ? room.total : 0,
      lines,
    });
  }

  if (rooms.length === 0) return undefined;

  return {
    rooms,
    grandTotal: record.grandTotal,
    notes: typeof record.notes === "string" ? record.notes : "",
  };
}

export function parseClientBudgetPlanSaved(
  value: unknown
): ClientBudgetPlanSaved | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  if (record.version !== CLIENT_BUDGET_PLAN_VERSION) return null;
  if (typeof record.grandTotal !== "number") return null;
  if (typeof record.savedAt !== "string") return null;

  const objectRecord = (field: string) => {
    const raw = record[field];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  };

  const includedRooms = objectRecord("includedRooms");
  const includedItems = objectRecord("includedItems");
  const quantities = objectRecord("quantities");
  const sliderPercents = objectRecord("sliderPercents");
  if (!includedRooms || !includedItems || !quantities || !sliderPercents) {
    return null;
  }

  const boolMap = (map: Record<string, unknown>) => {
    const result: Record<string, boolean> = {};
    for (const [key, val] of Object.entries(map)) {
      if (typeof val === "boolean") result[key] = val;
    }
    return result;
  };

  const numberMap = (map: Record<string, unknown>) => {
    const result: Record<string, number> = {};
    for (const [key, val] of Object.entries(map)) {
      if (typeof val === "number" && Number.isFinite(val)) result[key] = val;
    }
    return result;
  };

  const unitAmountsRaw = objectRecord("unitAmounts");
  const snapshot = parseSnapshot(record.snapshot);

  return {
    version: CLIENT_BUDGET_PLAN_VERSION,
    includedRooms: boolMap(includedRooms),
    includedItems: boolMap(includedItems),
    quantities: numberMap(quantities),
    sliderPercents: numberMap(sliderPercents),
    unitAmounts: unitAmountsRaw ? numberMap(unitAmountsRaw) : {},
    notes: typeof record.notes === "string" ? record.notes : "",
    grandTotal: record.grandTotal,
    savedAt: record.savedAt,
    ...(snapshot ? { snapshot } : {}),
  };
}
