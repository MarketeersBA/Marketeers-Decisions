import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type { IncrementalRow } from "../api/analytics_types";
import { api } from "../api/client";
import { useAnalytics } from "../api/hooks";
import { buildOptimizerSetup } from "../api/optimizer_types";
import type { GroupRow, ResultRow } from "../api/types";
import { useSession } from "../stores/sessionStore";
import { usePageActive } from "../hooks/usePageActive";
import { CumulativeIntroChart } from "./assortment/CumulativeIntroChart";
import {
  buildHeadline,
  buildIntroQueryParams,
  buildIntroSteps,
  formatJumpPp,
  formatPsr,
  formatSharePct,
  formatWd,
  stepsThroughShareCutoff,
  type IntroStep,
  type ShareCoverage,
} from "./assortment/cumulativeIntroUtils";
import {
  ALL_MEMBERS,
  discreteLevelsForType,
  filterScopedSkus,
  filterStandaloneOfferSkus,
  findGroupRow,
  groupsForType,
  isOfferTypeGroupType,
} from "./assortment/assortmentFilterUtils";

type ResultsView = "chart" | "table";

const SHARE_METRIC = "value_share" as const;

const COMPANY_PRODUCTS = "Company Products";
const DEFAULT_GROUP_TYPE = "Brand";

function defaultGroupType(groupTypes: string[]): string {
  return groupTypes.find((t) => /^brand$/i.test(t)) ?? groupTypes[0] ?? DEFAULT_GROUP_TYPE;
}

function membersForType(groupsByType: Record<string, GroupRow[]>, type: string): string[] {
  return groupsForType(groupsByType, type).map((g) => String(g.Name));
}

function crossFilterOptions(
  groupsByType: Record<string, GroupRow[]>,
  type: string,
  ownSkuSet: Set<string>,
  discreteLevels?: Record<string, string[]>,
): string[] {
  const fromGroups = membersForGroupType(groupsByType, type, ownSkuSet);
  if (fromGroups.length > 0) return fromGroups;
  return discreteLevelsForType(discreteLevels, type);
}

function membersForGroupType(
  groupsByType: Record<string, GroupRow[]>,
  type: string,
  ownSkus: Set<string>,
): string[] {
  return filterOwnedBrandMembers(groupsByType, type, membersForType(groupsByType, type), ownSkus);
}

function isBrandGroupType(type: string): boolean {
  return /^brand$/i.test(type);
}

function isCompanyGroupType(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return normalized === "co" || normalized === "company" || normalized === "company products";
}

function isCrossFilterEligibleType(type: string): boolean {
  return (
    type !== COMPANY_PRODUCTS &&
    !isBrandGroupType(type) &&
    !isCompanyGroupType(type) &&
    !isOfferTypeGroupType(type)
  );
}

function crossFilterEligibleTypes(groupTypes: string[]): string[] {
  return groupTypes.filter((g) => isCrossFilterEligibleType(g));
}

function filterOwnedBrandMembers(
  groupsByType: Record<string, GroupRow[]>,
  type: string,
  members: string[],
  ownSkus: Set<string>,
): string[] {
  if (ownSkus.size === 0 || !isBrandGroupType(type)) return members;
  return members.filter((member) => {
    const row = findGroupRow(groupsByType, type, member);
    const skus = Array.isArray(row?.productNames) ? row.productNames : [];
    return skus.some((sku) => ownSkus.has(sku));
  });
}

