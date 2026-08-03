import {
  BUDGET_SLIDER_DEFAULT_PERCENT,
  normalizeBudgetQuantity,
  sliderPercentToAmount,
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
    unitAmounts,
    notes: typeof saved.notes === "string" ? saved.notes : "",
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
    unitAmounts: state.unitAmounts,
    notes: state.notes,
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

  const unitAmountsRaw = objectRecord("unitAmounts");

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
  };
}
