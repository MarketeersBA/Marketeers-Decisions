import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useApplyScenario, useScenarios, useResetSession } from "../api/hooks";
import type { GroupRow, ResultRow } from "../api/types";
import { AppSelect } from "./AppSelect";
import { SaveScenarioButton } from "./SaveScenarioButton";
import { useSession } from "../stores/sessionStore";

interface ScenarioChipItem {
  id: string;
  name: string;
  description?: string;
  validation: boolean;
}

function splitScenarioChips(items: ScenarioChipItem[], fitted: number, activeId: string) {
  const count = Math.min(Math.max(fitted, 1), items.length);
  const visible = items.slice(0, count);
  if (!visible.some((item) => item.id === activeId)) {
    const active = items.find((item) => item.id === activeId);
    if (active) visible[visible.length - 1] = active;
  }
  const visibleIds = new Set(visible.map((item) => item.id));
  return { visible, overflow: items.filter((item) => !visibleIds.has(item.id)) };
}

function ScenarioChipList({
  scenarios,
  activeName,
  busy,
  onLoadBase,
  onLoad,
}: {
  scenarios: { name: string; description?: string; validation?: boolean }[];
  activeName: string;
  busy: boolean;
  onLoadBase: () => void;
  onLoad: (name: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [fitted, setFitted] = useState(scenarios.length + 1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");

  const items = useMemo<ScenarioChipItem[]>(
    () => [
      { id: "", name: "Base Scenario", validation: false },
      ...scenarios.map((scenario) => ({
        id: scenario.name,
        name: scenario.name,
        description: scenario.description,
        validation: Boolean(scenario.validation),
      })),
    ],
    [scenarios],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const update = () => {
      const available = container.clientWidth;
      const chips = Array.from(measure.querySelectorAll<HTMLElement>("[data-chip]"));
      const more = measure.querySelector<HTMLElement>("[data-more]");
      const moreWidth = more?.offsetWidth ?? 0;
      const gap = 8;
      let used = 0;
      let fit = 0;
      for (let i = 0; i < chips.length; i += 1) {
        const width = chips[i].offsetWidth;
        const gapBefore = fit > 0 ? gap : 0;
        const reserve = i < chips.length - 1 ? gap + moreWidth : 0;
        if (used + gapBefore + width + reserve > available) break;
        used += gapBefore + width;
        fit = i + 1;
      }
      setFitted(Math.max(1, fit));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [items]);

  const { visible, overflow } = splitScenarioChips(items, fitted, activeName);
  const menuQuery = query.trim().toLowerCase();
  const menuItems = menuQuery
    ? overflow.filter(
        (item) =>
          item.name.toLowerCase().includes(menuQuery) ||
          (item.description ?? "").toLowerCase().includes(menuQuery),
      )
    : overflow;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
    setQuery("");
  }, [activeName, scenarios]);

  useEffect(() => {
    if (!menuOpen) return;
    searchRef.current?.focus();
  }, [menuOpen]);

  const activate = (item: ScenarioChipItem) => {
    setMenuOpen(false);
    if (item.id) onLoad(item.id);
    else onLoadBase();
  };

  const chip = (item: ScenarioChipItem, measure = false) => (
    <button
      key={item.id || "base"}
      type="button"
      data-chip={measure ? "" : undefined}
      role={measure ? undefined : "option"}
      aria-selected={measure ? undefined : activeName === item.id}
      className={`scenario-chip ${!measure && activeName === item.id ? "active" : ""}`}
      disabled={measure ? undefined : busy}
      title={item.description || item.name}
      onClick={measure ? undefined : () => activate(item)}
    >
      {item.name}
      {item.validation ? (
        <span className="scenario-chip-badge" title="Legacy validation scenario">
          V
        </span>
      ) : null}
    </button>
  );

  return (
    <div className="scenario-chip-list" ref={containerRef} role="listbox" aria-label="Saved scenarios">
      <div className="scenario-chip-measure" ref={measureRef} aria-hidden="true">
        {items.map((item) => chip(item, true))}
        <button type="button" className="scenario-chip" data-more="" tabIndex={-1}>
          +{items.length}
        </button>
      </div>
      {visible.map((item) => chip(item))}
      {overflow.length > 0 ? (
        <div className="scenario-more" ref={menuRef}>
          <button
            type="button"
            className="scenario-chip scenario-more-btn"
            aria-expanded={menuOpen}
            aria-haspopup="listbox"
            disabled={busy}
            onClick={() => setMenuOpen((open) => !open)}
          >
            +{overflow.length}
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6.5 8 10.5 12 6.5"
              />
            </svg>
          </button>
          {menuOpen ? (
            <div className="scenario-more-menu">
              <input
                ref={searchRef}
                className="scenario-more-search"
                type="search"
                value={query}
                placeholder="Search scenarios"
                aria-label="Search scenarios"
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="scenario-more-options" role="listbox" aria-label="More scenarios">
                {menuItems.map((item) => (
                  <button
                    key={item.id || "base"}
                    type="button"
                    role="option"
                    aria-selected={activeName === item.id}
                    className={`scenario-more-item ${activeName === item.id ? "active" : ""}`}
                    disabled={busy}
                    onClick={() => activate(item)}
                  >
                    {item.name}
                    {item.validation ? <span className="scenario-chip-badge">V</span> : null}
                  </button>
                ))}
                {menuItems.length === 0 ? (
                  <p className="scenario-more-empty">No matching scenarios</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface Props {
  pendingChanges?: number;
  onCompare?: () => void;
  onToast?: (msg: string, type?: "warn" | "success") => void;
  /** Full study product rows (baseline scenario), for scope resolution and counts. */
  allRows?: ResultRow[];
  /** Live grid rows — only used for row checkbox (Selected) state when scoping by checked rows. */
  rows?: ResultRow[];
  /** Editable column holding the working price (e.g. "New Price"). */
  priceColumn?: string | null;
  /** Design-sheet groups keyed by Group* type (Brand, Size, …). */
  groupsByType?: Record<string, GroupRow[]>;
  /** Applies a % price change to the given SKUs directly on the grid. */
  onBulkApply?: (productNames: string[], pct: number) => void;
}

export function ScenarioManagerBar({
  pendingChanges = 0,
  onCompare,
  onToast,
  allRows = [],
  rows = [],
  priceColumn = null,
  groupsByType = {},
  onBulkApply,
}: Props) {
  const { session, setSession } = useSession();
  const slug = session?.slug;
  const { data: scenarios = [] } = useScenarios(slug);
  const applyScenario = useApplyScenario();
  const resetSession = useResetSession();

  const [bulkBrand, setBulkBrand] = useState("All");
  const [bulkGroup, setBulkGroup] = useState("");
  const [bulkPct, setBulkPct] = useState<number | "">(3);

  const groupTypes = useMemo(() => {
    const fromMap = Object.keys(groupsByType);
    const fromSession = session?.groupTypes ?? [];
    const merged = Array.from(new Set([...fromSession, ...fromMap]));
    const branded = merged.filter((t) => /brand/i.test(t)).sort();
    const rest = merged.filter((t) => !/brand/i.test(t)).sort();
    return [...branded, ...rest];
  }, [groupsByType, session?.groupTypes]);

  const brandType = groupTypes.find((t) => /brand/i.test(t)) ?? groupTypes[0] ?? "";
  const brandGroups = groupsByType[brandType] ?? [];
  const otherTypes = groupTypes.filter((t) => t !== brandType);

  const studyRows = useMemo(
    () => allRows.filter((r) => !r._isGroupHeader && !r._placeholder),
    [allRows],
  );

  const selectedByProduct = useMemo(() => {
    const map = new Map<string, boolean>();
    rows
      .filter((r) => !r._isGroupHeader && !r._placeholder)
      .forEach((r) => {
        const name = String(r["Product Name"] ?? "");
        if (name) map.set(name, Boolean(r["Selected"]));
      });
    return map;
  }, [rows]);

  const brandByProduct = useMemo(() => {
    const map = new Map<string, string>();
    brandGroups.forEach((g) => {
      (g.productNames ?? []).forEach((p) => map.set(p, g.Name));
    });
    return map;
  }, [brandGroups]);

  const selectedStudyGroup = useMemo(() => {
    if (!bulkGroup) return null;
    const tab = bulkGroup.indexOf("\t");
    if (tab < 0) return null;
    const type = bulkGroup.slice(0, tab);
    const name = bulkGroup.slice(tab + 1);
    return (groupsByType[type] ?? []).find((g) => g.Name === name) ?? null;
  }, [bulkGroup, groupsByType]);

  const scopedNames = useMemo(() => {
    const allNames = studyRows
      .map((r) => String(r["Product Name"] ?? ""))
      .filter(Boolean);

    const matchesBrand = (name: string) =>
      bulkBrand === "All" || brandByProduct.get(name) === bulkBrand;

    // Checked rows in the grid override group/brand when the user has narrowed selection.
    const checkedNames = allNames.filter((name) => selectedByProduct.get(name) === true);
    const hasExplicitCheckSelection =
      checkedNames.length > 0 && checkedNames.length < allNames.length;

    if (hasExplicitCheckSelection) {
      return checkedNames.filter(matchesBrand);
    }
    if (selectedStudyGroup) {
      const groupNames = selectedStudyGroup.productNames ?? [];
      return bulkBrand === "All"
        ? groupNames
        : groupNames.filter(matchesBrand);
    }
    return allNames.filter(matchesBrand);
  }, [selectedStudyGroup, studyRows, bulkBrand, brandByProduct, selectedByProduct]);

  const scopeUsesCheckedRows = useMemo(() => {
    const allNames = studyRows
      .map((r) => String(r["Product Name"] ?? ""))
      .filter(Boolean);
    const checkedNames = allNames.filter((name) => selectedByProduct.get(name) === true);
    return checkedNames.length > 0 && checkedNames.length < allNames.length;
  }, [studyRows, selectedByProduct]);

  const countNamesForBrand = useCallback(
    (names: string[]) => {
      if (bulkBrand === "All") return names.length;
      return names.filter((n) => brandByProduct.get(n) === bulkBrand).length;
    },
    [bulkBrand, brandByProduct],
  );

  const scopeDescriptor = useMemo(() => {
    const parts: string[] = [];
    if (scopeUsesCheckedRows) {
      parts.push("checked rows");
    } else {
      if (bulkBrand !== "All") parts.push(bulkBrand);
      if (selectedStudyGroup) parts.push(selectedStudyGroup.Name);
    }
    return parts.join(" · ");
  }, [scopeUsesCheckedRows, bulkBrand, selectedStudyGroup]);

  const scopeCountLabel = useMemo(() => {
    const n = scopedNames.length;
    return `${n} SKU${n === 1 ? "" : "s"}`;
  }, [scopedNames.length]);

  if (!session) return null;

  const activeName = session.scenarioName || "";
  const busy = applyScenario.isPending || resetSession.isPending;
  const scenarioLabel = activeName || "Base Scenario";

  // Reset to mockup defaults when the study/session changes.
  useEffect(() => {
    setBulkBrand("All");
    setBulkGroup("");
    setBulkPct(3);
  }, [session.sessionId]);

  const confirmLeaveEdits = () => {
    if (pendingChanges <= 0) return true;
    return window.confirm(
      `You have ${pendingChanges} unsaved edit${pendingChanges > 1 ? "s" : ""}. Load anyway and discard them?`,
    );
  };

  const loadBase = () => {
    if (!confirmLeaveEdits()) return;
    resetSession.mutate(session.sessionId, {
      onSuccess: (payload) => {
        setSession(payload);
        onToast?.("Loaded Base Scenario", "success");
      },
    });
  };

  const loadNamed = (scenarioName: string) => {
    if (scenarioName === activeName && pendingChanges === 0) return;
    if (!confirmLeaveEdits()) return;
    applyScenario.mutate(
      { sessionId: session.sessionId, name: scenarioName },
      {
        onSuccess: (payload) => {
          setSession(payload);
          onToast?.(`Loaded: ${scenarioName}`, "success");
        },
        onError: (err) => onToast?.(err.message || "Failed to load scenario", "warn"),
      },
    );
  };

  const applyBulk = () => {
    if (bulkPct === "" || !Number.isFinite(bulkPct) || scopedNames.length === 0) return;
    onBulkApply?.(scopedNames, bulkPct);
    const pctLabel = `${bulkPct >= 0 ? "+" : ""}${bulkPct}%`;
    const target =
      scopeDescriptor.length > 0
        ? `${scopeCountLabel} (${scopeDescriptor})`
        : scopeCountLabel;
    onToast?.(`Applied ${pctLabel} to ${target}`, "success");
  };

  return (
    <>
      <div className={`scenario-manager${busy ? " is-busy" : ""}`} aria-busy={busy}>
        <div className="scenario-manager-heading">
          <h3 className="scenario-manager-title">Scenarios</h3>
          <p className="scenario-manager-sub">Choose a scenario to load it into the simulation.</p>
        </div>
        <div className="scenario-manager-row">
        <div className="scenario-manager-left">
          <ScenarioChipList
            scenarios={scenarios}
            activeName={activeName}
            busy={busy}
            onLoadBase={loadBase}
            onLoad={loadNamed}
          />
        </div>

        <div className="scenario-manager-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onCompare?.()}
          >
            Compare scenarios
          </button>
          {slug ? (
            <Link
              to={`/studies/${slug}/scenarios`}
              className="scenario-library-btn"
              title="Manage all scenarios"
              aria-label="Manage all scenarios — open scenario library"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M2.5 2.5h4.2l1.1 1.2H13.5v9.8H2.5V2.5zm1.2 1.2v8.6h8.6V5H7.4L6.3 3.7H3.7zm1.5 2.4h6v1.2h-6V7.1zm0 2.4h4.5v1.2H5.2V9.5z"
                />
              </svg>
            </Link>
          ) : null}
        </div>
        </div>
      </div>

      <div className="bulk-actions-card">
        <h3>
          Bulk price actions <span className="bulk-actions-scenario">— {scenarioLabel}</span>
        </h3>
        <p className="bulk-actions-sub">
          Apply a % change to a brand, a group from the design sheet, or whatever&apos;s checked in the
          table below — no need to touch 5 SKUs at a time.
        </p>
        <div className="bulk-actions-fields">
          <label className="bulk-actions-field">
            <span>{brandType || "Brand"}</span>
            <AppSelect
              ariaLabel={brandType || "Brand"}
              value={bulkBrand}
              onChange={setBulkBrand}
              items={[
                {
                  value: "All",
                  label: /brand/i.test(brandType) || !brandType ? "All brands" : `All ${brandType}`,
                },
                ...brandGroups.map((g) => ({ value: g.Name, label: g.Name })),
              ]}
            />
          </label>
          {otherTypes.some((type) => (groupsByType[type] ?? []).length > 0) ? (
            <label className="bulk-actions-field">
              <span>Group</span>
              <AppSelect
                ariaLabel="Group"
                value={bulkGroup}
                onChange={setBulkGroup}
                items={[
                  {
                    value: "",
                    label: `None — use ${brandType || "Brand"}, or check rows`,
                  },
                ]}
                groups={otherTypes.flatMap((type) => {
                  const members = groupsByType[type] ?? [];
                  if (members.length === 0) return [];
                  return [
                    {
                      label: type,
                      items: members.map((g) => {
                        const total = (g.productNames ?? []).length;
                        const inScope = countNamesForBrand(g.productNames ?? []);
                        const countLabel =
                          bulkBrand !== "All" && inScope !== total
                            ? `${inScope} of ${total} SKUs`
                            : `${inScope} SKU${inScope === 1 ? "" : "s"}`;
                        return {
                          value: `${type}\t${g.Name}`,
                          label: `${g.Name} (${countLabel})`,
                        };
                      }),
                    },
                  ];
                })}
              />
            </label>
          ) : null}
          <label className="bulk-actions-field bulk-actions-pct">
            <span>% price change</span>
            <input
              type="number"
              step={0.5}
              value={bulkPct}
              onChange={(e) => setBulkPct(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </label>
        </div>
        <div className="bulk-actions-row">
          <button
            type="button"
            className="btn-amber"
            disabled={bulkPct === "" || scopedNames.length === 0 || !priceColumn}
            onClick={applyBulk}
          >
            Apply % to scope
          </button>
          <SaveScenarioButton disabled={busy} onToast={onToast} />
          <span className="bulk-actions-count">
            {scopeCountLabel} in scope
            {scopeDescriptor ? ` · ${scopeDescriptor}` : ""}
          </span>
        </div>
        {!priceColumn && <p className="bulk-hint">No editable price column found on this grid.</p>}
      </div>

    </>
  );
}
