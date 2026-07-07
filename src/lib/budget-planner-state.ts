import {
  BUDGET_SLIDER_DEFAULT_PERCENT,
  normalizeBudgetQuantity,
} from "@/lib/budget-utils";
import type { BudgetItem } from "@/lib/types";

export const CLIENT_BUDGET_PLAN_VERSION = 1;

export interface BudgetPlannerState {
  includedRooms: Record<string, boolean>;
  includedItems: Record<string, boolean>;
  quantities: Record<string, number>;
  sliderPercents: Record<string, number>;
}

export interface ClientBudgetPlanSaved extends BudgetPlannerState {
  version: typeof CLIENT_BUDGET_PLAN_VERSION;
  grandTotal: number;
  savedAt: string;
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

  for (const item of items) {
    includedItems[item.id] = false;
    quantities[item.id] = normalizeBudgetQuantity(item.quantity);
    sliderPercents[item.id] = BUDGET_SLIDER_DEFAULT_PERCENT;
  }

  return { includedRooms, includedItems, quantities, sliderPercents };
}

export function mergeLoadedBudgetPlan(
  saved: ClientBudgetPlanSaved,
  items: BudgetItem[],
  rooms: string[]
): BudgetPlannerState {
  const defaults = defaultBudgetPlannerState(items, rooms);

  return {
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
  };
}

export function buildClientBudgetPlanSaved(
  state: BudgetPlannerState,
  grandTotal: number
): ClientBudgetPlanSaved {
  return {
    version: CLIENT_BUDGET_PLAN_VERSION,
    includedRooms: state.includedRooms,
    includedItems: state.includedItems,
    quantities: state.quantities,
    sliderPercents: state.sliderPercents,
    grandTotal,
    savedAt: new Date().toISOString(),
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

  return {
    version: CLIENT_BUDGET_PLAN_VERSION,
    includedRooms: boolMap(includedRooms),
    includedItems: boolMap(includedItems),
    quantities: numberMap(quantities),
    sliderPercents: numberMap(sliderPercents),
    grandTotal: record.grandTotal,
    savedAt: record.savedAt,
  };
}
