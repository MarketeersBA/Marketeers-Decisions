import { useState, useEffect, useMemo, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { useScenarios, useCompareScenarios, useExportComparison } from "../api/hooks";
import { useSettings } from "../stores/useSettings";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { axisTicks, ratioToIndex, scopeRevenueIndex } from "../lib/scenarioCompareChart";
import "../pages/pages.css";

// Color palette for up to 6 scenarios + Base
const SCENARIO_COLORS = [
  "#C41230",
  "#002D62",
  "#1A6B4A",
  "#8B1E32",
  "#0A3D7A",
  "#C9A227",
  "#7480A5",
];

interface MetricOption {
  key: string;
  label: string;
  isCurrency?: boolean;
  isPercent?: boolean;
  /** 100-based index (engine R.Index is a ratio ~1.0). */
  isIndex?: boolean;
}

const BAR_METRICS: MetricOption[] = [
  { key: "Value Share", label: "Value Share", isPercent: true },
  { key: "N.Share", label: "Volume Share", isPercent: true },
  { key: "Preference Share", label: "Preference Share", isPercent: true },
];

const BRAND_VIEW_METRICS: MetricOption[] = [
  ...BAR_METRICS,
  { key: "R.Index", label: "Revenue Index", isIndex: true },
];

const REV_INDEX_METRIC: MetricOption = {
  key: "R.Index",
  label: "Revenue Index",
  isIndex: true,
};

function entityColor(idx: number): string {
  return SCENARIO_COLORS[(idx + 1) % SCENARIO_COLORS.length];
}

function scenarioColor(idx: number): string {
  return SCENARIO_COLORS[idx % SCENARIO_COLORS.length];
}

function CompareChartColorMap({ items }: { items: { label: string; color: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="compare-chart-color-map" aria-label="Chart color map">
      {items.map((item) => (
        <span key={item.label} className="compare-color-map-item">
          <span className="compare-color-swatch" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

const MANUFACTURER_KEY = "__manufacturer__";

/** Bars use the bottom portion of the plot; rev-index lines use the upper band. */
const BAR_HEIGHT_FRACTION = 0.42;
const LINE_ZONE_START = 0.54;
const LINE_ZONE_END = 0.96;

function computeBarOnlyDomain(barValues: number[]): [number, number] {
  const barMax = Math.max(1, ...barValues.filter(Number.isFinite), 0);
  const ticks = axisTicks(0, barMax * 1.15);
  return [0, ticks[ticks.length - 1]];
}

function computeIndexOnlyDomain(indexValues: number[]): [number, number] {
  const lo = Math.min(...indexValues, 100);
  const hi = Math.max(...indexValues, 100);
  const pad = Math.max(15, (hi - lo) * 0.75);
  const ticks = axisTicks(lo - pad, hi + pad, 100);
  return [ticks[0], ticks[ticks.length - 1]];
}

function computeComboChartDomains(
  barValues: number[],
  indexValues: number[],
): { barDomain: [number, number]; indexDomain: [number, number] } {
  const barMax = Math.max(1, ...barValues.filter(Number.isFinite), 0);
  const barDomainMax = barMax / BAR_HEIGHT_FRACTION;
  const barTicks = axisTicks(0, barDomainMax);
  const barDomain: [number, number] = [0, barTicks[barTicks.length - 1]];

  const idxMin = Math.min(...indexValues, 100);
  const idxMax = Math.max(...indexValues, 100);
  const lineSpan = Math.max(idxMax - idxMin, 8);
  const domainSpan = lineSpan / (LINE_ZONE_END - LINE_ZONE_START);
  const domainLo = idxMin - LINE_ZONE_START * domainSpan;
  const domainHi = domainLo + domainSpan;
  const idxTicks = axisTicks(Math.min(domainLo, 100), Math.max(domainHi, 100), 100);

  return {
    barDomain,
    indexDomain: [idxTicks[0], idxTicks[idxTicks.length - 1]],
  };
}

type CompareView = "chart" | "table";
type ChartLayout = "byBrand" | "byScenario";

export type OwnBrandOption = {
  name: string;
  skuNames: string[];
};

function findMetricOption(metricKey: string | null): MetricOption | null {
  if (!metricKey) return null;
  return BRAND_VIEW_METRICS.find((m) => m.key === metricKey) ?? null;
}

function brandGroupType(groupTypes: string[] | undefined): string {
  if (!groupTypes?.length) return "Brand";
  return groupTypes.find((t) => /brand/i.test(t)) ?? groupTypes[0];
}

function aggregateScopeMetric(
  results: any[] | undefined,
  metric: string,
  ownNames: Set<string>,
  ownOnly: boolean,
): number {
  if (!results?.length) return 0;
  return results
    .filter((r) => !ownOnly || ownNames.has(String(r["Product Name"] ?? "")))
    .reduce((sum, r) => sum + (Number(r[metric]) || 0), 0);
}

function scopeSkuNames(
  results: any[] | undefined,
  ownNames: Set<string>,
  ownOnly: boolean,
): Set<string> {
  if (ownOnly) return ownNames;
  return new Set((results ?? []).map((r) => String(r["Product Name"] ?? "")));
}

/** Brand/SKU metric in chart units. R.Index is converted from engine ratio to base = 100. */
function displayMetricValue(row: any, metric: string): number {
  if (metric === "R.Index") return ratioToIndex(Number(row["R.Index"]));
  return Number(row[metric]) || 0;
}

function metricFromResults(
  results: any[] | undefined,
  metric: string,
  ownNames: Set<string>,
  ownOnly: boolean,
): number {
  if (metric === "R.Index") {
    return scopeRevenueIndex(results ?? [], scopeSkuNames(results, ownNames, ownOnly));
  }
  return aggregateScopeMetric(results, metric, ownNames, ownOnly);
}

function formatAxisTick(v: number, metric: MetricOption): string {
  if (metric.isPercent) return `${v}%`;
  if (metric.isIndex) return String(Math.round(v));
  return v.toLocaleString();
}

interface ScenarioCompareSectionProps {
  slug: string;
  /** Product names flagged as own (Company = 1). Chart/table show own brands only when set. */
  companyProducts?: string[];
  /** Study company name — label for the manufacturer rollup row. */
  companyName?: string;
  /** Own brands (with SKUs) for the entity picker. */
  ownBrands?: OwnBrandOption[];
}

export function ScenarioCompareSection({
  slug,
  companyProducts = [],
  companyName = "",
  ownBrands = [],
}: ScenarioCompareSectionProps) {
  const [searchParams] = useSearchParams();
  const settings = useSettings();

  // Fetch scenarios list
  const { data: scenariosList = [], isLoading: isLoadingScenarios } = useScenarios(slug);

  // Compare mutation
  const compareMutation = useCompareScenarios(slug);
  const exportMutation = useExportComparison(slug);

  // UI State
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [activeBarMetric, setActiveBarMetric] = useState<string | null>("N.Share");
  const [showRevenueIndex, setShowRevenueIndex] = useState<boolean>(false);
  const [showIndexView, setShowIndexView] = useState<boolean>(false);
  const [compareView, setCompareView] = useState<CompareView>("chart");
  const [chartLayout, setChartLayout] = useState<ChartLayout>("byScenario");

  const brandNamesKey = ownBrands.map((b) => b.name).join("\0");
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(() => {
    const initial = new Set(ownBrands.map((b) => b.name));
    initial.add(MANUFACTURER_KEY);
    return initial;
  });

  // Comparison Results State
  const [compareData, setCompareData] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Default selection: URL param or first 3 scenarios
  useEffect(() => {
    if (scenariosList.length === 0 || selectedScenarios.length > 0) return;
    const fromUrl = searchParams.get("scenarios");
    if (fromUrl && scenariosList.some((s) => s.name === fromUrl)) {
      setSelectedScenarios([fromUrl]);
      return;
    }
    const defaults = scenariosList.slice(0, 3).map((s) => s.name);
    setSelectedScenarios(defaults);
  }, [scenariosList, searchParams]);

  useEffect(() => {
    setSelectedEntities(() => {
      const next = new Set(ownBrands.map((b) => b.name));
      next.add(MANUFACTURER_KEY);
      return next;
    });
  }, [brandNamesKey]); // eslint-disable-line react-hooks/exhaustive-deps -- sync when brand list changes

  // Trigger comparison when selected scenarios change
  useEffect(() => {
    if (selectedScenarios.length > 0 && slug) {
      runComparison();
    } else {
      setCompareData(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScenarios, slug]);

  const runComparison = async () => {
    setErrorMsg(null);
    try {
      const data = await compareMutation.mutateAsync(selectedScenarios);
      setCompareData(data);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to calculate scenario comparison.");
    }
  };

  const handleScenarioToggle = (name: string) => {
    setSelectedScenarios((prev) => {
      if (prev.includes(name)) {
        return prev.filter((s) => s !== name);
      } else {
        if (prev.length >= 6) {
          setErrorMsg("You can select a maximum of 6 scenarios for comparison.");
          return prev;
        }
        setErrorMsg(null);
        return [...prev, name];
      }
    });
  };

  const handleExcelExport = async () => {
    if (selectedScenarios.length === 0 || !slug) return;
    try {
      const filename = `${slug}_comparison.xlsx`;
      await exportMutation.mutateAsync({ scenarios: selectedScenarios, filename });
    } catch (err: any) {
      setErrorMsg(err.message || "Export failed.");
    }
  };

  const handleCsvExport = () => {
    if (!compareData) return;
    const byBrand = chartLayout === "byBrand";
    const shareMetricInfo =
      !byBrand && activeBarMetric && activeBarMetric !== REV_INDEX_METRIC.key
        ? findMetricOption(activeBarMetric)
        : null;
    const singleMetricInfo = byBrand ? findMetricOption(activeBarMetric) : null;
    const includeRevIndex = !byBrand && showRevenueIndex;
    const headers = ["Brand"];
    if (singleMetricInfo) {
      headers.push(`Base Case (${singleMetricInfo.label})`);
    }
    if (shareMetricInfo) {
      headers.push(`Base Case (${shareMetricInfo.label})`);
    }
    if (includeRevIndex) {
      headers.push("Base Case (Revenue Index)");
    }
    selectedScenarios.forEach((s) => {
      if (singleMetricInfo) headers.push(`${s} (${singleMetricInfo.label})`);
      if (shareMetricInfo) headers.push(`${s} (${shareMetricInfo.label})`);
      if (includeRevIndex) headers.push(`${s} (Revenue Index)`);
      if (showIndexView && shareMetricInfo) headers.push(`${s} Index`);
    });

    const rows: string[][] = [headers];

    getBaseRows().forEach((baseRow: any) => {
      const name = rowLabel(baseRow);
      const rowData: (string | number)[] = [name];

      if (singleMetricInfo && activeBarMetric) {
        rowData.push(getMetricValueForRow(baseRow, null, activeBarMetric));
      }
      if (shareMetricInfo && activeBarMetric) {
        rowData.push(getMetricValueForRow(baseRow, null, activeBarMetric));
      }
      if (includeRevIndex) {
        rowData.push(getMetricValueForRow(baseRow, null, REV_INDEX_METRIC.key));
      }

      selectedScenarios.forEach((sName) => {
        if (singleMetricInfo && activeBarMetric) {
          rowData.push(getMetricValueForRow(baseRow, sName, activeBarMetric));
        }
        if (shareMetricInfo && activeBarMetric) {
          const val = getMetricValueForRow(baseRow, sName, activeBarMetric);
          rowData.push(val);
          if (showIndexView) {
            const baseVal = getMetricValueForRow(baseRow, null, activeBarMetric);
            rowData.push(baseVal ? (val / baseVal) * 100 : 0);
          }
        }
        if (includeRevIndex) {
          rowData.push(getMetricValueForRow(baseRow, sName, REV_INDEX_METRIC.key));
        }
      });

      rows.push(rowData.map(String));
    });

    const metricSlug = [
      singleMetricInfo?.label ?? shareMetricInfo?.label,
      includeRevIndex ? "revenue_index" : null,
    ]
      .filter(Boolean)
      .join("_")
      .toLowerCase()
      .replace(/\s+/g, "_");

    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${slug}_comparison_${metricSlug}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const ownNames = useMemo(() => new Set(companyProducts), [companyProducts]);
  const ownOnly = ownNames.size > 0;
  const manufacturerLabel = companyName.trim() || "Manufacturer";

  const brandType = useMemo(
    () => brandGroupType(compareData?.groupTypes),
    [compareData?.groupTypes],
  );

  const isOwnRow = (row: any) => {
    if (!ownOnly) return true;
    const productNames: string[] | undefined = row.productNames;
    if (productNames?.length) {
      return productNames.some((p) => ownNames.has(p));
    }
    return ownNames.has(String(row["Product Name"] ?? ""));
  };

  const rowLabel = (row: any) => String(row.Name ?? row["Product Name"] ?? "");

  const availableBrandRows = useMemo(() => {
    if (!compareData) return [];
    const rows = compareData.base.groups[brandType] || [];
    const scoped = ownOnly ? rows.filter(isOwnRow) : rows;
    return scoped.map((row: any) => {
      const enriched: any = { ...row };
      for (const metric of BAR_METRICS) {
        enriched[metric.key] = displayMetricValue(row, metric.key);
      }
      enriched[REV_INDEX_METRIC.key] = displayMetricValue(row, REV_INDEX_METRIC.key);
      return enriched;
    });
  }, [compareData, brandType, ownOnly, ownNames]);

  const getMetricValueForRow = (
    baseRow: any,
    scenarioName: string | null,
    metricKey: string,
  ): number => {
    if (!compareData) return 0;

    const isBase = scenarioName === null || scenarioName === "Base Case";

    if (isBase) {
      if (baseRow._manufacturer) {
        return metricFromResults(compareData.base.results, metricKey, ownNames, ownOnly);
      }
      return Number(baseRow[metricKey]) || 0;
    }

    const sData = compareData.scenarios[scenarioName];
    if (!sData) return 0;

    if (baseRow._manufacturer) {
      return metricFromResults(sData.results, metricKey, ownNames, ownOnly);
    }

    const name = rowLabel(baseRow);
    const sRows = sData.groups[brandType] || [];
    const matchRow = sRows.find((r: any) => rowLabel(r) === name);
    return matchRow ? displayMetricValue(matchRow, metricKey) : 0;
  };

  const getBaseRows = () => {
    if (!compareData) return [];

    const rows: any[] = [];

    if (selectedEntities.has(MANUFACTURER_KEY)) {
      const enriched: any = {
        Name: manufacturerLabel,
        _manufacturer: true,
        _entityKey: MANUFACTURER_KEY,
      };
      for (const metric of BAR_METRICS) {
        enriched[metric.key] = metricFromResults(
          compareData.base.results,
          metric.key,
          ownNames,
          ownOnly,
        );
      }
      enriched[REV_INDEX_METRIC.key] = metricFromResults(
        compareData.base.results,
        REV_INDEX_METRIC.key,
        ownNames,
        ownOnly,
      );
      rows.push(enriched);
    }

    for (const brandRow of availableBrandRows) {
      const name = rowLabel(brandRow);
      if (!selectedEntities.has(name)) continue;
      rows.push({ ...brandRow, _entityKey: name });
    }

    return rows;
  };

  // Formatting utils
  const formatCell = (val: number | null | undefined, metric: MetricOption) => {
    if (val === null || val === undefined) return "-";
    const d = settings.decimalPlaces;
    if (metric.isCurrency) {
      return val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
    if (metric.isPercent) {
      return `${val.toFixed(d)}%`;
    }
    if (metric.isIndex) {
      return val.toFixed(d);
    }
    return val.toFixed(d);
  };

  const revIndexKey = (label: string) => `${label}__rev`;

  // Build Recharts Data — brands on x-axis, scenarios as series (bars only)
  const getChartDataByBrand = () =>
    getBaseRows().map((baseRow: any) => {
      const name = rowLabel(baseRow);
      const chartItem: any = { name };
      if (activeBarMetric) {
        chartItem["Base Case"] = getMetricValueForRow(baseRow, null, activeBarMetric);
        selectedScenarios.forEach((sName) => {
          chartItem[sName] = getMetricValueForRow(baseRow, sName, activeBarMetric);
        });
      }
      return chartItem;
    });

  const scenarioLabels = useMemo(
    () => ["Base Case", ...selectedScenarios],
    [selectedScenarios],
  );

  const entityLabels = useMemo(
    () => getBaseRows().map((row) => rowLabel(row)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareData, activeBarMetric, showRevenueIndex, selectedEntities, selectedScenarios, manufacturerLabel, brandType],
  );

  const getChartDataByScenario = () =>
    scenarioLabels.map((scenarioLabel) => {
      const chartItem: any = { scenario: scenarioLabel };
      const scenarioKey = scenarioLabel === "Base Case" ? null : scenarioLabel;
      getBaseRows().forEach((baseRow: any) => {
        const entityName = rowLabel(baseRow);
        if (activeBarMetric) {
          chartItem[entityName] = getMetricValueForRow(baseRow, scenarioKey, activeBarMetric);
        }
        if (showRevenueIndex) {
          chartItem[revIndexKey(entityName)] = getMetricValueForRow(
            baseRow,
            scenarioKey,
            REV_INDEX_METRIC.key,
          );
        }
      });
      return chartItem;
    });

  const isByBrandLayout = chartLayout === "byBrand";
  const activeMetricOption = findMetricOption(activeBarMetric);
  const activeShareMetricOption =
    activeBarMetric && activeBarMetric !== REV_INDEX_METRIC.key
      ? findMetricOption(activeBarMetric)
      : null;
  const hasAnyMetric = isByBrandLayout
    ? Boolean(activeBarMetric)
    : Boolean(activeBarMetric) || showRevenueIndex;

  const chartTitle = useMemo(() => {
    if (isByBrandLayout) return activeMetricOption?.label ?? "Metric";
    const parts: string[] = [];
    if (activeShareMetricOption) parts.push(activeShareMetricOption.label);
    if (showRevenueIndex) parts.push(REV_INDEX_METRIC.label);
    return parts.join(" + ") || "Metric";
  }, [isByBrandLayout, activeMetricOption, activeShareMetricOption, showRevenueIndex]);

  const chartDomains = useMemo(() => {
    const indexValues: number[] = [];
    const barValues: number[] = [];

    for (const row of getBaseRows()) {
      indexValues.push(getMetricValueForRow(row, null, REV_INDEX_METRIC.key));
      for (const s of selectedScenarios) {
        indexValues.push(getMetricValueForRow(row, s, REV_INDEX_METRIC.key));
      }
      if (activeBarMetric) {
        barValues.push(getMetricValueForRow(row, null, activeBarMetric));
        for (const s of selectedScenarios) {
          barValues.push(getMetricValueForRow(row, s, activeBarMetric));
        }
      }
    }

    if (isByBrandLayout && activeBarMetric === REV_INDEX_METRIC.key) {
      return { barDomain: computeIndexOnlyDomain(barValues), indexDomain: undefined };
    }
    if (isByBrandLayout && activeBarMetric) {
      return { barDomain: computeBarOnlyDomain(barValues), indexDomain: undefined };
    }
    if (activeBarMetric && showRevenueIndex) {
      return computeComboChartDomains(barValues, indexValues);
    }
    if (showRevenueIndex) {
      return { barDomain: undefined, indexDomain: computeIndexOnlyDomain(indexValues) };
    }
    return { barDomain: computeBarOnlyDomain(barValues), indexDomain: undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    compareData,
    activeBarMetric,
    showRevenueIndex,
    selectedEntities,
    selectedScenarios,
    brandType,
    chartLayout,
    isByBrandLayout,
  ]);

  const handleChartLayoutChange = (layout: ChartLayout) => {
    if (layout === "byBrand") {
      setShowRevenueIndex(false);
      if (!activeBarMetric) {
        setActiveBarMetric(showRevenueIndex ? REV_INDEX_METRIC.key : "N.Share");
      }
    } else if (activeBarMetric === REV_INDEX_METRIC.key) {
      setShowRevenueIndex(true);
      setActiveBarMetric(null);
    }
    setChartLayout(layout);
  };

  const handleBarMetricChange = (metricKey: string) => {
    setActiveBarMetric(metricKey);
  };

  const handleBarMetricClick = (metricKey: string) => {
    if (!isByBrandLayout && activeBarMetric === metricKey && showRevenueIndex) {
      setActiveBarMetric(null);
    }
  };

  const handleRevenueIndexToggle = (checked: boolean) => {
    setShowRevenueIndex(checked);
    if (!checked && !activeBarMetric) {
      setActiveBarMetric("N.Share");
    }
  };

  const colorMapItems = useMemo(() => {
    if (chartLayout === "byScenario") {
      return entityLabels.map((label, idx) => ({ label, color: entityColor(idx) }));
    }
    return scenarioLabels.map((label, idx) => ({ label, color: scenarioColor(idx) }));
  }, [chartLayout, entityLabels, scenarioLabels]);

  const chartTooltipFormatter = (v: any, _name: any, item: any) => {
    const dataKey = String(item?.dataKey ?? "");
    const isRevLine = !isByBrandLayout && dataKey.endsWith("__rev");
    const metric = isRevLine ? REV_INDEX_METRIC : activeMetricOption ?? REV_INDEX_METRIC;
    const seriesLabel = isRevLine
      ? REV_INDEX_METRIC.label
      : activeMetricOption?.label ?? REV_INDEX_METRIC.label;
    return [formatCell(Number(v), metric), seriesLabel];
  };

  const toggleEntity = (key: string) => {
    setSelectedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setAllEntities = (checked: boolean) => {
    if (!checked) {
      setSelectedEntities(new Set());
      return;
    }
    const next = new Set<string>([MANUFACTURER_KEY]);
    if (ownBrands.length > 0) {
      ownBrands.forEach((b) => next.add(b.name));
    } else {
      availableBrandRows.forEach((row: any) => next.add(rowLabel(row)));
    }
    setSelectedEntities(next);
  };

  const entityPickerOptions = useMemo(() => {
    const options: { key: string; label: string; hint?: string }[] = [
      { key: MANUFACTURER_KEY, label: manufacturerLabel, hint: "All own brands" },
    ];
    if (ownBrands.length > 0) {
      for (const brand of ownBrands) {
        options.push({
          key: brand.name,
          label: brand.name,
          hint: `${brand.skuNames.length} SKU${brand.skuNames.length === 1 ? "" : "s"}`,
        });
      }
    } else if (compareData) {
      for (const row of availableBrandRows) {
        const name = rowLabel(row);
        options.push({ key: name, label: name });
      }
    }
    return options;
  }, [ownBrands, manufacturerLabel, compareData, availableBrandRows]);

  const hasSelectedEntities = selectedEntities.size > 0;

  return (
    <section className="compare-embed">
      <div className="compare-embed-header">
        <div className="compare-embed-heading">
          <span className="compare-embed-icon" aria-hidden="true">⇄</span>
          <div>
            <h2 className="compare-embed-title">Compare Scenarios</h2>
            <p className="compare-embed-subtitle">
              Brand-level comparison of saved scenarios vs the base case
              {ownOnly ? " — own brands only" : ""}.
            </p>
          </div>
        </div>

        <div className="header-actions">
          {compareView === "chart" && (
            <>
              <button
                className="btn-secondary"
                disabled={selectedScenarios.length === 0 || exportMutation.isPending}
                onClick={handleExcelExport}
              >
                {exportMutation.isPending ? "Generating Excel…" : "Export Excel ⬇"}
              </button>
              <button className="btn-secondary" disabled={!compareData} onClick={handleCsvExport}>
                Export CSV ⬇
              </button>
            </>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="panel error mb-16">
          <div>{errorMsg}</div>
        </div>
      )}

      <div className="compare-body">
        <div className="panel compare-panel compare-brands-bar">
          <div className="compare-panel-head">
            <h3>Brands</h3>
            <div className="compare-entity-actions">
              <button type="button" className="linkish" onClick={() => setAllEntities(true)}>
                All
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" className="linkish" onClick={() => setAllEntities(false)}>
                None
              </button>
            </div>
          </div>
          <p className="sidebar-instructions">
            Select manufacturer and/or own brands to include in the comparison.
          </p>
          <div className="compare-brands-list">
            {entityPickerOptions.map((opt) => {
              const checked = selectedEntities.has(opt.key);
              return (
                <label
                  key={opt.key}
                  className={`scenario-checkbox-item compare-brand-chip ${checked ? "checked" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleEntity(opt.key)}
                  />
                  <div className="checkbox-text">
                    <span className="sc-name">{opt.label}</span>
                    {opt.hint && <span className="sc-desc">{opt.hint}</span>}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="compare-grid">
        {/* Sidebar selection */}
        <div className="compare-sidebar-col">
          <div className="panel compare-panel">
            <div className="compare-panel-head">
              <h3>Scenarios</h3>
              {scenariosList.length > 0 && (
                <span className={`compare-count-badge ${selectedScenarios.length >= 6 ? "full" : ""}`}>
                  {selectedScenarios.length}/6
                </span>
              )}
            </div>
            <p className="sidebar-instructions">Select scenarios to compare against the Base case.</p>

            {isLoadingScenarios ? (
              <div className="loading-spinner">Loading scenarios…</div>
            ) : scenariosList.length === 0 ? (
              <div className="notice-info">
                <span className="notice-icon" aria-hidden="true">ℹ</span>
                No scenarios saved yet. Use Save scenario above to start comparing.
              </div>
            ) : (
              <div className="scenario-checkbox-list">
                {scenariosList.map((sc) => {
                  const checked = selectedScenarios.includes(sc.name);
                  return (
                    <label key={sc.name} className={`scenario-checkbox-item ${checked ? "checked" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleScenarioToggle(sc.name)}
                      />
                      <div className="checkbox-text">
                        <span className="sc-name">
                          {sc.name} {sc.validation && (
                            <span className="val-badge" title="Legacy validation scenario">
                              V
                            </span>
                          )}
                        </span>
                        {sc.description && <span className="sc-desc">{sc.description}</span>}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="panel compare-panel">
            <h3>Compare Metric</h3>
            {isByBrandLayout ? (
              <div className="metric-radio-list">
                {BRAND_VIEW_METRICS.map((m) => (
                  <label
                    key={m.key}
                    className={`metric-radio-item ${activeBarMetric === m.key ? "selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="compare_metric"
                      checked={activeBarMetric === m.key}
                      onChange={() => handleBarMetricChange(m.key)}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            ) : (
              <div className="compare-metric-split">
                <label
                  className={`metric-checkbox-item ${showRevenueIndex ? "selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={showRevenueIndex}
                    onChange={(e) => handleRevenueIndexToggle(e.target.checked)}
                  />
                  {REV_INDEX_METRIC.label}
                  <span className="metric-hint">Line · right axis</span>
                </label>

                <div className="compare-metric-divider" aria-hidden="true" />

                <div className="metric-radio-list">
                  {BAR_METRICS.map((m) => (
                    <label
                      key={m.key}
                      className={`metric-radio-item ${activeBarMetric === m.key ? "selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="compare_bar_metric"
                        checked={activeBarMetric === m.key}
                        onChange={() => handleBarMetricChange(m.key)}
                        onClick={() => handleBarMetricClick(m.key)}
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Main charts pane */}
        <div className="compare-main-col">
        {selectedScenarios.length === 0 ? (
          <div className="panel compare-empty-state">
            <div className="compare-empty-icon" aria-hidden="true">📊</div>
            <h3>No scenarios selected</h3>
            <p>Check one or more scenarios in the left panel to begin a side-by-side comparison.</p>
          </div>
        ) : compareMutation.isPending && !compareData ? (
          <div className="panel compare-empty-state">
            <div className="spinner" />
            <p>Recalculating simulations…</p>
          </div>
        ) : !compareData ? (
          <div className="panel compare-empty-state">
            <div className="compare-empty-icon" aria-hidden="true">⏳</div>
            <h3>Ready to compare</h3>
            <p>Calculations will begin immediately upon selecting scenarios.</p>
          </div>
        ) : (
          <div className="comparison-tabs-container">
            {!hasSelectedEntities ? (
              <div className="panel compare-empty-state mt-16">
                <div className="compare-empty-icon" aria-hidden="true">🏷</div>
                <h3>No brands selected</h3>
                <p>Select at least one brand above to include in the comparison.</p>
              </div>
            ) : !hasAnyMetric ? (
              <div className="panel compare-empty-state mt-16">
                <div className="compare-empty-icon" aria-hidden="true">📈</div>
                <h3>No metric selected</h3>
                <p>Select a share metric and/or Revenue Index in the left panel.</p>
              </div>
            ) : compareView === "chart" ? (
              <div className="panel chart-container">
                <h3>
                  {chartTitle} comparison —{" "}
                  {chartLayout === "byBrand" ? "by brand" : "by scenario"}
                </h3>
                <div style={{ width: "100%", height: 400 }}>
                  <ResponsiveContainer>
                    {chartLayout === "byScenario" ? (
                      <ComposedChart
                        data={getChartDataByScenario()}
                        margin={{ top: 20, right: showRevenueIndex ? 48 : 30, left: 20, bottom: 60 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="scenario" tick={{ fontSize: 11, fontWeight: 600 }} />
                        {activeShareMetricOption && (
                          <YAxis
                            yAxisId="bar"
                            domain={chartDomains.barDomain}
                            allowDataOverflow
                            tickFormatter={(v: number) => formatAxisTick(v, activeShareMetricOption)}
                          />
                        )}
                        {showRevenueIndex && (
                          <YAxis
                            yAxisId="index"
                            orientation={activeShareMetricOption ? "right" : "left"}
                            domain={chartDomains.indexDomain}
                            allowDataOverflow
                            allowDecimals={false}
                            tickFormatter={(v: number) => String(Math.round(v))}
                          />
                        )}
                        <Tooltip formatter={chartTooltipFormatter} />
                        {showRevenueIndex && (
                          <ReferenceLine
                            yAxisId="index"
                            y={100}
                            stroke="#b8c0cc"
                            strokeDasharray="4 4"
                          />
                        )}
                        {activeShareMetricOption &&
                          entityLabels.map((entityName, idx) => (
                            <Bar
                              key={entityName}
                              yAxisId="bar"
                              dataKey={entityName}
                              name={entityName}
                              fill={entityColor(idx)}
                              legendType="none"
                            />
                          ))}
                        {showRevenueIndex &&
                          entityLabels.map((entityName, idx) => {
                            const color = entityColor(idx);
                            return (
                              <Line
                                key={`${entityName}-rev`}
                                yAxisId="index"
                                type="monotone"
                                dataKey={revIndexKey(entityName)}
                                name={entityName}
                                stroke={color}
                                strokeWidth={2}
                                dot={{ r: 4, fill: color, strokeWidth: 0 }}
                                activeDot={{ r: 5 }}
                                legendType="none"
                              />
                            );
                          })}
                      </ComposedChart>
                    ) : (
                      <BarChart
                        data={getChartDataByBrand()}
                        margin={{ top: 20, right: 30, left: 20, bottom: 80 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="name"
                          angle={-45}
                          textAnchor="end"
                          interval={0}
                          height={70}
                        />
                        {activeMetricOption && (
                          <YAxis
                            domain={chartDomains.barDomain}
                            allowDataOverflow
                            tickFormatter={(v: number) => formatAxisTick(v, activeMetricOption)}
                          />
                        )}
                        <Tooltip formatter={chartTooltipFormatter} />
                        {activeMetricOption?.isIndex && (
                          <ReferenceLine y={100} stroke="#b8c0cc" strokeDasharray="4 4" />
                        )}
                        <Bar
                          dataKey="Base Case"
                          name="Base Case"
                          fill={scenarioColor(0)}
                          legendType="none"
                        />
                        {selectedScenarios.map((sName, idx) => (
                          <Bar
                            key={sName}
                            dataKey={sName}
                            name={sName}
                            fill={scenarioColor(idx + 1)}
                            legendType="none"
                          />
                        ))}
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
                <CompareChartColorMap items={colorMapItems} />
              </div>
            ) : (
              <div className="panel mt-16">
                <div className="compare-table-toolbar">
                  {(isByBrandLayout
                    ? activeMetricOption && !activeMetricOption.isIndex
                    : activeShareMetricOption) && (
                    <label className="checkbox-toggle">
                      <input
                        type="checkbox"
                        checked={showIndexView}
                        onChange={(e) => setShowIndexView(e.target.checked)}
                      />
                      Include Index (vs Base) in table & CSV export
                    </label>
                  )}
                  <div className="compare-table-export-actions">
                    <button
                      className="btn-secondary"
                      disabled={selectedScenarios.length === 0 || exportMutation.isPending}
                      onClick={handleExcelExport}
                    >
                      {exportMutation.isPending ? "Generating Excel…" : "Export Excel ⬇"}
                    </button>
                    <button className="btn-secondary" disabled={!compareData} onClick={handleCsvExport}>
                      Export CSV ⬇
                    </button>
                  </div>
                </div>
                <h3>{chartTitle} comparison</h3>
                <div className="pivot-table-wrap">
                  <table className="pivot-grid">
                    <thead>
                      <tr>
                        <th>Brand</th>
                        {isByBrandLayout && activeMetricOption && (
                          <th className="scenario-header">Base ({activeMetricOption.label})</th>
                        )}
                        {!isByBrandLayout && activeShareMetricOption && (
                          <th className="scenario-header">Base ({activeShareMetricOption.label})</th>
                        )}
                        {!isByBrandLayout && showRevenueIndex && (
                          <th className="scenario-header">Base (Rev Index)</th>
                        )}
                        {selectedScenarios.map((sName) => (
                          <Fragment key={sName}>
                            {isByBrandLayout && activeMetricOption && (
                              <th className="scenario-header">
                                {sName} ({activeMetricOption.label})
                              </th>
                            )}
                            {!isByBrandLayout && activeShareMetricOption && (
                              <th className="scenario-header">
                                {sName} ({activeShareMetricOption.label})
                              </th>
                            )}
                            {!isByBrandLayout && showRevenueIndex && (
                              <th className="scenario-header">{sName} (Rev Index)</th>
                            )}
                            {showIndexView && activeShareMetricOption && (
                              <th className="scenario-header">{sName} Index</th>
                            )}
                          </Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {getBaseRows().map((baseRow: any) => {
                        const name = rowLabel(baseRow);
                        const baseBarVal =
                          activeBarMetric && (!isByBrandLayout || activeBarMetric !== REV_INDEX_METRIC.key)
                            ? getMetricValueForRow(baseRow, null, activeBarMetric)
                            : 0;
                        const baseSingleVal =
                          isByBrandLayout && activeBarMetric
                            ? getMetricValueForRow(baseRow, null, activeBarMetric)
                            : 0;
                        const baseRevVal = getMetricValueForRow(
                          baseRow,
                          null,
                          REV_INDEX_METRIC.key,
                        );
                        return (
                          <tr key={String(name)}>
                            <td className="row-name-cell">{name}</td>
                            {isByBrandLayout && activeMetricOption && (
                              <td className="base-cell">
                                {formatCell(baseSingleVal, activeMetricOption)}
                              </td>
                            )}
                            {!isByBrandLayout && activeShareMetricOption && (
                              <td className="base-cell">
                                {formatCell(baseBarVal, activeShareMetricOption)}
                              </td>
                            )}
                            {!isByBrandLayout && showRevenueIndex && (
                              <td className="base-cell">{formatCell(baseRevVal, REV_INDEX_METRIC)}</td>
                            )}
                            {selectedScenarios.map((sName) => {
                              const singleVal =
                                isByBrandLayout && activeBarMetric
                                  ? getMetricValueForRow(baseRow, sName, activeBarMetric)
                                  : 0;
                              const barVal =
                                activeBarMetric && activeBarMetric !== REV_INDEX_METRIC.key
                                  ? getMetricValueForRow(baseRow, sName, activeBarMetric)
                                  : 0;
                              const revVal = getMetricValueForRow(
                                baseRow,
                                sName,
                                REV_INDEX_METRIC.key,
                              );
                              const index = baseBarVal ? (barVal / baseBarVal) * 100 : 0;
                              const indexClass =
                                index > 100.05 ? "cell-pos" : index < 99.95 ? "cell-neg" : "";
                              const revClass =
                                revVal > 100.05 ? "cell-pos" : revVal < 99.95 ? "cell-neg" : "";
                              const singleClass =
                                activeMetricOption?.isIndex && isByBrandLayout ? revClass : "";
                              return (
                                <Fragment key={sName}>
                                  {isByBrandLayout && activeMetricOption && (
                                    <td className={`val-cell ${singleClass}`}>
                                      {formatCell(singleVal, activeMetricOption)}
                                    </td>
                                  )}
                                  {!isByBrandLayout && activeShareMetricOption && (
                                    <td className="val-cell">
                                      {formatCell(barVal, activeShareMetricOption)}
                                    </td>
                                  )}
                                  {!isByBrandLayout && showRevenueIndex && (
                                    <td className={`val-cell ${revClass}`}>
                                      {formatCell(revVal, REV_INDEX_METRIC)}
                                    </td>
                                  )}
                                  {showIndexView && activeShareMetricOption && (
                                    <td className={`index-cell ${indexClass}`}>
                                      {index.toFixed(settings.decimalPlaces)}
                                    </td>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="comparison-controls-row comparison-controls-row--bottom">
              <div className="view-toggle" role="group" aria-label="Comparison view">
                <button
                  type="button"
                  className={compareView === "chart" ? "active" : ""}
                  onClick={() => setCompareView("chart")}
                >
                  Chart
                </button>
                <button
                  type="button"
                  className={compareView === "table" ? "active" : ""}
                  onClick={() => setCompareView("table")}
                >
                  Table
                </button>
              </div>

              {compareView === "chart" && (
                <>
                  <div className="control-divider" aria-hidden="true" />

                  <div className="view-toggle" role="group" aria-label="Chart layout">
                    <button
                      type="button"
                      className={chartLayout === "byScenario" ? "active" : ""}
                      onClick={() => handleChartLayoutChange("byScenario")}
                    >
                      By scenario
                    </button>
                    <button
                      type="button"
                      className={chartLayout === "byBrand" ? "active" : ""}
                      onClick={() => handleChartLayoutChange("byBrand")}
                    >
                      By brand
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        </div>
        </div>
      </div>
    </section>
  );
}
