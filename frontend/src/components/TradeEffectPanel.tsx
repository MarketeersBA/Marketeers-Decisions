import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { SomSopRow } from "../api/analytics_types";
import { useAnalytics } from "../api/hooks";
import { usePageActive } from "../hooks/usePageActive";
import { rollupSomSopByBrand, type TradeEffectBrandGroup, type TradeEffectPoint } from "./tradeEffectUtils";

const SOM_COLOR = "#4F81BD";
const BRAND_SHARE_COLOR = "#E8A317";

type ChartView = "columns" | "scatter";

interface Props {
  slug: string;
  brandGroups: TradeEffectBrandGroup[];
  ownSkuNames: Set<string>;
}

function fmtAxis(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function fmtPctLabel(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  return `${n.toFixed(1)}%`;
}

export function TradeEffectPanel({ slug, brandGroups, ownSkuNames }: Props) {
  const pageActive = usePageActive();
  const { data, isPending, error, isFetching } = useAnalytics(slug, "som-sop", {}, {
    enabled: pageActive && Boolean(slug),
  });
  const [view, setView] = useState<ChartView>("columns");
  const [series, setSeries] = useState<Set<string>>(new Set());
  const seriesKeyRef = useRef("");

  const points = useMemo(() => {
    const rows = Array.isArray(data?.data) ? (data.data as SomSopRow[]) : [];
    return rollupSomSopByBrand(rows, brandGroups, ownSkuNames);
  }, [data, brandGroups, ownSkuNames]);

  const ownBrands = useMemo(() => points.filter((point) => point.own), [points]);
  const ownBrandKey = ownBrands.map((brand) => brand.name).join("\0");

  useEffect(() => {
    if (seriesKeyRef.current === ownBrandKey) return;
    seriesKeyRef.current = ownBrandKey;
    const names = ownBrandKey ? ownBrandKey.split("\0") : [];
    setSeries(new Set(names.slice(0, 3)));
  }, [ownBrandKey]);

  const selectedRows = ownBrands.filter((point) => series.has(point.name));
  const loading = (isPending || isFetching) && points.length === 0;
  const insightSubject =
    selectedRows.length === 1
      ? selectedRows[0].name
      : selectedRows.length > 1
        ? "the selected brands"
        : "";

  const allSeriesSelected = ownBrands.length > 0 && ownBrands.every((brand) => series.has(brand.name));

  const toggleSeries = (name: string) => {
    setSeries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAllSeries = () => {
    setSeries(allSeriesSelected ? new Set() : new Set(ownBrands.map((brand) => brand.name)));
  };

  return (
    <section className="trade-effect" aria-label="Trade Effect">
      <div className="trade-effect-head">
        <div>
          <h2 className="trade-effect-title">Trade Effect</h2>
          <p className="trade-effect-sub">
            Base scenario · brand level · SOM is volume share, Brand Share is penetration.
          </p>
        </div>
        <div className="view-toggle trade-effect-switcher" role="group" aria-label="Chart view">
          <button
            type="button"
            className={view === "columns" ? "active" : ""}
            aria-pressed={view === "columns"}
            onClick={() => setView("columns")}
          >
            SOM vs SOP
          </button>
          <button
            type="button"
            className={view === "scatter" ? "active" : ""}
            aria-pressed={view === "scatter"}
            onClick={() => setView("scatter")}
          >
            Scatter
          </button>
        </div>
      </div>

      {ownBrands.length > 0 ? (
        <fieldset className="trade-effect-series">
          <legend className="trade-effect-field-label">Series</legend>
          <div className="trade-effect-series-list">
            <label className="trade-effect-series-item trade-effect-series-all">
              <input
                type="checkbox"
                checked={allSeriesSelected}
                onChange={toggleAllSeries}
              />
              <span>Select all</span>
            </label>
            {ownBrands.map((brand) => (
              <label key={brand.name} className="trade-effect-series-item">
                <input
                  type="checkbox"
                  checked={series.has(brand.name)}
                  onChange={() => toggleSeries(brand.name)}
                />
                <span>{brand.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="trade-effect-body">
        <div className="trade-effect-chart">
          {error ? (
            <p className="trade-effect-empty">Could not load the base SoM vs SoP chart.</p>
          ) : loading ? (
            <p className="trade-effect-empty">Loading base scenario…</p>
          ) : points.length === 0 ? (
            <p className="trade-effect-empty">No brand-level SoM vs SoP data.</p>
          ) : selectedRows.length === 0 ? (
            <p className="trade-effect-empty">Select at least one own brand.</p>
          ) : view === "columns" ? (
            <SomSopColumnsChart rows={selectedRows} />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 12, right: 24, bottom: 28, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="som"
                  name="SoM"
                  unit="%"
                  tickFormatter={fmtAxis}
                  label={{ value: "SoM %", position: "insideBottom", offset: -16 }}
                />
                <YAxis
                  type="number"
                  dataKey="sop"
                  name="SoP"
                  unit="%"
                  tickFormatter={fmtAxis}
                  width={48}
                  label={{ value: "SoP %", angle: -90, position: "insideLeft", offset: 8 }}
                />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as TradeEffectPoint | undefined;
                    if (!row) return null;
                    return (
                      <div className="trade-effect-tooltip">
                        <p className="trade-effect-tooltip-title">{row.name}</p>
                        <p>SoM {row.som.toFixed(1)}%</p>
                        <p>SoP {row.sop.toFixed(1)}%</p>
                      </div>
                    );
                  }}
                />
                <Scatter
                  data={selectedRows}
                  fill={SOM_COLOR}
                  name="Own brands"
                  isAnimationActive={false}
                  shape={(props: { cx?: number; cy?: number; payload?: TradeEffectPoint }) => {
                    if (props.cx == null || props.cy == null) return <g />;
                    return (
                      <g>
                        <circle cx={props.cx} cy={props.cy} r={6} fill={SOM_COLOR} />
                        <text x={props.cx + 8} y={props.cy + 4} fontSize={12} fill="#101A2E">
                          {props.payload?.name}
                        </text>
                      </g>
                    );
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>

        <aside className="trade-effect-insights" aria-label="Insights">
          <h3 className="trade-effect-insights-title">Insights</h3>
          <p className="trade-effect-insights-mock">
            {insightSubject
              ? `Insights for ${insightSubject} will appear here.`
              : "Insights will appear here."}
          </p>
          <div className="trade-effect-insights-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </aside>
      </div>
    </section>
  );
}

function SomSopColumnsChart({ rows }: { rows: TradeEffectPoint[] }) {
  const maxValue = Math.max(1, ...rows.flatMap((row) => [row.som, row.sop]));
  const yMax = Math.ceil(maxValue * 1.3);

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={rows} margin={{ top: 28, right: 12, bottom: 8, left: 4 }} barCategoryGap="32%">
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="name"
          interval={0}
          tick={{ fontSize: 11 }}
          height={rows.some((row) => row.name.length > 12) ? 56 : 32}
          tickFormatter={(value: string) => (value.length > 14 ? `${value.slice(0, 13)}…` : value)}
        />
        <YAxis
          domain={[0, yMax]}
          tickFormatter={(value: number) => `${value}%`}
          width={44}
        />
        <Tooltip
          formatter={(value, name) => [fmtPctLabel(value), String(name)]}
          labelFormatter={(label) => String(label)}
        />
        <Legend />
        <Bar dataKey="som" name="SOM" fill={SOM_COLOR} maxBarSize={48} isAnimationActive={false}>
          <LabelList dataKey="som" position="top" formatter={fmtPctLabel} style={{ fontSize: 11, fill: "#1e3a5f" }} />
        </Bar>
        <Line
          type="linear"
          dataKey="sop"
          name="Brand Share"
          stroke={BRAND_SHARE_COLOR}
          strokeWidth={2}
          dot={{ r: 4, fill: BRAND_SHARE_COLOR }}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="sop"
            position="top"
            formatter={fmtPctLabel}
            style={{ fontSize: 11, fill: "#8a5a00" }}
          />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
