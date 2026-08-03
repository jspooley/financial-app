"use client";

import { useEffect, useMemo, useState } from "react";
import type { BudgetPlannerState } from "@/lib/budget-planner-state";
import {
  BUDGET_SLIDER_DEFAULT_PERCENT,
  amountToSliderPercent,
  budgetLineTotal,
  buildBudgetPlanSnapshot,
  clampBudgetUnitAmount,
  groupBudgetItemsByRoom,
  normalizeBudgetQuantity,
  sliderPercentToAmount,
  sortBudgetRooms,
  type BudgetPlanSnapshot,
} from "@/lib/budget-utils";
import { BUDGET_ROOM_OPTIONS, type BudgetItem } from "@/lib/types";
import { formatCurrency, roundMoney } from "@/lib/utils";

interface BudgetPlannerProps {
  items: BudgetItem[];
  onPlanChange?: (plan: BudgetPlanSnapshot) => void;
  onPlannerStateChange?: (state: BudgetPlannerState) => void;
  loadedPlanState?: BudgetPlannerState | null;
  loadPlanToken?: number;
}

export function BudgetPlanner({
  items,
  onPlanChange,
  onPlannerStateChange,
  loadedPlanState,
  loadPlanToken = 0,
}: BudgetPlannerProps) {
  const rooms = useMemo(() => {
    const grouped = groupBudgetItemsByRoom(items);
    return sortBudgetRooms([...grouped.keys()], BUDGET_ROOM_OPTIONS);
  }, [items]);

  const [includedRooms, setIncludedRooms] = useState<Record<string, boolean>>({});
  const [expandedRooms, setExpandedRooms] = useState<Record<string, boolean>>({});
  const [includedItems, setIncludedItems] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [sliderPercents, setSliderPercents] = useState<Record<string, number>>({});
  const [unitAmounts, setUnitAmounts] = useState<Record<string, number>>({});
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!loadedPlanState || loadPlanToken === 0) return;

    setIncludedRooms(loadedPlanState.includedRooms);
    setIncludedItems(loadedPlanState.includedItems);
    setQuantities(loadedPlanState.quantities);
    setSliderPercents(loadedPlanState.sliderPercents);
    setUnitAmounts(loadedPlanState.unitAmounts);
    setNotes(loadedPlanState.notes ?? "");
    setAmountDrafts({});
  }, [loadedPlanState, loadPlanToken]);

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
        if (next[room] === undefined) next[room] = false;
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
    setUnitAmounts((current) => {
      const next = { ...current };
      for (const item of items) {
        if (next[item.id] === undefined) {
          next[item.id] = sliderPercentToAmount(
            item.low_amount,
            item.medium_amount,
            item.high_amount,
            BUDGET_SLIDER_DEFAULT_PERCENT
          );
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
        return sum + budgetLineTotal(unitAmount, quantity);
      }, 0);
      totals.set(room, total);
    }
    return totals;
  }, [
    rooms,
    includedRooms,
    includedItems,
    quantities,
    itemsByRoom,
    sliderPercents,
    unitAmounts,
  ]);

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
        sliderPercents,
        unitAmounts,
        notes
      ),
    [
      items,
      rooms,
      includedRooms,
      includedItems,
      quantities,
      sliderPercents,
      unitAmounts,
      notes,
    ]
  );

  const plannerState = useMemo(
    () => ({
      includedRooms,
      includedItems,
      quantities,
      sliderPercents,
      unitAmounts,
      notes,
    }),
    [includedRooms, includedItems, quantities, sliderPercents, unitAmounts, notes]
  );

  useEffect(() => {
    onPlanChange?.(planSnapshot);
  }, [planSnapshot, onPlanChange]);

  useEffect(() => {
    onPlannerStateChange?.(plannerState);
  }, [plannerState, onPlannerStateChange]);

  function applySliderPercent(item: BudgetItem, percent: number) {
    const nextPercent = Math.max(0, Math.min(100, percent));
    const nextAmount = sliderPercentToAmount(
      item.low_amount,
      item.medium_amount,
      item.high_amount,
      nextPercent
    );
    setSliderPercents((current) => ({ ...current, [item.id]: nextPercent }));
    setUnitAmounts((current) => ({ ...current, [item.id]: nextAmount }));
    setAmountDrafts((current) => {
      if (!(item.id in current)) return current;
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  }

  function commitExactAmount(item: BudgetItem, rawValue: string) {
    const parsed = Number(rawValue.replace(/[$,\s]/g, ""));
    const nextAmount = clampBudgetUnitAmount(
      item.low_amount,
      item.medium_amount,
      item.high_amount,
      parsed
    );
    const nextPercent = amountToSliderPercent(
      item.low_amount,
      item.medium_amount,
      item.high_amount,
      nextAmount
    );
    setUnitAmounts((current) => ({ ...current, [item.id]: nextAmount }));
    setSliderPercents((current) => ({ ...current, [item.id]: nextPercent }));
    setAmountDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  }

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
        const roomExpanded = expandedRooms[room] ?? false;

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
                  const lineTotal = budgetLineTotal(unitAmount, quantity);
                  const amountDraft = amountDrafts[item.id];
                  const amountInputValue =
                    amountDraft !== undefined ? amountDraft : String(unitAmount);

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

                        <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
                          <div className="grid grid-cols-[5.5rem_11.7rem_5.5rem_4.5rem] items-center gap-x-2 max-lg:my-1 max-lg:w-full">
                            <div className="flex w-[5.5rem] items-center justify-end gap-[2ch]">
                              <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">
                                save
                              </span>
                              <span className="text-right text-xs font-medium tabular-nums text-slate-700">
                                {formatCurrency(item.low_amount)}
                              </span>
                            </div>
                            <div className="w-[11.7rem]">
                              <input
                                type="range"
                                min={0}
                                max={100}
                                step={1}
                                value={percent}
                                disabled={!itemIncluded}
                                onChange={(event) =>
                                  applySliderPercent(item, Number(event.target.value))
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
                          <label className="flex items-center gap-2">
                            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                              Amount
                            </span>
                            <input
                              type="number"
                              min={Math.min(
                                item.low_amount,
                                item.medium_amount,
                                item.high_amount
                              )}
                              max={Math.max(
                                item.low_amount,
                                item.medium_amount,
                                item.high_amount
                              )}
                              step={0.01}
                              value={amountInputValue}
                              disabled={!itemIncluded}
                              onChange={(event) =>
                                setAmountDrafts((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              onBlur={(event) =>
                                commitExactAmount(item, event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.currentTarget.blur();
                                }
                              }}
                              className="w-28 rounded-lg border border-brand-300 bg-white px-2 py-1 text-sm tabular-nums shadow-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60"
                              aria-label={`${item.item_description} exact amount`}
                            />
                          </label>
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

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-900">Notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Optional notes for this investment approach…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
      </div>

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
