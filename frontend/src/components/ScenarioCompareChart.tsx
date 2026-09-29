import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { axisTicks, type ScenarioComparePoint } from "../lib/scenarioCompareChart";

function fmt(n: number, d = 1): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

type ShareBarShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
};

/** Left bar in each pair — extend 1px into the seam so vol/val share touch. */
function VolShareBarShape({ x = 0, y = 0, width = 0, height = 0, fill }: ShareBarShapeProps) {
  if (width <= 0 || height <= 0) return null;
  return (
    <Rectangle
      x={x}
      y={y}
      width={width + 1}
      height={height}
      fill={fill}
      radius={[4, 0, 0, 0]}
    />
  );
}

/** Right bar in each pair — pull 1px left to close the gap with vol share. */
function ValShareBarShape({ x = 0, y = 0, width = 0, height = 0, fill }: ShareBarShapeProps) {
  if (width <= 0 || height <= 0) return null;
  return (
    <Rectangle
      x={x - 1}
      y={y}
      width={width + 1}
      height={height}
      fill={fill}
      radius={[0, 4, 0, 0]}
    />
  );
}

function ScenarioCompareChartBody({ data }: { data: ScenarioComparePoint[] }) {
  const shareVals = data.flatMap((d) => [d.volShare, d.valShare]);
  const shareMax = Math.max(1, ...shareVals);
  const shareTicks = axisTicks(0, shareMax * 1.15);
  const shareDomain: [number, number] = [0, shareTicks[shareTicks.length - 1]];

  const idxVals = data.map((d) => d.revIndex);
  const idxLo = Math.min(...idxVals, 100);
  const idxHi = Math.max(...idxVals, 100);
  const idxPad = Math.max(15, (idxHi - idxLo) * 0.75);
  const idxTicks = axisTicks(idxLo - idxPad, idxHi + idxPad, 100);
  const idxDomain: [number, number] = [idxTicks[0], idxTicks[idxTicks.length - 1]];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 12, left: 4, bottom: 8 }}
        barGap={0}
        barCategoryGap="34%"
      >
        <CartesianGrid stroke="#d8dee8" vertical={false} />
        <XAxis dataKey="scenario" tick={{ fontSize: 12, fontWeight: 600 }} />
        <YAxis
          yAxisId="share"
          tick={{ fontSize: 10 }}
          domain={shareDomain}
          ticks={shareTicks}
          allowDataOverflow
          tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
          label={{
            value: "Share %",
            angle: -90,
            position: "insideLeft",
            style: { fontSize: 10 },
          }}
        />
        <YAxis
          yAxisId="index"
          orientation="right"
          tick={{ fontSize: 10 }}
          domain={idxDomain}
          ticks={idxTicks}
          allowDataOverflow
          allowDecimals={false}
          label={{
            value: "Revenue index",
            angle: 90,
            position: "insideRight",
            style: { fontSize: 10 },
          }}
        />
        <ReferenceLine yAxisId="index" y={100} stroke="#b8c0cc" strokeDasharray="4 4" />
        <Tooltip
          formatter={(value, name) => {
            const n = typeof value === "number" ? value : Number(value);
            if (!Number.isFinite(n)) return ["—", String(name)];
            if (name === "Revenue index") return [fmt(n, 1), String(name)];
            return [`${fmt(n, 2)}%`, String(name)];
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar
          yAxisId="share"
          dataKey="volShare"
          name="Vol share"
          fill="#5C6B80"
          isAnimationActive={false}
          shape={VolShareBarShape}
        />
        <Bar
          yAxisId="share"
          dataKey="valShare"
          name="Val share"
          fill="#002D62"
          isAnimationActive={false}
          shape={ValShareBarShape}
        />
        <Line
          yAxisId="index"
          type="monotone"
          dataKey="revIndex"
          name="Revenue index"
          stroke="#C41230"
          strokeWidth={2.5}
          dot={{ r: 5, fill: "#C41230", strokeWidth: 0 }}
          activeDot={{ r: 6 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function ScenarioCompareChart({
  data,
  embedded = false,
}: {
  data: ScenarioComparePoint[];
  embedded?: boolean;
}) {
  if (embedded) {
    return <ScenarioCompareChartBody data={data} />;
  }

  return (
    <div className="scenario-compare-chart-block">
      <div className="scenario-compare-chart-wrap">
        <ScenarioCompareChartBody data={data} />
      </div>
    </div>
  );
}
