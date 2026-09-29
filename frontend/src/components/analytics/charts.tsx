import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ElasticityRow, SomSopRow, ValidationRow } from "../../api/analytics_types";
import { CHART_COLORS } from "./utils";

export function SomSopChart({ data }: { data: SomSopRow[] }) {
  const chartData = data.map((d) => ({ name: d.name, x: d.som * 100, y: d.sop * 100 }));
  return (
    <ResponsiveContainer width="100%" height={360}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" dataKey="x" name="SoM" unit="%" />
        <YAxis type="number" dataKey="y" name="Penetration" unit="%" />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={chartData} fill={CHART_COLORS[0]} name="SKU" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function ValidationChart({ data }: { data: ValidationRow[] }) {
  const chartData = data.map((d) => ({
    name: d.label,
    audit: d.audit * 100,
    rebased: d.rebased * 100,
  }));
  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis unit="%" />
        <Tooltip formatter={(v) => (typeof v === "number" ? `${v.toFixed(2)}%` : String(v ?? ""))} />
        <Legend />
        <Line
          type="monotone"
          dataKey="audit"
          stroke={CHART_COLORS[2]}
          name="Audit Share"
          dot
        />
        <Line
          type="monotone"
          dataKey="rebased"
          stroke={CHART_COLORS[0]}
          name="Rebased Simulator Share"
          dot
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ElasticityChart({ data, sku }: { data: ElasticityRow[]; sku: string }) {
  const row = data.find((r) => r.name === sku) ?? data[0];
  if (!row) return <p className="analytics-empty">No elasticity data.</p>;

  const chartData = Object.entries(row.levels).map(([level, value]) => ({
    level,
    change: value * 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="level" />
        <YAxis unit="%" />
        <Tooltip formatter={(v) => (typeof v === "number" ? `${v.toFixed(2)}%` : String(v ?? ""))} />
        <Legend />
        <Line
          type="monotone"
          dataKey="change"
          stroke={CHART_COLORS[0]}
          name={`${row.name} relative share change`}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PriceIndexLineChart({
  columns,
  rows,
  selectedSeries,
  yAxisLabel,
  valueScale = 100,
}: {
  columns: string[];
  rows: { name: string; values: Record<string, number> }[];
  selectedSeries: string[];
  yAxisLabel?: string;
  valueScale?: number;
}) {
  const series = rows.filter((r) => selectedSeries.includes(r.name));
  if (series.length === 0) {
    return <p className="analytics-empty">Select at least one series.</p>;
  }

  const chartData = columns.map((col) => {
    const point: Record<string, number | string> = { index: col };
    for (const row of series) {
      point[row.name] = (row.values[col] ?? 0) * valueScale;
    }
    return point;
  });

  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="index" label={{ value: "Price index", position: "insideBottom", offset: -4 }} />
        <YAxis label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: "insideLeft" } : undefined} />
        <Tooltip />
        <Legend />
        {series.map((s, i) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function FairShareChart({ data }: { data: { name: string; actualShare: number; fairShare: number }[] }) {
  const chartData = data.map((d) => ({
    name: d.name,
    actualShare: d.actualShare,
    fairShare: d.fairShare,
  }));

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" hide />
        <YAxis />
        <Tooltip />
        <Legend />
        <Bar dataKey="actualShare" fill={CHART_COLORS[0]} name="Actual Share" />
        <Bar dataKey="fairShare" fill={CHART_COLORS[2]} name="Fair Share" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function IncrementalChart({
  data,
  metric,
  height = 320,
}: {
  data: {
    productName: string;
    revenue: number;
    marketShare: number;
    distribution?: number;
    revenueDelta?: number;
    marketShareDelta?: number;
    incrementalDelta?: number;
  }[];
  metric: "revenue" | "share";
  /** Kept for callers; chart plots absolute levels for both modes. */
  mode?: "exclusive" | "cumulative";
  height?: number;
}) {
  const chartData = data.map((d) => ({
    name: d.productName,
    share: d.marketShare * 100,
    revenue: d.revenue,
    distribution: d.distribution ?? null,
  }));

  const tickFormatter = (value: string) =>
    value.length > 18 ? `${value.slice(0, 16)}…` : value;

  const barKey = metric === "revenue" ? "revenue" : "share";
  const barName = metric === "revenue" ? "Revenue" : "Market Share";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 8, bottom: 8, left: 4, right: 12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e7eb)" />
        <XAxis
          dataKey="name"
          interval={0}
          tickFormatter={tickFormatter}
          tick={{ fontSize: 11, fill: "var(--text-muted, #6b7280)" }}
          tickMargin={8}
        />
        <YAxis
          yAxisId="left"
          unit={metric === "share" ? "%" : undefined}
          width={metric === "share" ? 48 : 56}
          tick={{ fontSize: 11, fill: "var(--text-muted, #6b7280)" }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={[0, 100]}
          width={44}
          tick={{ fontSize: 11, fill: "var(--text-muted, #6b7280)" }}
        />
        <Tooltip
          formatter={(value, name) => {
            const n = typeof value === "number" ? value : Number(value);
            if (!Number.isFinite(n)) return [String(value), String(name)];
            if (name === "Distribution") return [`${n.toFixed(1)}`, "Distribution (WD)"];
            if (name === "Market Share") return [`${n.toFixed(2)}%`, "Market Share"];
            return [n.toFixed(2), "Revenue"];
          }}
        />
        <Legend verticalAlign="top" height={28} />
        <Bar
          yAxisId="left"
          dataKey={barKey}
          name={barName}
          fill={CHART_COLORS[0]}
          maxBarSize={48}
          radius={[3, 3, 0, 0]}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="distribution"
          name="Distribution"
          stroke={CHART_COLORS[1]}
          strokeWidth={2}
          dot={{ r: 4, fill: CHART_COLORS[1], strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function CrossBrandHeatmap({
  data,
}: {
  data: { products: string[]; scenarios: Record<string, Record<string, number>> };
}) {
  const scenarios = Object.keys(data.scenarios);
  return (
    <div className="analytics-heatmap">
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            {scenarios.map((s) => (
              <th key={s}>{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.products.map((p) => (
            <tr key={p}>
              <td>{p}</td>
              {scenarios.map((s) => {
                const v = (data.scenarios[s]?.[p] ?? 0) * 100;
                const bg =
                  v > 0
                    ? `rgba(76,175,80,${Math.min(0.8, Math.abs(v) / 5)})`
                    : `rgba(233,30,99,${Math.min(0.8, Math.abs(v) / 5)})`;
                return (
                  <td key={s} style={{ background: v === 0 ? undefined : bg }}>
                    {v.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
