import type { BudgetItem } from "./types";
import { roundMoney } from "./utils";

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

export const BUDGET_SLIDER_DEFAULT_PERCENT = 50;

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
}

export function buildBudgetPlanSnapshot(
  items: BudgetItem[],
  rooms: string[],
  includedRooms: Record<string, boolean>,
  includedItems: Record<string, boolean>,
  quantities: Record<string, number>,
  sliderPercents: Record<string, number>
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
      const unitAmount = sliderPercentToAmount(
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
  };
}