export function AssortmentIncrementalPanel({
  onResultsChange,
}: {
  onResultsChange?: (steps: IntroStep[], headline: string | null) => void;
}) {
  const { session } = useSession();
  const pageActive = usePageActive();
  const slug = session?.slug;

  const [brandMember, setBrandMember] = useState("");
  const [crossFilterMembers, setCrossFilterMembers] = useState<Record<string, string>>({});
  const [groupsByType, setGroupsByType] = useState<Record<string, GroupRow[]>>({});
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [resultsView, setResultsView] = useState<ResultsView>("chart");
  const [shareCoverage, setShareCoverage] = useState<ShareCoverage>("all");
  const [queryParams, setQueryParams] = useState<Record<string, string> | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [showChart, setShowChart] = useState(false);
  const [isChartPending, startChartTransition] = useTransition();
  const [loadingStartedAt, setLoadingStartedAt] = useState<number | null>(null);
  const [, setLoadingTick] = useState(0);
  const lastRowsRef = useRef<IncrementalRow[]>([]);

  const groupTypes = useMemo(() => {
    const types = session?.groupTypes ?? [];
    return types.includes(DEFAULT_GROUP_TYPE)
      ? types
      : [DEFAULT_GROUP_TYPE, ...types.filter((t) => t !== DEFAULT_GROUP_TYPE)];
  }, [session?.groupTypes]);

  // Session payload only includes Brand groups — load every group type for cross-filtering.
  useEffect(() => {
    if (!session?.sessionId) return;
    let cancelled = false;
    const types = session.groupTypes ?? [];
    const brandType = defaultGroupType(types);
    setGroupsByType(brandType && session.groups?.length ? { [brandType]: session.groups } : {});

    Promise.allSettled(
      types.map((gt) =>
        api
          .get<{ groups: GroupRow[] }>(
            `/api/sessions/${session.sessionId}/groups?group_type=${encodeURIComponent(gt)}`,
          )
          .then((data) => [gt, data.groups] as const),
      ),
    ).then((results) => {
      if (cancelled) return;
      const entries = results
        .filter(
          (result): result is PromiseFulfilledResult<readonly [string, GroupRow[]]> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value);
      if (entries.length > 0) {
        setGroupsByType((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [session?.sessionId, session?.groupTypes, session?.groups]);

  const ownSkuSet = useMemo(
    () => new Set(session?.companyProducts ?? []),
    [session?.companyProducts],
  );

  const discreteLevels = session?.discreteAttributeLevels;

  const crossFilterTypes = useMemo(
    () =>
      crossFilterEligibleTypes(groupTypes).filter(
        (type) => crossFilterOptions(groupsByType, type, ownSkuSet, discreteLevels).length > 0,
      ),
    [groupTypes, groupsByType, ownSkuSet, discreteLevels],
  );

  const brandType = useMemo(() => defaultGroupType(groupTypes), [groupTypes]);

  const sessionResults = useMemo(
    () => (session?.results ?? []) as ResultRow[],
    [session?.results],
  );

  const brandMembers = useMemo(
    () => membersForGroupType(groupsByType, brandType, ownSkuSet),
    [groupsByType, brandType, ownSkuSet],
  );

  const scopedSkus = useMemo(() => {
    const row = findGroupRow(groupsByType, brandType, brandMember);
    const baseSkus = Array.isArray(row?.productNames) ? row.productNames : [];
    const filtered = filterScopedSkus(
      baseSkus,
      crossFilterMembers,
      groupsByType,
      sessionResults,
      discreteLevels,
    );
    return filterStandaloneOfferSkus(filtered, groupsByType);
  }, [groupsByType, brandType, brandMember, crossFilterMembers, sessionResults, discreteLevels]);

  const activeSkus = useMemo(
    () => scopedSkus.filter((sku) => selectedSkus.has(sku)),
    [scopedSkus, selectedSkus],
  );

  useEffect(() => {
    setSelectedSkus(new Set(scopedSkus));
  }, [scopedSkus]);

  useEffect(() => {
    if (brandMembers.length > 0) {
      if (!brandMember || !brandMembers.includes(brandMember)) {
        setBrandMember(brandMembers[0]);
      }
    } else {
      setBrandMember("");
    }
  }, [brandType, brandMembers, brandMember]);

  useEffect(() => {
    setCrossFilterMembers((prev) => {
      const eligible = crossFilterTypes;
      const next: Record<string, string> = {};
      for (const type of eligible) {
        const members = crossFilterOptions(groupsByType, type, ownSkuSet, discreteLevels);
        const prevMember = prev[type];
        if (prevMember && (prevMember === ALL_MEMBERS || members.includes(prevMember))) {
          next[type] = prevMember;
        } else {
          next[type] = ALL_MEMBERS;
        }
      }
      const prevKeys = Object.keys(prev).sort();
      const nextKeys = Object.keys(next).sort();
      const unchanged =
        prevKeys.length === nextKeys.length &&
        prevKeys.every((key, index) => key === nextKeys[index] && prev[key] === next[key]);
      return unchanged ? prev : next;
    });
  }, [crossFilterTypes, groupsByType, ownSkuSet, discreteLevels]);

  const crossFilterKey = useMemo(() => JSON.stringify(crossFilterMembers), [crossFilterMembers]);

  useEffect(() => {
    setQueryParams(null);
    setShowChart(false);
    lastRowsRef.current = [];
    onResultsChange?.([], null);
  }, [brandMember, crossFilterKey, session?.slug, session?.scenarioName]);
  const setup = useMemo(
    () => buildOptimizerSetup(session?.segmentation, session?.scenarioName || null),
    [session?.segmentation, session?.scenarioName],
  );

  const { data, isPending, error, isFetching } = useAnalytics(
    slug,
    "introduction",
    queryParams ?? {},
    { enabled: pageActive && Boolean(slug && queryParams) },
  );

  const rows = useMemo(() => {
    const fetched = Array.isArray(data?.data) ? (data!.data as IncrementalRow[]) : [];
    if (fetched.length > 0) {
      lastRowsRef.current = fetched;
      return fetched;
    }
    return lastRowsRef.current;
  }, [data]);
  const isLoading = Boolean(queryParams) && (isPending || isFetching) && rows.length === 0;
  const isRefreshing = Boolean(queryParams) && isFetching && rows.length > 0;
  const loadingElapsedSec =
    loadingStartedAt != null ? Math.floor((Date.now() - loadingStartedAt) / 1000) : 0;

  useEffect(() => {
    if (isLoading) {
      setLoadingStartedAt((started) => started ?? Date.now());
      return;
    }
    setLoadingStartedAt(null);
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading) return;
    const id = window.setInterval(() => setLoadingTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(id);
  }, [isLoading]);

  const steps = useMemo(() => {
    if (rows.length === 0) return [];
    return buildIntroSteps(rows, (session?.results ?? []) as ResultRow[], SHARE_METRIC);
  }, [rows, session?.results]);

  const headline = useMemo(() => buildHeadline(steps), [steps]);

  const visibleSteps = useMemo(() => {
    if (shareCoverage === "all") return steps;
    return stepsThroughShareCutoff(steps, shareCoverage);
  }, [steps, shareCoverage]);

  useEffect(() => {
    if (queryParams && !isLoading && !error) {
      onResultsChange?.(steps, headline);
    }
  }, [steps, headline, queryParams, isLoading, error, onResultsChange]);

  useEffect(() => {
    if (!queryParams || isLoading || error || steps.length === 0 || !pageActive) {
      setShowChart(false);
      return;
    }
    startChartTransition(() => {
      setShowChart(true);
    });
  }, [queryParams, isLoading, error, steps, pageActive]);

  const handleRun = () => {
    if (activeSkus.length === 0) return;
    lastRowsRef.current = [];
    const params = buildIntroQueryParams(setup, brandType, brandMember, activeSkus);
    setQueryParams(params);
    setRunKey((k) => k + 1);
  };

  const toggleSku = (sku: string) => {
    setSelectedSkus((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  };

  const setAllScoped = (checked: boolean) => {
    setSelectedSkus(checked ? new Set(scopedSkus) : new Set());
  };
  if (!slug) {
    return (
      <div className="opt-card">
        <div className="opt-table-head">
          <h2 className="opt-section-title">Cumulative introduction</h2>
          <p className="opt-section-sub">Load a study from Home or Simulator first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="opt-card assortment-inc-card">
      <div className="assortment-inc-head">
        <h2 className="opt-section-title">Cumulative introduction</h2>
        <p className="opt-section-sub">
          Select a brand, then optionally narrow SKUs using study group values (e.g. tier, size, smart).
          Introduction order uses base-scenario value share; cumulative share sums those fixed values.
        </p>
      </div>

      <div className="assortment-inc-filters-row">
        <div className="assortment-inc-toolbar">
          {brandMembers.length > 0 ? (
            <label className="assortment-inc-tool">
              <span className="assortment-inc-label">Brand</span>
              <select value={brandMember} onChange={(e) => setBrandMember(e.target.value)}>
                {brandMembers.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {crossFilterTypes.map((filterType) => {
            const filterMembers = crossFilterOptions(
              groupsByType,
              filterType,
              ownSkuSet,
              discreteLevels,
            );
            const value = crossFilterMembers[filterType] ?? ALL_MEMBERS;

            return (
              <label key={filterType} className="assortment-inc-tool">
                <span className="assortment-inc-label">{filterType}</span>
                <select
                  value={value}
                  onChange={(e) =>
                    setCrossFilterMembers((prev) => ({
                      ...prev,
                      [filterType]: e.target.value,
                    }))
                  }
                >
                  <option value={ALL_MEMBERS}>All</option>
                  {filterMembers.map((member) => (
                    <option key={member} value={member}>
                      {member}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}

          <button
            type="button"
            className="assortment-inc-run"
            disabled={activeSkus.length === 0}
            onClick={handleRun}
          >
            Run
          </button>
        </div>

        <div className="assortment-inc-list-panel assortment-scoped-panel">
          <div className="assortment-scoped-actions">
            <button type="button" onClick={() => setAllScoped(true)} disabled={scopedSkus.length === 0}>
              Select all
            </button>
            <button type="button" onClick={() => setAllScoped(false)} disabled={scopedSkus.length === 0}>
              Clear all
            </button>
          </div>
          <div className="assortment-inc-checklist assortment-scoped-list">
            {scopedSkus.length === 0 ? (
              <p className="assortment-inc-empty">No SKUs match the current group and filters.</p>
            ) : (
              scopedSkus.map((sku) => (
                <label key={sku} className="assortment-inc-check">
                  <input
                    type="checkbox"
                    checked={selectedSkus.has(sku)}
                    onChange={() => toggleSku(sku)}
                  />
                  <span>{sku}</span>
                </label>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="assortment-inc-chart" key={runKey}>
        <div className="assortment-chart-header">
          <div className="assortment-seg" role="group" aria-label="Value share coverage">
            <button
              type="button"
              className={`assortment-seg-btn${shareCoverage === "all" ? " is-active" : ""}`}
              onClick={() => setShareCoverage("all")}
              aria-pressed={shareCoverage === "all"}
            >
              All
            </button>
            <button
              type="button"
              className={`assortment-seg-btn${shareCoverage === 80 ? " is-active" : ""}`}
              onClick={() => setShareCoverage(80)}
              title="SKUs that reach about 80% of lineup value share"
              aria-pressed={shareCoverage === 80}
            >
              80%
            </button>
            <button
              type="button"
              className={`assortment-seg-btn${shareCoverage === 90 ? " is-active" : ""}`}
              onClick={() => setShareCoverage(90)}
              title="SKUs that reach about 90% of lineup value share"
              aria-pressed={shareCoverage === 90}
            >
              90%
            </button>
            <button
              type="button"
              className={`assortment-seg-btn${shareCoverage === 95 ? " is-active" : ""}`}
              onClick={() => setShareCoverage(95)}
              title="SKUs that reach about 95% of lineup value share"
              aria-pressed={shareCoverage === 95}
            >
              95%
            </button>
          </div>
          <div className="assortment-seg assortment-seg-icons" role="group" aria-label="Results view">
            <button
              type="button"
              className={`assortment-seg-btn assortment-seg-btn-icon${resultsView === "chart" ? " is-active" : ""}`}
              onClick={() => setResultsView("chart")}
              title="Chart view"
              aria-label="Chart view"
              aria-pressed={resultsView === "chart"}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M2 13V8h3v5H2zm4.5 0V3h3v10h-3zM11 13V6h3v7h-3z"
                />
              </svg>
            </button>
            <button
              type="button"
              className={`assortment-seg-btn assortment-seg-btn-icon${resultsView === "table" ? " is-active" : ""}`}
              onClick={() => setResultsView("table")}
              title="Table view"
              aria-label="Table view"
              aria-pressed={resultsView === "table"}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M2 3h12v10H2V3zm0 1.5v2.5h12V4.5H2zm0 4v5h5v-5H2zm6 0v5h5v-5H8z"
                />
              </svg>
            </button>
          </div>
        </div>
        {!queryParams ? (
          <p className="assortment-inc-placeholder">
            Choose a group and press Run to build the cumulative introduction chart.
          </p>
        ) : isLoading ? (
          <p className="assortment-inc-placeholder">
            Computing cumulative introduction for {activeSkus.length} SKUs…
            {loadingElapsedSec > 0 ? ` (${loadingElapsedSec}s)` : null}
            <br />
            <span className="assortment-inc-hint">
              Large brands can take 30–60 seconds — the page stays responsive while waiting.
            </span>
          </p>
        ) : error ? (
          <p className="error-text">Failed to load cumulative introduction. {error.message}</p>
        ) : visibleSteps.length === 0 ? (
          <p className="assortment-inc-placeholder">No introduction data for this selection.</p>
        ) : resultsView === "table" ? (
          <div className="assortment-seq-table-wrap">
            <table className="assortment-seq-table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>SKU</th>
                  <th className="assortment-seq-num">Cumulative value share</th>
                  <th className="assortment-seq-num">Value share (jump)</th>
                  <th className="assortment-seq-num">WD</th>
                  <th className="assortment-seq-num">PSR</th>
                </tr>
              </thead>
              <tbody>
                {visibleSteps.map((step) => (
                  <tr key={step.productName}>
                    <td>
                      <span className="assortment-seq-step">{step.step}</span>
                    </td>
                    <td className="assortment-seq-name">{step.productName}</td>
                    <td className="assortment-seq-num">{formatSharePct(step.cumulativeSharePct)}</td>
                    <td className="assortment-seq-num">{formatJumpPp(step.jumpPp)}</td>
                    <td className="assortment-seq-num">{formatWd(step.wd)}</td>
                    <td className="assortment-seq-num">{formatPsr(step.psr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !pageActive ? (
          <p className="assortment-inc-placeholder">
            Chart paused while another section is open. Return to Assortment to view.
          </p>
        ) : !showChart || isChartPending || isRefreshing ? (
          <p className="assortment-inc-placeholder">
            {isRefreshing ? "Updating results…" : "Rendering chart…"}
          </p>
        ) : (
          <CumulativeIntroChart steps={visibleSteps} />
        )}
      </div>
    </div>
  );
}
