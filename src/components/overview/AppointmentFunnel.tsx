import Link from "next/link";

const COLORS = [
  "#0c3d6e",
  "#1f6fbe",
  "#2498b0",
  "#b08968",
  "#7a68b0",
  "#8d4e56",
  "#d4653a",
  "#e08a2e",
];

export type FunnelStage = {
  label: string;
  value: string | number;
  href: string;
  hint?: string;
};

const VIEW_WIDTH = 200;
const VIEW_HEIGHT = 320;
const TOP_WIDTH = 196;
const BOTTOM_WIDTH = 52;

/** Sides cave inward: narrows quickly, then eases toward the tip. */
function widthAt(t: number) {
  const curved = Math.pow(Math.min(1, Math.max(0, t)), 0.55);
  return TOP_WIDTH + (BOTTOM_WIDTH - TOP_WIDTH) * curved;
}

function bandPoints(index: number, count: number) {
  const steps = 8;
  const left: string[] = [];
  const right: string[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = (index + step / steps) / count;
    const y = ((index + step / steps) / count) * VIEW_HEIGHT;
    const half = widthAt(t) / 2;
    left.push(`${VIEW_WIDTH / 2 - half},${y}`);
    right.push(`${VIEW_WIDTH / 2 + half},${y}`);
  }
  return [...left, ...right.reverse()].join(" ");
}

export function AppointmentFunnel({ stages }: { stages: FunnelStage[] }) {
  const count = stages.length;

  return (
    <div className="flex h-full min-h-72 w-full min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="shrink-0 text-center text-lg font-semibold text-slate-900">
        Sales Funnel
      </h2>
      <div className="relative mt-3 min-h-0 flex-1">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label="Sales Funnel"
        >
          {stages.map((stage, index) => (
            <polygon
              key={stage.label}
              points={bandPoints(index, count)}
              fill={COLORS[index % COLORS.length]}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col">
          {stages.map((stage, index) => {
            const inner = widthAt((index + 0.55) / count) / VIEW_WIDTH;
            return (
              <Link
                key={stage.href}
                href={stage.href}
                title={stage.hint ? `${stage.label}: ${stage.hint}` : stage.label}
                className="flex min-h-0 flex-1 items-center justify-center text-center text-white"
              >
                <span
                  className="flex flex-col items-center leading-tight"
                  style={{ maxWidth: `${Math.max(32, Math.round(inner * 100) - 2)}%` }}
                >
                  <span className="text-[11px] font-medium">{stage.label}</span>
                  <span className="text-sm font-semibold">{stage.value}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
