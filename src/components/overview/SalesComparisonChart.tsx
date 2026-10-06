"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { OverviewChartMonth, OverviewChartSeries } from "@/lib/overview-chart";
import { formatCurrency, roundMoney } from "@/lib/utils";

type DepartmentFilter = "interior" | "paint" | "both";

const FILTERS: { id: DepartmentFilter; label: string }[] = [
  { id: "interior", label: "Interior Design" },
  { id: "paint", label: "Paint" },
  { id: "both", label: "Both" },
];

const SALES_COLOR = "#f4a8c4";
const COST_COLOR = "#f97316";
const EXPENSE_COLOR = "#dc2626";
const PROFIT_COLOR = "#16a34a";
const APPOINTMENT_COLOR = "#1341a3";

const WIDTH = 760;
const HEIGHT = 300;
const PAD_LEFT = 52;
const PAD_RIGHT = 36;
const PAD_TOP = 12;
const PAD_BOTTOM = 32;

function compactMoney(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1000) {
    const thousands = abs / 1000;
    const text =
      thousands >= 10 || Number.isInteger(thousands)
        ? String(Math.round(thousands))
        : thousands.toFixed(1).replace(/\.0$/, "");
    return `${sign}$${text}K`;
  }
  return `${sign}$${Math.round(abs)}`;
}

function niceStep(span: number) {
  if (span <= 0) return 1;
  const exponent = Math.pow(10, Math.floor(Math.log10(span)));
  const fraction = span / exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return (nice * exponent) / 4;
}

function axisTicks(min: number, max: number) {
  const step = niceStep(max - min);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step * 0.01; value += step) {
    ticks.push(Math.round(value * 100) / 100);
  }
  return { ticks, start, end: Math.max(end, start + step) };
}

function signedClass(value: number) {
  if (value < -0.005) return "text-red-700";
  if (value > 0.005) return "text-emerald-700";
  return "text-slate-700";
}

function asNegative(value: number) {
  return Math.abs(value) < 0.005 ? 0 : -value;
}

