import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BrandSkuEfficiencyRow } from "./ownBrandSkuEfficiencyUtils";

const COLORS = {
  valueShare: "#c5c9ce",
  skuShare: "#5c6570",
  indexLine: "#6b3fa0",
  efficientDot: "#6b3fa0",
  inefficientOwn: "#c0392b",
  inefficientOther: "#ffffff",
  grid: "#e5e7eb",
  tick: "#6b7280",
};

function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function IndexDot(props: {
  cx?: number;
  cy?: number;
  payload?: BrandSkuEfficiencyRow;
}) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload || !Number.isFinite(payload.indexPct)) return null;

  const highlightOwnInefficient = payload.isOwn && !payload.efficient;
  const fill = payload.efficient
    ? COLORS.efficientDot
    : highlightOwnInefficient
      ? COLORS.inefficientOwn
      : COLORS.inefficientOther;
  const stroke = highlightOwnInefficient
    ? COLORS.inefficientOwn
    : payload.efficient
      ? COLORS.efficientDot
      : "#9aa0a6";
  const strokeWidth = highlightOwnInefficient ? 3 : 1.5;
  const r = highlightOwnInefficient ? 7 : 6;

  return <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

export function OwnBrandSkuEfficiencyChart({
  rows,
  height = 340,
}: {
  rows: BrandSkuEfficiencyRow[];
  height?: number;
}) {
  const shareMax = Math.max(1, ...rows.flatMap((r) => [r.valueShare, r.skuShare]));
  const shareTop = Math.ceil(shareMax / 10) * 10 || 10;

  const indexVals = rows.map((r) => r.indexPct).filter((n) => Number.isFinite(n) && n > 0);
  const indexMin = indexVals.length ? Math.min(...indexVals) : 1;
  const indexMax = indexVals.length ? Math.max(...indexVals) : 100;
  const logLo = Math.max(1, indexMin / 2);
  const logHi = Math.max(100, indexMax * 1.25);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={rows}
        margin={{ top: 12, right: 16, left: 4, bottom: 8 }}
        barGap={2}
        barCategoryGap="28%"
      >
        <CartesianGrid stroke={COLORS.grid} vertical={false} />
        <XAxis
          dataKey="brand"
          tick={{ fontSize: 11, fontWeight: 600, fill: COLORS.tick }}
          interval={0}
          height={48}
          tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 9)}…` : v)}
        />
        <YAxis
          yAxisId="share"
          tick={{ fontSize: 10, fill: COLORS.tick }}
          domain={[0, shareTop]}
          tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
          label={{
            value: "Share %",
            angle: -90,
            position: "insideLeft",
            style: { fontSize: 10, fill: COLORS.tick },
          }}
        />
        <YAxis
          yAxisId="index"
          orientation="right"
          scale="log"
          domain={[logLo, logHi]}
          allowDataOverflow
          tick={{ fontSize: 10, fill: COLORS.tick }}
          tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
          label={{
            value: "Index (SKU ÷ Value)",
            angle: 90,
            position: "insideRight",
            style: { fontSize: 10, fill: COLORS.tick },
          }}
        />
        <Tooltip
          formatter={(value, name) => {
            const n = typeof value === "number" ? value : Number(value);
            if (!Number.isFinite(n)) return ["—", String(name)];
            if (name === "Index") return [fmtPct(n, 0), "Index (SKU ÷ Value)"];
            return [fmtPct(n, 1), String(name)];
          }}
          labelFormatter={(label) => String(label)}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar
          yAxisId="share"
          dataKey="valueShare"
          name="Value Share"
          fill={COLORS.valueShare}
          isAnimationActive={false}
          maxBarSize={36}
        />
        <Bar
          yAxisId="share"
          dataKey="skuShare"
          name="SKU Share"
          fill={COLORS.skuShare}
          isAnimationActive={false}
          maxBarSize={36}
        />
        <Line
          yAxisId="index"
          type="monotone"
          dataKey="indexPct"
          name="Index"
          stroke={COLORS.indexLine}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={<IndexDot />}
          activeDot={{ r: 8 }}
          isAnimationActive={false}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
