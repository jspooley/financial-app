"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BUDGET_SLIDER_DEFAULT_PERCENT,
  budgetLineTotal,
  buildBudgetPlanSnapshot,
  groupBudgetItemsByRoom,
  normalizeBudgetQuantity,
  sliderPercentToAmount,
  sortBudgetRooms,
  type BudgetPlanSnapshot,
} from "@/lib/budget-utils";
import { BUDGET_ROOM_OPTIONS, type BudgetItem } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

interface BudgetPlannerProps {
  items: BudgetItem[];
  onPlanChange?: (plan: BudgetPlanSnapshot) => void;
}

export function BudgetPlanner({ items, onPlanChange }: BudgetPlannerProps) {
  const rooms = useMemo(() => {
    const grouped = groupBudgetItemsByRoom(items);
    return sortBudgetRooms([...grouped.keys()], BUDGET_ROOM_OPTIONS);
  }, [items]);

  const [includedRooms, setIncludedRooms] = useState<Record<string, boolean>>({});
  const [expandedRooms, setExpandedRooms] = useState<Record<string, boolean>>({});
  const [includedItems, setIncludedItems] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [sliderPercents, setSliderPercents] = useState<Record<string, number>>({});

  useEffect(() => {
    setIncludedRooms((current) => {
      const next = { ...current };
      for (const room of rooms) {
        if (next[room] === undefined) next[room] = true;
      }
      return next;
    });
  }, [rooms]);

  useEffect(() => {
    setExpandedRooms((current) => {
      const next = { ...current };
      for (const room of rooms) {
        if (next[room] === undefined) next[room] = true;
      }
      return next;
    });
  }, [rooms]);

  useEffect(() => {
    setIncludedItems((current) => {
      const next = { ...current };
      for (const item of items) {
        if (next[item.id] === undefined) next[item.id] = false;
      }
      return next;
    });
  }, [items]);

  useEffect(() => {
    setQuantities((current) => {
      const next = { ...current };
      for (const item of items) {
        if (next[item.id] === undefined) {
          next[item.id] = normalizeBudgetQuantity(item.quantity);
        }
      }
      return next;
    });
  }, [items]);

  useEffect(() => {
    setSliderPercents((current) => {
      const next = { ...current };
      for (const item of items) {
        if (next[item.id] === undefined) {
          next[item.id] = BUDGET_SLIDER_DEFAULT_PERCENT;
        }
      }
      return next;
    });
  }, [items]);

  const itemsByRoom = useMemo(() => groupBudgetItemsByRoom(items), [items]);

  const roomTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const room of rooms) {
      if (!includedRooms[room]) {
        totals.set(room, 0);
        continue;
      }
      const roomItems = itemsByRoom.get(room) ?? [];
      const total = roomItems.reduce((sum, item) => {
        if (!includedItems[item.id]) return sum;
        const percent = sliderPercents[item.id] ?? BUDGET_SLIDER_DEFAULT_PERCENT;
        const quantity = quantities[item.id] ?? 0;
        const unitAmount = sliderPercentToAmount(
          item.low_amount,
          item.medium_amount,
          item.high_amount,
          percent
        );
        return sum + budgetLineTotal(unitAmount, quantity);
      }, 0);
      totals.set(room, total);
    }
    return totals;
  }, [rooms, includedRooms, includedItems, quantities, itemsByRoom, sliderPercents]);

  const grandTotal = useMemo(
    () => [...roomTotals.values()].reduce((sum, value) => sum + value, 0),
    [roomTotals]
  );

  const planSnapshot = useMemo(
    () =>
      buildBudgetPlanSnapshot(
        items,
        rooms,
        includedRooms,
        includedItems,
        quantities,
        sliderPercents
      ),
    [items, rooms, includedRooms, includedItems, quantities, sliderPercents]
  );

  useEffect(() => {
    onPlanChange?.(planSnapshot);
  }, [planSnapshot, onPlanChange]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
        No budget items yet. Add items in Manage Items to get started.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rooms.map((room) => {
        const roomItems = itemsByRoom.get(room) ?? [];
        const roomIncluded = includedRooms[room] ?? true;
        const roomExpanded = expandedRooms[room] ?? true;

        return (
          <section
            key={room}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <div
              className={`flex flex-wrap items-center justify-between gap-3 ${
                roomExpanded && roomIncluded
                  ? "border-b border-slate-100 pb-3"
                  : ""
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedRooms((current) => ({
                      ...current,
                      [room]: !(current[room] ?? true),
                    }))
                  }
                  className="flex size-12 shrink-0 items-center justify-center rounded-lg text-brand-700 transition hover:bg-brand-50 hover:text-brand-900"
                  aria-expanded={roomExpanded}
                  aria-label={
                    roomExpanded ? `Collapse ${room} details` : `Expand ${room} details`
                  }
                >
                  <span
                    aria-hidden
                    className={`inline-block text-4xl leading-none font-bold transition-transform ${
                      roomExpanded ? "rotate-90" : ""
                    }`}
                  >
                    ▸
                  </span>
                </button>
                <label className="flex min-w-0 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={roomIncluded}
                    onChange={(event) =>
                      setIncludedRooms((current) => ({
                        ...current,
                        [room]: event.target.checked,
                      }))
                    }
                    className="size-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-base font-semibold text-slate-900">{room}</span>
                </label>
              </div>
              <p className="text-lg font-semibold text-brand-800">
                {formatCurrency(roomTotals.get(room) ?? 0)}
              </p>
            </div>

            {roomExpanded && roomIncluded && (
              <ul className="mt-4 space-y-4">
                {roomItems.map((item) => {
                  const percent =
                    sliderPercents[item.id] ?? BUDGET_SLIDER_DEFAULT_PERCENT;
                  const itemIncluded = includedItems[item.id] ?? false;
                  const quantity = quantities[item.id] ?? 0;
                  const unitAmount = sliderPercentToAmount(
                    item.low_amount,
                    item.medium_amount,
                    item.high_amount,
                    percent
                  );
                  const lineTotal = budgetLineTotal(unitAmount, quantity);

                  return (
                    <li
                      key={item.id}
                      className={`rounded-lg border p-3 sm:p-4 ${
                        itemIncluded
                          ? "border-slate-100 bg-slate-50/60"
                          : "border-slate-100 bg-white opacity-80"
                      }`}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-3">
                        <label className="flex min-w-0 items-start gap-2 lg:w-44 lg:shrink-0 xl:w-52">
                          <input
                            type="checkbox"
                            checked={itemIncluded}
                            onChange={(event) =>
                              setIncludedItems((current) => ({
                                ...current,
                                [item.id]: event.target.checked,
                              }))
                            }
                            className="mt-0.5 size-4 shrink-0 rounded border-brand-300 text-brand-600 focus:ring-brand-500"
                          />
                          <span className="text-sm font-medium text-slate-900">
                            {item.item_description}
                          </span>
                        </label>

                        <label className="flex shrink-0 items-center gap-2 lg:w-20">
                          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Qty
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={quantity}
                            disabled={!itemIncluded}
                            onChange={(event) =>
                              setQuantities((current) => ({
                                ...current,
                                [item.id]: normalizeBudgetQuantity(
                                  Number(event.target.value)
                                ),
                              }))
                            }
                            className="w-14 rounded-lg border border-brand-300 bg-white px-2 py-1 text-sm shadow-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60"
                          />
                        </label>

                        <div className="min-w-0 flex-1 lg:grid lg:grid-cols-[auto_5.5rem_11.7rem_5.5rem_4.5rem] lg:items-center lg:gap-x-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            save
                          </span>
                          <span className="text-right text-xs font-medium tabular-nums text-slate-700">
                            {formatCurrency(item.low_amount)}
                          </span>
                          <div className="col-span-1 w-[11.7rem] max-lg:my-1">
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={1}
                              value={percent}
                              disabled={!itemIncluded}
                              onChange={(event) =>
                                setSliderPercents((current) => ({
                                  ...current,
                                  [item.id]: Number(event.target.value),
                                }))
                              }
                              className="budget-range h-2 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                              aria-label={`${item.item_description} budget slider`}
                            />
                          </div>
                          <span className="text-right text-xs font-medium tabular-nums text-slate-700">
                            {formatCurrency(item.high_amount)}
                          </span>
                          <span className="text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                            splurge
                          </span>
                        </div>

                        <div className="shrink-0 text-right lg:min-w-[6.5rem]">
                          <p
                            className={`text-base font-semibold ${
                              itemIncluded ? "text-brand-800" : "text-slate-400"
                            }`}
                          >
                            {formatCurrency(lineTotal)}
                          </p>
                          {quantity > 0 && (
                            <p className="text-xs text-slate-500">
                              {quantity} × {formatCurrency(unitAmount)}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
        <p className="text-sm font-medium uppercase tracking-wide text-brand-800">
          Total Investment
        </p>
        <p className="text-2xl font-semibold text-brand-900">
          {formatCurrency(grandTotal)}
        </p>
      </div>
    </div>
  );
}
