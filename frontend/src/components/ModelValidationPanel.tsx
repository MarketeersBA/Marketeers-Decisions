import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ApiError } from "../api/client";
import {
  useDeleteValidationWave,
  useUploadValidationWave,
  useValidationSeries,
  useValidationWaves,
} from "../api/hooks";

const PREDICTED_COLOR = "#a67c52";
const ACTUAL_COLOR = "#2d5a56";

/** Set true to show rebase vs Runner note in the footer (see docs/VALIDATION.md). */
const SHOW_VALIDATION_REBASE_NOTE = false;

type ModelValidationPanelProps = {
  slug: string;
};

function fmtShare(value: number): string {
  return value.toFixed(1);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = err.message;
    if (typeof detail === "object" && detail !== null && "message" in detail) {
      return String((detail as { message: string }).message);
    }
    return String(detail);
  }
  if (err instanceof Error) return err.message;
  return "Upload failed";
}

export function ModelValidationPanel({ slug }: ModelValidationPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: wavesData, isLoading: wavesLoading } = useValidationWaves(slug);
  const { data: seriesData, isLoading: seriesLoading } = useValidationSeries(slug);
  const uploadMutation = useUploadValidationWave(slug);
  const deleteMutation = useDeleteValidationWave(slug);

  const chartData = useMemo(() => {
    const rows = (seriesData?.points ?? []).map((p) => ({
      waveKey: p.id,
      dateLabel: fmtDate(p.date),
      name: p.name,
      predicted: p.predicted,
      actual: p.actual,
    }));
    const dateCounts = new Map<string, number>();
    for (const row of rows) {
      dateCounts.set(row.dateLabel, (dateCounts.get(row.dateLabel) ?? 0) + 1);
    }
    return rows.map((row) => ({
      ...row,
      /** X tick text: date, or wave name when multiple waves share the same formatted date */
      xTick:
        (dateCounts.get(row.dateLabel) ?? 0) > 1 ? row.name : row.dateLabel,
    }));
  }, [seriesData]);

  const latestBrands = seriesData?.latestBrands ?? null;
  const competitorBrands = latestBrands?.brands ?? [];
  const brandNamesKey = competitorBrands.map((b) => b.name).join("\0");
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(
    () => new Set(competitorBrands.map((b) => b.name)),
  );

  useEffect(() => {
    setSelectedBrands(new Set(competitorBrands.map((b) => b.name)));
  }, [brandNamesKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when the brand list changes

  const brandChartData = useMemo(
    () => competitorBrands.filter((b) => selectedBrands.has(b.name)),
    [competitorBrands, selectedBrands],
  );

  const brandYDomain = useMemo((): [number, number] | ["auto", "auto"] => {
    if (!brandChartData.length) return ["auto", "auto"];
    const hi = Math.max(...brandChartData.flatMap((b) => [b.current, b.validation]));
    const pad = Math.max(0.5, hi * 0.12);
    return [0, hi + pad];
  }, [brandChartData]);

  const yDomain = useMemo((): [number, number] | ["auto", "auto"] => {
    if (!chartData.length) return ["auto", "auto"];
    const vals = chartData.flatMap((p) => [p.predicted, p.actual]);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max(0.5, (hi - lo) * 0.15);
    return [Math.max(0, lo - pad), hi + pad];
  }, [chartData]);

  const subtitle = useMemo(() => {
    const n = wavesData?.waves?.length ?? 0;
    if (n === 0) {
      return "Upload a validation workbook below the chart to compare predicted vs. actual company share.";
    }
    return `${n} validation wave${n === 1 ? "" : "s"} · company volume share predicted vs. actual`;
  }, [wavesData]);

  const toggleBrand = (name: string) => {
    setSelectedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setUploadError(null);
    try {
      await uploadMutation.mutateAsync(file);
    } catch (e) {
      setUploadError(uploadErrorMessage(e));
    }
  };

  return (
    <section className="model-validation-card" aria-labelledby="model-validation-heading">
      <header className="model-validation-header">
        <h2 id="model-validation-heading" className="model-validation-title">
          Validation — is the model still predicting reality?
        </h2>
        <p className="model-validation-subtitle">{subtitle}</p>
      </header>

      <div className="model-validation-chart-panel">
      <div className="model-validation-chart-outer">
        <p className="model-validation-y-label" aria-hidden>
          Company share %
        </p>
        <div className="model-validation-chart-wrap">
          {seriesLoading ? (
            <p className="model-validation-muted model-validation-chart-empty">Loading chart…</p>
          ) : chartData.length === 0 ? (
            <p className="model-validation-muted model-validation-chart-empty">
              No validation data yet. Upload a workbook to plot predicted vs. actual share by date.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 36 }}>
                <CartesianGrid stroke="#e8e4dc" vertical={false} />
                <XAxis
                  dataKey="waveKey"
                  tick={{ fill: "#6b7280", fontSize: 11 }}
                  axisLine={{ stroke: "#d1d5db" }}
                  tickLine={false}
                  interval={0}
                  tickFormatter={(value) =>
                    chartData.find((r) => r.waveKey === value)?.xTick ?? String(value)
                  }
                />
                <YAxis
                  domain={yDomain}
                  tick={{ fill: "#6b7280", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickMargin={8}
                  tickFormatter={(v) => fmtShare(Number(v))}
                />
                <Tooltip
                  shared
                  cursor={{ stroke: "#9ca3af", strokeWidth: 1, strokeDasharray: "4 4" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as (typeof chartData)[number] | undefined;
                    if (!row) return null;
                    return (
                      <div className="model-validation-tooltip">
                        <p className="model-validation-tooltip-title">
                          {row.name} · {row.dateLabel}
                        </p>
                        <ul className="model-validation-tooltip-list">
                          {payload.map((entry) => (
                            <li key={String(entry.dataKey)} style={{ color: entry.color }}>
                              {entry.name}:{" "}
                              {typeof entry.value === "number"
                                ? `${fmtShare(entry.value)}%`
                                : String(entry.value ?? "")}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  }}
                />
                <Line
                  type="linear"
                  dataKey="predicted"
                  name="Predicted company share"
                  stroke={PREDICTED_COLOR}
                  strokeWidth={2}
                  isAnimationActive={false}
                  dot={{ r: 6, fill: PREDICTED_COLOR, stroke: PREDICTED_COLOR, strokeWidth: 2 }}
                  activeDot={{ r: 9, strokeWidth: 2 }}
                />
                <Line
                  type="linear"
                  dataKey="actual"
                  name="Actual company share"
                  stroke={ACTUAL_COLOR}
                  strokeWidth={2}
                  strokeDasharray="7 5"
                  isAnimationActive={false}
                  dot={{
                    r: 6,
                    fill: "#faf9f6",
                    stroke: ACTUAL_COLOR,
                    strokeWidth: 2,
                  }}
                  activeDot={{
                    r: 9,
                    fill: "#faf9f6",
                    stroke: ACTUAL_COLOR,
                    strokeWidth: 2,
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="model-validation-legend" aria-hidden>
        <span className="model-validation-legend-item">
          <span className="model-validation-legend-line model-validation-legend-line--predicted" />
          Predicted company share
        </span>
        <span className="model-validation-legend-item">
          <span className="model-validation-legend-line model-validation-legend-line--actual" />
          Actual company share (audit)
        </span>
      </div>
      </div>

      {chartData.length > 0 ? (
        <div className="model-validation-brand-chart">
          <h3 className="model-validation-brand-title">Competitor brand market share</h3>
          <p className="model-validation-brand-sub">
            {latestBrands
              ? `Current share rebased to the validation total · ${latestBrands.name} · ${fmtDate(latestBrands.date)}`
              : "Current study share vs. the last uploaded validation."}
          </p>
          {competitorBrands.length === 0 ? (
            <p className="model-validation-muted model-validation-chart-empty">
              No competitor brands in this study.
            </p>
          ) : (
            <div className="model-validation-brand-body">
              <aside className="model-validation-brand-filter" aria-label="Competitor brands">
                <div className="model-validation-brand-filter-head">
                  <h4>Competitor brands</h4>
                  <div className="model-validation-brand-filter-actions">
                    <button
                      type="button"
                      className="linkish"
                      onClick={() =>
                        setSelectedBrands(new Set(competitorBrands.map((b) => b.name)))
                      }
                    >
                      All
                    </button>
                    <span aria-hidden="true">·</span>
                    <button type="button" className="linkish" onClick={() => setSelectedBrands(new Set())}>
                      None
                    </button>
                  </div>
                </div>
                <div className="scenario-checkbox-list model-validation-brand-list">
                  {competitorBrands.map((brand) => {
                    const checked = selectedBrands.has(brand.name);
                    return (
                      <label
                        key={brand.name}
                        className={`scenario-checkbox-item ${checked ? "checked" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBrand(brand.name)}
                        />
                        <div className="checkbox-text">
                          <span className="sc-name">{brand.name}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </aside>
              <div className="model-validation-chart-outer model-validation-brand-chart-outer">
                <p className="model-validation-y-label" aria-hidden>
                  Market share %
                </p>
                <div className="model-validation-chart-wrap">
                  {brandChartData.length === 0 ? (
                    <p className="model-validation-muted model-validation-chart-empty">
                      Select at least one competitor brand.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart
                        data={brandChartData}
                        margin={{ top: 12, right: 16, left: 0, bottom: 48 }}
                      >
                        <CartesianGrid stroke="#e8e4dc" vertical={false} />
                        <XAxis
                          dataKey="name"
                          tick={{ fill: "#6b7280", fontSize: 11 }}
                          axisLine={{ stroke: "#d1d5db" }}
                          tickLine={false}
                          interval={0}
                          angle={-28}
                          textAnchor="end"
                          height={56}
                        />
                        <YAxis
                          domain={brandYDomain}
                          tick={{ fill: "#6b7280", fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          width={44}
                          tickMargin={8}
                          tickFormatter={(v) => fmtShare(Number(v))}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(45, 90, 86, 0.06)" }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const row = payload[0]?.payload as (typeof brandChartData)[number] | undefined;
                            if (!row) return null;
                            return (
                              <div className="model-validation-tooltip">
                                <p className="model-validation-tooltip-title">{row.name}</p>
                                <ul className="model-validation-tooltip-list">
                                  <li style={{ color: PREDICTED_COLOR }}>
                                    Current: {fmtShare(row.current)}%
                                  </li>
                                  <li style={{ color: ACTUAL_COLOR }}>
                                    Validation: {fmtShare(row.validation)}%
                                  </li>
                                </ul>
                              </div>
                            );
                          }}
                        />
                        <Bar
                          dataKey="current"
                          name="Current"
                          fill={PREDICTED_COLOR}
                          radius={[4, 4, 0, 0]}
                          maxBarSize={28}
                          isAnimationActive={false}
                        />
                        <Bar
                          dataKey="validation"
                          name="Validation"
                          fill={ACTUAL_COLOR}
                          radius={[4, 4, 0, 0]}
                          maxBarSize={28}
                          isAnimationActive={false}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
              <div className="model-validation-legend" aria-hidden>
                <span className="model-validation-legend-item">
                  <span className="model-validation-legend-swatch model-validation-legend-swatch--current" />
                  Current
                </span>
                <span className="model-validation-legend-item">
                  <span className="model-validation-legend-swatch model-validation-legend-swatch--validation" />
                  Validation
                </span>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="model-validation-upload">
        <h3 className="model-validation-upload-heading">Validation input</h3>
        <div
          className={`drag-drop-zone model-validation-drop${uploadMutation.isPending ? " is-busy" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void handleFile(e.dataTransfer.files[0] ?? null);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="sr-only"
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
          />
          {uploadMutation.isPending ? (
            <span>Uploading validation workbook…</span>
          ) : (
            <span>
              Drop validation Excel here (<strong>Description</strong> + <strong>Product List</strong>
              ), or <span className="link-like">browse</span>
            </span>
          )}
        </div>
        {uploadError ? <p className="model-validation-error">{uploadError}</p> : null}
      </div>

      {wavesLoading ? (
        <p className="model-validation-muted">Loading validation waves…</p>
      ) : (wavesData?.waves?.length ?? 0) > 0 ? (
        <div className="model-validation-table-wrap">
          <table className="model-validation-waves-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Date</th>
                <th scope="col">Source file</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {wavesData!.waves.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td>{fmtDate(w.validation_date)}</td>
                  <td>{w.source_filename || "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-text-danger"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(w.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <footer className="model-validation-footer">
        <p className="model-validation-disclaimer">
          Each wave applies its Product List inputs and audit shares, then rebases simulator share to
          the audit total before comparison.
        </p>
        {SHOW_VALIDATION_REBASE_NOTE ? (
          <p className="model-validation-doc-note">
            <strong>Note:</strong> Predicted % here is <em>after rebase</em>; Runner volume share for
            the same price change is usually higher (no rebase). Details in{" "}
            <code>docs/VALIDATION.md</code>.
          </p>
        ) : null}
      </footer>
    </section>
  );
}
