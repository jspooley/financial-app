const CX = 110;
const CY = 108;
const RADIUS = 78;

function point(ratio: number, radius = RADIUS) {
  const angle = Math.PI * (1 - ratio);
  return {
    x: CX + radius * Math.cos(angle),
    y: CY - radius * Math.sin(angle),
  };
}

function arcPath(toRatio: number) {
  const end = Math.min(1, Math.max(0, toRatio));
  if (end < 0.001) return "";
  const steps = Math.max(8, Math.ceil(end * 48));
  let path = "";
  for (let step = 0; step <= steps; step += 1) {
    const spot = point((end * step) / steps);
    path += `${step === 0 ? "M" : "L"}${spot.x.toFixed(2)} ${spot.y.toFixed(2)}`;
  }
  return path;
}

export function GoalGauge({
  title,
  actual,
  goal,
  formatValue,
  scaleMax,
}: {
  title: string;
  actual: number;
  goal: number | null;
  formatValue: (value: number) => string;
  scaleMax: number;
}) {
  const ceiling = scaleMax > 0 ? scaleMax : 1;
  const hasGoal = goal != null && goal > 0;
  const actualRatio =
    hasGoal || ceiling > Math.max(0, actual)
      ? Math.min(1, Math.max(0, actual) / ceiling)
      : 0;
  const goalRatio = hasGoal ? Math.min(1, goal / ceiling) : null;
  const metGoal = goal != null && actual + 0.005 >= goal;
  const fill = metGoal ? "#f97316" : "#ef559e";
  const actualText = formatValue(actual);
  const goalText = goal == null ? null : formatValue(goal);
  const scaleEnd = formatValue(ceiling);

  let comparison = "Enter a goal to compare";
  if (goal != null) {
    const delta = actual - goal;
    if (Math.abs(delta) < 0.005) comparison = "At goal";
    else if (delta < 0) comparison = `${formatValue(Math.abs(delta))} below goal`;
    else comparison = `${formatValue(delta)} above goal`;
  }

  const goalMark =
    goalRatio == null
      ? null
      : {
          inner: point(goalRatio, RADIUS - 14),
          outer: point(goalRatio, RADIUS + 10),
        };
  const needleTip = point(actualRatio, RADIUS - 16);

  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <svg
        viewBox="0 0 220 124"
        className="mt-1 w-full"
        role="img"
        aria-label={`${title}. Actual ${actualText}.${
          goalText ? ` Goal ${goalText}. ${comparison}.` : ""
        }`}
      >
        <path
          d={arcPath(1)}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="14"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {actualRatio > 0 ? (
          <path
            d={arcPath(actualRatio)}
            fill="none"
            stroke={fill}
            strokeWidth="14"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {goalMark ? (
          <line
            x1={goalMark.inner.x}
            y1={goalMark.inner.y}
            x2={goalMark.outer.x}
            y2={goalMark.outer.y}
            stroke="#0f172a"
            strokeWidth="3"
            strokeLinecap="round"
          />
        ) : null}
        <line
          x1={CX}
          y1={CY}
          x2={needleTip.x}
          y2={needleTip.y}
          stroke="#334155"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r="5" fill="#334155" />
        {hasGoal || ceiling > Math.max(0, actual) ? (
          <>
            <text x="18" y="120" fill="#94a3b8" fontSize="11">
              0
            </text>
            <text x="202" y="120" textAnchor="end" fill="#94a3b8" fontSize="11">
              {scaleEnd}
            </text>
          </>
        ) : null}
      </svg>
      <p
        className={`text-center text-xl font-semibold ${
          actual < -0.005 ? "text-red-700" : metGoal ? "text-orange-600" : "text-slate-900"
        }`}
      >
        {actualText}
      </p>
      <p className="mt-1 text-center text-sm text-slate-600">
        {goalText ? `Goal ${goalText}` : "No goal set"}
      </p>
      <p className="text-center text-sm text-slate-600">{comparison}</p>
      <div className="mt-3 flex items-center justify-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ backgroundColor: fill }} />
          Actual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 rounded-sm bg-slate-900" />
          Goal
        </span>
      </div>
    </article>
  );
}