export function SalesComparisonChart({
  year,
  series,
  appointments,
  aside,
}: {
  year: number;
  series: OverviewChartSeries;
  appointments: number[];
  aside?: ReactNode;
}) {
  const [filter, setFilter] = useState<DepartmentFilter>("both");
  const [showDetails, setShowDetails] = useState(false);
  const [boxWidth, setBoxWidth] = useState(67);
  const months = series[filter];
  const ytd = useMemo(() => sumYearToDate(months), [months]);
  const appointmentTotal = appointments.reduce((total, count) => total + count, 0);
  const chart = useMemo(
    () => layoutChart(months, appointments),
    [months, appointments]
  );

  return (
    <div className="mb-6">
      <div
        className="grid items-start gap-3 md:grid-cols-[var(--chart-width)_minmax(0,1fr)]"
        style={{ ["--chart-width" as string]: `${boxWidth}%` }}
      >
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Business Overview</h2>
        <div
          className="inline-flex shrink-0 rounded-lg border border-slate-200 p-0.5"
          role="group"
          aria-label="Department"
        >
          {FILTERS.map((option) => {
            const selected = filter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setFilter(option.id)}
                className={`min-h-9 rounded-md px-3 text-sm font-medium ${
                  selected
                    ? "bg-brand-600 text-white"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="mt-4 flex max-w-sm items-center gap-3 text-sm text-slate-600">
        <span className="shrink-0">Width</span>
        <input
          type="range"
          min={40}
          max={75}
          value={boxWidth}
          aria-label="Chart width"
          onChange={(event) => setBoxWidth(Number(event.target.value))}
          className="h-2 w-full cursor-pointer accent-brand-600"
        />
      </label>

      <div className="mt-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`Monthly sales, cost, expenses, profit, and appointments for ${year}`}
          className="h-auto w-full"
        >
          {chart.ticks.map((tick) => (
            <g key={tick.value}>
              <line
                x1={PAD_LEFT}
                x2={WIDTH - PAD_RIGHT}
                y1={tick.y}
                y2={tick.y}
                stroke={tick.value === 0 ? "#94a3b8" : "#e2e8f0"}
                strokeWidth={tick.value === 0 ? 1.25 : 1}
              />
              <text
                x={PAD_LEFT - 8}
                y={tick.y + 4}
                textAnchor="end"
                fill="#64748b"
                fontSize="11"
              >
                {compactMoney(tick.value)}
              </text>
            </g>
          ))}

          {chart.dividers.map((divider) => (
            <line
              key={divider.x}
              x1={divider.x}
              x2={divider.x}
              y1={PAD_TOP}
              y2={HEIGHT - PAD_BOTTOM}
              stroke="#cbd5e1"
              strokeWidth={1}
            />
          ))}

          {chart.groups.map((group) => (
            <g key={group.label}>
              <Bar
                x={group.salesX}
                y={group.salesY}
                width={group.barW}
                height={group.salesH}
                fill={SALES_COLOR}
                label={`${group.label} sales ${formatCurrency(group.sales)}`}
              />
              <Bar
                x={group.stackX}
                y={group.costY}
                width={group.barW}
                height={group.costH}
                fill={COST_COLOR}
                label={`${group.label} cost ${formatCurrency(asNegative(group.cost))}`}
              />
              <Bar
                x={group.stackX}
                y={group.expenseY}
                width={group.barW}
                height={group.expenseH}
                fill={EXPENSE_COLOR}
                label={`${group.label} expenses ${formatCurrency(asNegative(group.expenses))}`}
              />
              <Bar
                x={group.profitX}
                y={group.profitY}
                width={group.barW}
                height={group.profitH}
                fill={PROFIT_COLOR}
                label={`${group.label} profit ${formatCurrency(group.profit)}`}
              />
              <text
                x={group.labelX}
                y={HEIGHT - 10}
                textAnchor="middle"
                fill="#475569"
                fontSize="12"
              >
                {group.label}
              </text>
            </g>
          ))}

          {chart.appointments.length > 1 && (
            <polyline
              points={chart.appointments.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke={APPOINTMENT_COLOR}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {chart.appointments.map((point) => (
            <g key={`appt-${point.label}`}>
              <circle cx={point.x} cy={point.y} r={4} fill={APPOINTMENT_COLOR}>
                <title>
                  {point.label} appointments {point.count}
                </title>
              </circle>
            </g>
          ))}
          {chart.appointmentTicks.map((tick) => (
            <text
              key={`appt-tick-${tick.value}`}
              x={WIDTH - PAD_RIGHT + 8}
              y={tick.y + 4}
              textAnchor="start"
              fill={APPOINTMENT_COLOR}
              fontSize="11"
            >
              {tick.value}
            </text>
          ))}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-700">
        <Legend swatch={SALES_COLOR} label="Sales income" />
        <Legend swatch={COST_COLOR} label="Cost" />
        <Legend swatch={EXPENSE_COLOR} label="Expenses" />
        <Legend swatch={PROFIT_COLOR} label="Profit" />
        <Legend swatch={APPOINTMENT_COLOR} label="Appointments" line />
      </div>

      <button
        type="button"
        aria-expanded={showDetails}
        onClick={() => setShowDetails((open) => !open)}
        className="mt-3 text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        {showDetails ? "Hide details" : "Show details"}
      </button>

      {showDetails && (
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3 font-medium" />
              {months.map((month) => (
                <th
                  key={month.label}
                  className="border-l border-slate-200 px-2 py-2 text-right font-medium"
                >
                  {month.label}
                </th>
              ))}
              <th className="sticky right-0 z-10 border-l-2 border-slate-300 bg-white px-2 py-2 text-right font-semibold text-slate-700 shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.35)]">
                YTD
              </th>
            </tr>
          </thead>
          <tbody>
            <ValueRow label="Sales" color={SALES_COLOR} values={months.map((m) => m.sales)} ytd={ytd.sales} />
            <ValueRow
              label="Cost"
              color={COST_COLOR}
              values={months.map((m) => asNegative(m.cost))}
              ytd={asNegative(ytd.cost)}
              signed
            />
            <ValueRow
              label="Expenses"
              color={EXPENSE_COLOR}
              values={months.map((m) => asNegative(m.expenses))}
              ytd={asNegative(ytd.expenses)}
              signed
            />
            <ValueRow
              label="Profit"
              color={PROFIT_COLOR}
              values={months.map((m) => m.profit)}
              ytd={ytd.profit}
              signed
            />
            <ValueRow
              label="Appointments"
              color={APPOINTMENT_COLOR}
              values={appointments}
              ytd={appointmentTotal}
              plain
            />
          </tbody>
        </table>
      </div>
      )}
    </section>
        {aside ? (
          <div className="relative min-w-0 md:self-stretch">
            <div className="h-full md:absolute md:inset-0">{aside}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Legend({
  swatch,
  label,
  line,
}: {
  swatch: string;
  label: string;
  line?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      {line ? (
        <span className="inline-flex w-4 items-center" aria-hidden>
          <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: swatch }} />
        </span>
      ) : (
        <span
          className="inline-block h-3 w-3 rounded-sm"
          style={{ backgroundColor: swatch }}
        />
      )}
      {label}
    </span>
  );
}

function ValueRow({
  label,
  color,
  values,
  ytd,
  signed,
  plain,
}: {
  label: string;
  color: string;
  values: number[];
  ytd: number;
  signed?: boolean;
  plain?: boolean;
}) {
  const format = plain ? (value: number) => String(value) : formatCurrency;
  return (
    <tr className="border-b border-slate-100">
      <th className="whitespace-nowrap py-2 pr-3 text-left font-medium text-slate-800">
        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ backgroundColor: color }} />
        {label}
      </th>
      {values.map((value, index) => (
        <td
          key={index}
          className={`border-l border-slate-200 px-2 py-2 text-right tabular-nums ${signed ? signedClass(value) : "text-slate-800"}`}
        >
          {format(value)}
        </td>
      ))}
      <td
        className={`sticky right-0 z-10 border-l-2 border-slate-300 bg-white px-2 py-2 text-right font-semibold tabular-nums shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.35)] ${signed ? signedClass(ytd) : "text-slate-900"}`}
      >
        {format(ytd)}
      </td>
    </tr>
  );
}

function sumYearToDate(months: OverviewChartMonth[]): OverviewChartMonth {
  return months.reduce<OverviewChartMonth>(
    (total, month) => ({
      label: "YTD",
      sales: roundMoney(total.sales + month.sales),
      cost: roundMoney(total.cost + month.cost),
      expenses: roundMoney(total.expenses + month.expenses),
      profit: roundMoney(total.profit + month.profit),
    }),
    { label: "YTD", sales: 0, cost: 0, expenses: 0, profit: 0 }
  );
}

function Bar({
  x,
  y,
  width,
  height,
  fill,
  label,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  label: string;
}) {
  if (height < 0.5) return null;
  return (
    <rect x={x} y={y} width={width} height={height} rx={3} fill={fill}>
      <title>{label}</title>
    </rect>
  );
}

function countAxis(maxCount: number) {
  const peak = Math.max(1, maxCount);
  const step = peak <= 5 ? 1 : peak <= 10 ? 2 : Math.ceil(peak / 4);
  const end = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= end; value += step) ticks.push(value);
  return { ticks, end };
}

function layoutChart(months: OverviewChartMonth[], appointmentCounts: number[]) {
  const values = months.flatMap((month) => [
    month.sales,
    -(month.cost + month.expenses),
    month.profit,
  ]);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const { ticks: tickValues, start, end } = axisTicks(rawMin, rawMax === rawMin ? rawMin + 1 : rawMax);
  const plotTop = PAD_TOP;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const span = end - start || 1;
  const yFor = (value: number) => plotTop + ((end - value) / span) * plotHeight;
  const zeroY = yFor(0);
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const groupWidth = plotWidth / Math.max(months.length, 1);
  const barW = Math.min(16, groupWidth * 0.2);
  const barGap = Math.max(2, groupWidth * 0.035);

  const tickMarks = tickValues.map((value) => ({
    value,
    y: yFor(value),
  }));

  const dividers = months.slice(1).map((_, index) => ({
    x: PAD_LEFT + groupWidth * (index + 1),
  }));

  const groups = months.map((month, index) => {
    const center = PAD_LEFT + groupWidth * index + groupWidth / 2;
    const cluster = barW * 3 + barGap * 2;
    const salesX = center - cluster / 2;
    const stackX = salesX + barW + barGap;
    const profitX = stackX + barW + barGap;
    const salesH = Math.abs(yFor(month.sales) - zeroY);
    const costH = Math.abs(yFor(month.cost) - zeroY);
    const expenseH = Math.abs(yFor(month.cost + month.expenses) - yFor(month.cost));
    const profitH = Math.abs(yFor(month.profit) - zeroY);
    return {
      label: month.label,
      sales: month.sales,
      cost: month.cost,
      expenses: month.expenses,
      profit: month.profit,
      labelX: center,
      barW,
      salesX,
      stackX,
      profitX,
      salesY: month.sales >= 0 ? zeroY - salesH : zeroY,
      salesH,
      costY: zeroY,
      costH,
      expenseY: zeroY + costH - (costH > 0.5 && expenseH > 0.5 ? 3 : 0),
      expenseH: expenseH + (costH > 0.5 && expenseH > 0.5 ? 3 : 0),
      profitY: month.profit >= 0 ? zeroY - profitH : zeroY,
      profitH,
    };
  });

  const { ticks: countTicks, end: countEnd } = countAxis(
    Math.max(0, ...appointmentCounts)
  );
  const aboveZero = Math.max(zeroY - plotTop, 1);
  const yForCount = (count: number) => zeroY - (count / countEnd) * aboveZero;
  const appointmentPoints = months.map((month, index) => ({
    label: month.label,
    count: appointmentCounts[index] ?? 0,
    x: PAD_LEFT + groupWidth * index + groupWidth / 2,
    y: yForCount(appointmentCounts[index] ?? 0),
  }));
  const appointmentTicks = countTicks.map((value) => ({
    value,
    y: yForCount(value),
  }));

  return {
    ticks: tickMarks,
    groups,
    dividers,
    appointments: appointmentPoints,
    appointmentTicks,
  };
}
