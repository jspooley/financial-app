import type { BudgetItem } from "./types";
import { roundMoney } from "./utils";

export const BUDGET_SLIDER_DEFAULT_PERCENT = 50;

/** Map slider 0–100 to amount; 50% = medium (save ↔ splurge). */
export function sliderPercentToAmount(
  low: number,
  medium: number,
  high: number,
  percent: number
) {
  const p = Math.max(0, Math.min(100, percent));
  const lo = Number(low) || 0;
  const med = Number(medium) || 0;
  const hi = Number(high) || 0;

  if (p <= 50) {
    if (lo === med) return roundMoney(lo);
    return roundMoney(lo + (med - lo) * (p / 50));
  }
  if (med === hi) return roundMoney(med);
  return roundMoney(med + (hi - med) * ((p - 50) / 50));
}

/**
 * Inverse of sliderPercentToAmount. Amounts outside low–high clamp to the
 * nearest end; within range they map back onto the save→medium→splurge curve.
 */
export function amountToSliderPercent(
  low: number,
  medium: number,
  high: number,
  amount: number
) {
  const lo = Number(low) || 0;
  const med = Number(medium) || 0;
  const hi = Number(high) || 0;
  const value = Number(amount);
  if (!Number.isFinite(value)) return BUDGET_SLIDER_DEFAULT_PERCENT;

  const min = Math.min(lo, med, hi);
  const max = Math.max(lo, med, hi);
  const clamped = Math.max(min, Math.min(max, value));

  if (lo === med && med === hi) return BUDGET_SLIDER_DEFAULT_PERCENT;

  if (clamped <= med) {
    if (lo === med) return clamped <= lo ? 0 : 50;
    if (clamped <= lo) return 0;
    return Math.round((50 * (clamped - lo)) / (med - lo));
  }

  if (med === hi) return 100;
  if (clamped >= hi) return 100;
  return Math.round(50 + (50 * (clamped - med)) / (hi - med));
}

export function clampBudgetUnitAmount(
  low: number,
  medium: number,
  high: number,
  amount: number
) {
  const lo = Number(low) || 0;
  const med = Number(medium) || 0;
  const hi = Number(high) || 0;
  const min = Math.min(lo, med, hi);
  const max = Math.max(lo, med, hi);
  const value = Number(amount);
  if (!Number.isFinite(value)) return roundMoney(med);
  return roundMoney(Math.max(min, Math.min(max, value)));
}

export function normalizeBudgetQuantity(value: number) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

export function budgetLineTotal(unitAmount: number, quantity: number) {
  return roundMoney(unitAmount * normalizeBudgetQuantity(quantity));
}

export function groupBudgetItemsByRoom(items: BudgetItem[]) {
  const grouped = new Map<string, BudgetItem[]>();
  for (const item of items) {
    const list = grouped.get(item.room) ?? [];
    list.push(item);
    grouped.set(item.room, list);
  }
  return grouped;
}

export function sortBudgetRooms(
  rooms: string[],
  preferredOrder: readonly string[]
) {
  const orderIndex = new Map(preferredOrder.map((room, index) => [room, index]));
  return [...rooms].sort((a, b) => {
    const aIndex = orderIndex.get(a);
    const bIndex = orderIndex.get(b);
    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    return a.localeCompare(b);
  });
}

/**
 * After loading a client budget: rooms with a non-zero total float to the top
 * (A–Z). Remaining rooms keep the usual preferred order.
 */
export function sortBudgetRoomsByLoadedTotals(
  rooms: string[],
  roomTotals: Map<string, number> | Record<string, number>,
  preferredOrder: readonly string[]
) {
  const totalOf = (room: string) => {
    if (roomTotals instanceof Map) return Number(roomTotals.get(room) ?? 0);
    return Number(roomTotals[room] ?? 0);
  };
  const nonZero = rooms
    .filter((room) => totalOf(room) > 0)
    .sort((a, b) => a.localeCompare(b));
  const zero = rooms.filter((room) => totalOf(room) <= 0);
  return [...nonZero, ...sortBudgetRooms(zero, preferredOrder)];
}

export interface BudgetPlanLine {
  itemId: string;
  description: string;
  quantity: number;
  unitAmount: number;
  lineTotal: number;
}

export interface BudgetPlanRoom {
  room: string;
  total: number;
  lines: BudgetPlanLine[];
}

export interface BudgetPlanSnapshot {
  rooms: BudgetPlanRoom[];
  grandTotal: number;
  notes: string;
}

export function buildBudgetPlanSnapshot(
  items: BudgetItem[],
  rooms: string[],
  includedRooms: Record<string, boolean>,
  includedItems: Record<string, boolean>,
  quantities: Record<string, number>,
  sliderPercents: Record<string, number>,
  unitAmounts: Record<string, number> = {},
  notes = ""
): BudgetPlanSnapshot {
  const itemsByRoom = groupBudgetItemsByRoom(items);
  const planRooms: BudgetPlanRoom[] = [];

  for (const room of rooms) {
    if (!includedRooms[room]) continue;

    const lines: BudgetPlanLine[] = [];
    for (const item of itemsByRoom.get(room) ?? []) {
      if (!includedItems[item.id]) continue;

      const percent = sliderPercents[item.id] ?? BUDGET_SLIDER_DEFAULT_PERCENT;
      const quantity = quantities[item.id] ?? 0;
      const storedAmount = unitAmounts[item.id];
      const unitAmount =
        typeof storedAmount === "number" && Number.isFinite(storedAmount)
          ? roundMoney(storedAmount)
          : sliderPercentToAmount(
              item.low_amount,
              item.medium_amount,
              item.high_amount,
              percent
            );
      lines.push({
        itemId: item.id,
        description: item.item_description,
        quantity,
        unitAmount,
        lineTotal: budgetLineTotal(unitAmount, quantity),
      });
    }

    if (lines.length === 0) continue;

    planRooms.push({
      room,
      total: roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0)),
      lines,
    });
  }

  return {
    rooms: planRooms,
    grandTotal: roundMoney(planRooms.reduce((sum, room) => sum + room.total, 0)),
    notes,
  };
}
