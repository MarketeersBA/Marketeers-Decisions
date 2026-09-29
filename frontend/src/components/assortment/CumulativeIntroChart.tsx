import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { IntroStep } from "./cumulativeIntroUtils";
import { canShowPsr, findMaxJumpStep, toChartData } from "./cumulativeIntroUtils";

const COLORS = {
  wdFill: "#d4d4d4",
  shareFirst: "#1e4d7a",
  shareHighlight: "#4a7fb8",
  shareRest: "#9aa0a6",
  psr: "#c0392b",
  push: "#2d8a4e",
};

function tickFormatter(value: string) {
  if (value.length <= 22) return value;
  return `${value.slice(0, 20)}…`;
}

function barFill(step: IntroStep, maxJumpName: string | undefined): string {
  if (step.step === 1) return COLORS.shareFirst;
  if (step.pushWd) return COLORS.shareHighlight;
  if (maxJumpName && step.productName === maxJumpName) return COLORS.shareHighlight;
  return COLORS.shareRest;
}

function BarTopLabels({
  x,
  y,
  width,
  index,
  chartData,
}: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  index?: number;
  chartData: ReturnType<typeof toChartData>;
}) {
  if (x == null || y == null || width == null || index == null) return null;
  const entry = chartData[index];
  if (!entry) return null;

  const cx = Number(x) + Number(width) / 2;
  const barTop = Number(y);
  const pct = `${Math.round(entry.cumulativeSharePct)}%`;

  if (entry.pushWd) {
    const label = entry.pushLabel ?? "Push";
    const short = label.length > 24 ? `${label.slice(0, 22)}…` : label;
    const labelWidth = Math.min(130, short.length * 5.8);
    const calloutTop = barTop - 58;
    const pctY = barTop - 34;
    const triangleBaseY = barTop - 8;
    const triangleTipY = barTop - 20;

    return (
      <g>
        <rect
          x={cx - labelWidth / 2}
          y={calloutTop}
          width={labelWidth}
          height={20}
          rx={3}
          fill="#fff"
          stroke="#ccc"
          strokeWidth={1}
        />
        <text x={cx} y={calloutTop + 14} textAnchor="middle" fontSize={9} fill="#333">
          {short}
        </text>
        <text
          x={cx}
          y={pctY}
          textAnchor="middle"
          fontSize={11}
          fontWeight={700}
          fill="#1b2740"
        >
          {pct}
        </text>
        <polygon
          points={`${cx},${triangleTipY} ${cx - 7},${triangleBaseY} ${cx + 7},${triangleBaseY}`}
          fill={COLORS.push}
        />
      </g>
    );
  }

  return (
    <text
      x={cx}
      y={barTop - 8}
      textAnchor="middle"
      fontSize={11}
      fontWeight={700}
      fill="#1b2740"
    >
      {pct}
    </text>
  );
}

export function CumulativeIntroChart({
  steps,
  height = 360,
}: {
  steps: IntroStep[];
  height?: number;
}) {
  const chartData = toChartData(steps);
  const showPsr = canShowPsr(steps);
  const maxJump = findMaxJumpStep(steps);
  const maxJumpName = maxJump?.productName;
  const shareLabel = "Cumulative value share";

  const psrValues = chartData.map((d) => d.psr).filter((v): v is number => v != null && v > 0);
  const maxDataPsr = psrValues.length > 0 ? Math.max(...psrValues) : 1;
  const psrMax = maxDataPsr * 1.15;
  const shareValues = chartData.flatMap((d) => [d.cumulativeSharePct, d.wd ?? 0]);
  const maxShare = shareValues.length > 0 ? Math.max(...shareValues) : 100;
  const shareAxisMax = Math.max(100, Math.ceil(maxShare / 10) * 10);
  const shareTicks = Array.from({ length: shareAxisMax / 10 + 1 }, (_, i) => i * 10);
  const hasPushLabels = chartData.some((entry) => entry.pushWd);
  const chartTopMargin = hasPushLabels ? 72 : 52;

  return (
    <div className="assortment-cum-chart">
      <div className="assortment-cum-chart-frame">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={chartData}
            margin={{ top: chartTopMargin, right: showPsr ? 48 : 12, left: 8, bottom: 72 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e7eb)" vertical={false} />
            <XAxis
              dataKey="name"
              interval={0}
              tickFormatter={tickFormatter}
              angle={-90}
              textAnchor="end"
              height={70}
              tick={{ fontSize: 9, fill: "var(--text-muted, #6b7280)" }}
              tickMargin={4}
            />
            <YAxis
              yAxisId="share"
              domain={[0, shareAxisMax]}
              ticks={shareTicks}
              unit="%"
              width={42}
              tick={{ fontSize: 10, fill: "var(--text-muted, #6b7280)" }}
            />
            {showPsr ? (
              <YAxis
                yAxisId="psr"
                orientation="right"
                domain={[0, psrMax]}
                width={42}
                tickFormatter={(val: number) => Number(val.toFixed(2)).toString()}
                tick={{ fontSize: 10, fill: COLORS.psr }}
              />
            ) : null}
            <Tooltip
              formatter={(value, name, item) => {
                const n = typeof value === "number" ? value : Number(value);
                if (!Number.isFinite(n)) return [String(value), String(name)];
                if (name === "WD") return [`${n.toFixed(2)}%`, "WD"];
                if (name === "Product sales rate") return [n.toFixed(4), "Product sales rate"];
                if (name === shareLabel) {
                  const raw = item?.payload?.rawCumulativeSharePct;
                  const actual = typeof raw === "number" ? raw : n;
                  return [`${actual.toFixed(2)}%`, shareLabel];
                }
                return [n.toFixed(2), String(name)];
              }}
              labelFormatter={(label) => String(label)}
            />

            {/* WD shaded background — rendered first so columns sit on top */}
            <Area
              yAxisId="share"
              type="monotone"
              dataKey="wd"
              name="WD"
              fill={COLORS.wdFill}
              stroke="#b8b8b8"
              strokeWidth={1}
              fillOpacity={0.5}
              isAnimationActive={false}
              legendType="none"
            />

            {/* Cumulative share columns */}
            <Bar
              yAxisId="share"
              dataKey="cumulativeSharePct"
              name={shareLabel}
              maxBarSize={52}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
              label={(props) => <BarTopLabels {...props} chartData={chartData} />}
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.productName}
                  fill={barFill(entry, maxJumpName)}
                  fillOpacity={0.9}
                />
              ))}
            </Bar>

            {/* Product sales rate — red line on right axis */}
            {showPsr ? (
              <Line
                yAxisId="psr"
                type="monotone"
                dataKey="psr"
                name="Product sales rate"
                stroke={COLORS.psr}
                strokeWidth={2.5}
                dot={{ r: 4, fill: "#fff", stroke: COLORS.psr, strokeWidth: 2 }}
                activeDot={{ r: 5 }}
                connectNulls
                isAnimationActive={false}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="assortment-chart-legend">
        <span>
          <i className="swatch wd" /> WD
        </span>
        <span>
          <i className="swatch share-mix" /> {shareLabel}
        </span>
        {showPsr ? (
          <span>
            <i className="swatch psr" /> Product sales rate
          </span>
        ) : null}
        <span>
          <i className="swatch push" /> Push WD
        </span>
      </div>

      {showPsr ? (
        <p className="assortment-chart-formula">
          Product Sales Rate = Value Share ÷ WD
        </p>
      ) : null}
    </div>
  );
}
