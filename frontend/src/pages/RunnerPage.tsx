import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { StudyRequiredNotice } from "../components/StudyRequiredNotice";

import { api } from "../api/client";
import { useGroups, useRecalculate, useExportSession, useApplySegmentation } from "../api/hooks";
import type { CellValue, GroupRow, ResultRow, SegmentationState } from "../api/types";
import { ManufacturerScenarioCompare } from "../components/ManufacturerScenarioCompare";
import { TradeEffectPanel } from "../components/TradeEffectPanel";
import { ResultsGrid } from "../components/ResultsGrid";
import { SaveScenarioButton } from "../components/SaveScenarioButton";
import { ScenarioCompareSection } from "../components/ScenarioCompareSection";
import { AppSelect } from "../components/AppSelect";
import { ScenarioManagerBar } from "../components/ScenarioManagerBar";
import { SettingsPopover } from "../components/SettingsPopover";
import {
  applyGridChangesLocally,
  cloneRows,
  computeGridChanges,
  readyGridChanges,
} from "../lib/gridChanges";
import { fmtNumber } from "../shell/format";
import { useSession } from "../stores/sessionStore";
import { usePageActive } from "../hooks/usePageActive";
import "./pages.css";

const LIVE_RECALC_DEBOUNCE_MS = 400;
const GRID_ROWS_PER_PAGE = 12;
const GRID_PAGE_SIZE = 12;

function defaultGroupType(groupTypes: string[] | undefined): string {
  if (!groupTypes?.length) return "";
  return groupTypes.find((t) => /^brand$/i.test(t)) ?? groupTypes[0];
}

function allCollapsedNames(groups: { Name: string }[]): Set<string> {
  const names = new Set(groups.map((g) => g.Name));
  names.add("Other");
  return names;
}

const SEGMENT_ALL = "__all__";

function segmentationFilterKey(seg: SegmentationState | undefined): string {
  if (!seg) return "";
  const filters = seg.activeFilters ?? (seg.active ? [seg.active] : []);
  return filters
    .map((f) => `${f.assignmentKey}\t${f.member}`)
    .sort()
    .join("|");
}

/** Own vs competitor SKUs — "own" = product flagged with a Company in the study product list. */
type OwnerFilter = "all" | "own" | "comp";

function rowMatchesSearch(productName: string, query: string, groupName?: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (groupName && groupName.toLowerCase().includes(q)) return true;
  return productName.toLowerCase().includes(q);
}

function buildBrandSections(
  skuRows: ResultRow[],
  groups: GroupRow[],
  collapsedGroups: Set<string>,
  ownNames: Set<string>,
  options: {
    normalizedSearch: string;
    hideEmptyGroups: boolean;
    expandAll: boolean;
  },
): BrandSection[] {
  const searchActive = options.normalizedSearch.length > 0;
  const byName = new Map(skuRows.map((r) => [String(r["Product Name"]), r]));

  const mappedNames = new Set<string>();
  for (const g of groups) {
    const names: string[] = Array.isArray(g.productNames) ? g.productNames : [];
    names.forEach((n) => mappedNames.add(n));
  }

  const sections: BrandSection[] = [];
  for (const g of groups) {
    const collapsed = options.expandAll || searchActive ? false : collapsedGroups.has(g.Name);
    const names: string[] = Array.isArray(g.productNames) ? g.productNames : [];
    const matchedRows = names
      .map((n) => byName.get(n))
      .filter((r): r is ResultRow => Boolean(r))
      .filter((r) =>
        rowMatchesSearch(String(r["Product Name"] ?? ""), options.normalizedSearch, g.Name),
      );
    const members = matchedRows
      .filter((r) => r["Selected"] !== false)
      .sort((a, b) => Number(b["B.Share"] ?? 0) - Number(a["B.Share"] ?? 0));
    const unselectedMembers = matchedRows
      .filter((r) => r["Selected"] === false)
      .sort((a, b) => String(a["Product Name"]).localeCompare(String(b["Product Name"])));
    if (options.hideEmptyGroups && members.length === 0 && unselectedMembers.length === 0) continue;
    sections.push({
      key: g.Name,
      productNames: names,
      collapsed,
      members,
      unselectedMembers,
      header: {
        "Product Name": `GROUP:${g.Name}`,
        "N.Share": g["N.Share"],
        "B.Share": g["B.Share"] ?? null,
        "S.Index": g["S.Index"] ?? null,
        "Preference Share": g["Preference Share"] ?? null,
        "Penetration": g["Penetration"] ?? null,
        "Value Share": g["Value Share"] ?? null,
        "Revenue": g["Revenue"] ?? null,
        "R.Index": g["R.Index"] ?? null,
        "MM$": g["MM$"] ?? null,
        "Audit Share": g["Audit Share"] ?? null,
        _collapsed: collapsed,
        _isGroupHeader: true,
        _unselectedSkus: unselectedMembers.map((r) => String(r["Product Name"] ?? "")),
      },
    });
  }

  const unmapped = skuRows.filter((r) => !mappedNames.has(String(r["Product Name"])));
  if (unmapped.length > 0) {
    const collapsed = options.expandAll || searchActive ? false : collapsedGroups.has("Other");
    const members = unmapped
      .filter((r) => r["Selected"] !== false)
      .sort((a, b) => Number(b["B.Share"] ?? 0) - Number(a["B.Share"] ?? 0));
    const unselectedMembers = unmapped
      .filter((r) => r["Selected"] === false)
      .sort((a, b) => String(a["Product Name"]).localeCompare(String(b["Product Name"])));
    sections.push({
      key: "Other",
      productNames: unmapped.map((r) => String(r["Product Name"] ?? "")),
      collapsed,
      members,
      unselectedMembers,
      header: {
        "Product Name": "GROUP:Other",
        "N.Share": null,
        "B.Share": null,
        _collapsed: collapsed,
        _isGroupHeader: true,
        _unselectedSkus: unselectedMembers.map((r) => String(r["Product Name"] ?? "")),
      },
    });
  }
  return sortBrandSections(sections, ownNames);
}

function flattenBrandSections(
  sections: { header: ResultRow; members: ResultRow[]; unselectedMembers: ResultRow[]; collapsed: boolean }[],
): ResultRow[] {
  const res: ResultRow[] = [];
  for (const section of sections) {
    res.push({ ...section.header, _collapsed: section.collapsed });
    if (section.collapsed) continue;
    if (section.members.length === 0) {
      if (section.unselectedMembers.length === 0) {
        res.push({ "Product Name": "(no member data for this group)", _placeholder: true });
      }
      continue;
    }
    res.push(...section.members);
  }
  return res;
}

type BrandSection = {
  key: string;
  productNames: string[];
  header: ResultRow;
  members: ResultRow[];
  unselectedMembers: ResultRow[];
  collapsed: boolean;
};

function brandShareValue(header: ResultRow): number {
  const share = Number(header["B.Share"]);
  return Number.isFinite(share) ? share : -Infinity;
}

function isOwnBrandSection(section: BrandSection, ownNames: Set<string>): boolean {
  if (ownNames.size === 0) return false;
  return section.productNames.some((name) => ownNames.has(name));
}

function compareBrandSections(a: BrandSection, b: BrandSection): number {
  const byShare = brandShareValue(b.header) - brandShareValue(a.header);
  if (byShare !== 0) return byShare;
  return a.key.localeCompare(b.key);
}

/** Own brands first, then competitors; strongest base share first. Order stays fixed as N.Share updates. */
function sortBrandSections(sections: BrandSection[], ownNames: Set<string>): BrandSection[] {
  const other = sections.filter((s) => s.key === "Other");
  const rest = sections.filter((s) => s.key !== "Other");
  if (ownNames.size === 0) {
    rest.sort(compareBrandSections);
    return [...rest, ...other];
  }
  const own = rest.filter((s) => isOwnBrandSection(s, ownNames)).sort(compareBrandSections);
  const comp = rest.filter((s) => !isOwnBrandSection(s, ownNames)).sort(compareBrandSections);
  return [...own, ...comp, ...other];
}

function visibleRowCount(section: BrandSection): number {
  if (section.collapsed) return 1;
  return 1 + section.members.length;
}

/** Keep each brand section intact; pack pages by visible row count. */
function paginateBrandSections(sections: BrandSection[], rowsPerPage: number): BrandSection[][] {
  if (sections.length === 0) return [[]];
  const pages: BrandSection[][] = [];
  let current: BrandSection[] = [];
  let rows = 0;

  for (const section of sections) {
    const sectionRows = visibleRowCount(section);
    if (current.length > 0 && rows + sectionRows > rowsPerPage) {
      pages.push(current);
      current = [section];
      rows = sectionRows;
    } else {
      current.push(section);
      rows += sectionRows;
    }
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

function encodeSegmentOption(assignmentKey: string, member: string): string {
  return `${assignmentKey}\t${member}`;
}

/** Rounded engine output, so anything past this is a real edit rather than float noise. */
const CHANGE_EPS = 1e-6;

/** A SKU counts as changed in this scenario when any "New X" differs from its "Base X". */
function isChangedInScenario(row: ResultRow): boolean {
  for (const key of Object.keys(row)) {
    if (!key.startsWith("New ")) continue;
    const baseKey = `Base ${key.slice(4)}`;
    if (!(baseKey in row)) continue;
    const next = Number(row[key]);
    const base = Number(row[baseKey]);
    if (Number.isFinite(next) && Number.isFinite(base)) {
      if (Math.abs(next - base) > CHANGE_EPS) return true;
    } else if (String(row[key] ?? "") !== String(row[baseKey] ?? "")) {
      return true;
    }
  }
  return false;
}

function decodeSegmentOption(value: string): { assignmentKey: string; member: string } | null {
  if (!value || value === SEGMENT_ALL) return null;
  const tab = value.indexOf("\t");
  if (tab < 0) return null;
  return { assignmentKey: value.slice(0, tab), member: value.slice(tab + 1) };
}

export function RunnerPage() {
  const { session, setSession } = useSession();
  const pageActive = usePageActive();
  const [searchParams] = useSearchParams();
  const compareSectionRef = useRef<HTMLDivElement>(null);
  const suppressEditResetRef = useRef(false);
  /** Edit rows snapshot at the moment a live recalc was sent (for mid-flight merge). */
  const recalcSentRowsRef = useRef<ResultRow[] | null>(null);
  const recalc = useRecalculate();
  const applySeg = useApplySegmentation();
  const exportSession = useExportSession();

  const [baselineRows, setBaselineRows] = useState<ResultRow[]>([]);
  const [editRows, setEditRows] = useState<ResultRow[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_statusMsg, setStatusMsg] = useState("");
  /** flat = expandable SKUs under groups; grouped = non-expandable group rollups */
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");
  const [finMode, setFinMode] = useState<"NOS" | "TDC" | "MM$">("NOS");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [gridPage, setGridPage] = useState(0);

  const [groupType, setGroupType] = useState<string>("");
  const [groups, setGroups] = useState<any[]>([]);
  /** Design-sheet groups keyed by Group* type (Brand, Size, …). */
  const [groupsByType, setGroupsByType] = useState<Record<string, GroupRow[]>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<{id: string, msg: string, type: "warn" | "success"}[]>([]);
  const fetchGroups = useGroups();

  useEffect(() => {
    if (!session) return;
    const cloned = cloneRows(session.results);
    setBaselineRows(cloned);
    const wasSoftSync = suppressEditResetRef.current;
    if (wasSoftSync) {
      // Live recalc: trust server (incl. clamps); re-apply only edits typed during the request.
      suppressEditResetRef.current = false;
      const sent = recalcSentRowsRef.current;
      recalcSentRowsRef.current = null;
      setEditRows((prev) => {
        if (!sent) return cloned;
        const midFlight = computeGridChanges(sent, prev, session.editableColumns);
        return midFlight.length === 0 ? cloned : applyGridChangesLocally(cloned, midFlight);
      });
    } else {
      setEditRows(cloned);
    }
    setStatusMsg("");
    const gt = groupType || defaultGroupType(session.groupTypes);
    if (gt && gt !== groupType) {
      setGroupType(gt);
    }
    // Session payload groups are for the default type (Brand). Reload if another type is active.
    if (!gt || gt === defaultGroupType(session.groupTypes)) {
      setGroups(session.groups || []);
      const def = defaultGroupType(session.groupTypes);
      if (def) {
        setGroupsByType((prev) => ({ ...prev, [def]: session.groups || [] }));
      }
      // Don't reset expand/collapse on live recalc — only on full session loads.
      if (!wasSoftSync) {
        if (viewMode === "grouped") {
          setCollapsedGroups(allCollapsedNames(session.groups || []));
        } else {
          setCollapsedGroups(new Set());
        }
      }
    } else if (session.sessionId) {
      fetchGroups.mutate(
        { sessionId: session.sessionId, groupType: gt },
        {
          onSuccess: (data) => {
            setGroups(data.groups);
            if (!wasSoftSync) {
              setCollapsedGroups(viewMode === "grouped" ? allCollapsedNames(data.groups) : new Set());
            }
          },
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (searchParams.get("scenarios") && compareSectionRef.current) {
      compareSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.slug]);

  // Load every design-sheet group type (Brand, Size, …) for bulk filters.
  useEffect(() => {
    if (!session?.sessionId) return;
    let cancelled = false;
    const types = session.groupTypes ?? [];
    const def = defaultGroupType(types);
    setGroupsByType(def && session.groups?.length ? { [def]: session.groups } : {});
    Promise.all(
      types.map((gt) =>
        api
          .get<{ groups: GroupRow[] }>(
            `/api/sessions/${session.sessionId}/groups?group_type=${encodeURIComponent(gt)}`,
          )
          .then((data) => [gt, data.groups] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setGroupsByType(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.sessionId]);

  const showToast = (msg: string, type: "warn" | "success" = "success") => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter(t => t.id !== id));
    }, 5000);
  };

  const applyCollapseForMode = (mode: "flat" | "grouped", nextGroups: { Name: string }[]) => {
    setCollapsedGroups(mode === "grouped" ? allCollapsedNames(nextGroups) : new Set());
  };

  const loadGroups = (gt: string) => {
    setGroupType(gt);
    fetchGroups.mutate(
      { sessionId: session!.sessionId, groupType: gt },
      {
        onSuccess: (data) => {
          setGroups(data.groups);
          setGroupsByType((prev) => ({ ...prev, [gt]: data.groups }));
          applyCollapseForMode(viewMode, data.groups);
        },
      },
    );
  };

  const applySegmentBy = (value: string) => {
    if (!session) return;
    const decoded = decodeSegmentOption(value);
    applySeg.mutate(
      decoded
        ? {
            sessionId: session.sessionId,
            assignment_key: decoded.assignmentKey,
            member: decoded.member,
            filters: null,
          }
        : {
            sessionId: session.sessionId,
            assignment_key: null,
            member: null,
            filters: null,
          },
      {
        onSuccess: (payload) => {
          setSession(payload);
          showToast(
            decoded ? `Segment: ${decoded.member}` : "All respondents",
            "success",
          );
        },
        onError: (err) => showToast(err.message || "Segmentation failed", "warn"),
      },
    );
  };

  const setViewExpanded = () => {
    setViewMode("flat");
    setCollapsedGroups(new Set());
  };

  const setViewCollapsed = () => {
    setViewMode("grouped");
    setCollapsedGroups(allCollapsedNames(groups));
  };

  const toggleGroup = useCallback((name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const onCellChange = useCallback(
    (productName: string, column: string, value: CellValue) => {
      setEditRows((prev) => {
        const next = cloneRows(prev);
        const index = next.findIndex(r => r["Product Name"] === productName);
        if (index >= 0) {
          next[index] = { ...next[index], [column]: value };
        }
        return next;
      });
    },
    [],
  );

  const onIncludeSku = useCallback(
    (productName: string, groupName: string) => {
      onCellChange(productName, "Selected", true);
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        next.delete(groupName);
        return next;
      });
    },
    [onCellChange],
  );

  const priceColumn = useMemo(() => {
    const cols = session?.editableColumns ?? [];
    if (cols.includes("New Price")) return "New Price";
    return cols.find((c) => c.startsWith("New ")) ?? null;
  }, [session]);

  const applyBulkPriceChange = useCallback(
    (productNames: string[], pct: number) => {
      if (!priceColumn || productNames.length === 0) return;
      const baseColumn = priceColumn.startsWith("New ")
        ? `Base ${priceColumn.slice(4)}`
        : null;
      const names = new Set(productNames);
      setEditRows((prev) => {
        const next = cloneRows(prev);
        for (const row of next) {
          if (!names.has(String(row["Product Name"]))) continue;
          const baseVal =
            baseColumn && baseColumn in row
              ? Number(row[baseColumn])
              : Number(row[priceColumn]);
          if (!Number.isFinite(baseVal)) continue;
          row[priceColumn] = Math.round(baseVal * (1 + pct / 100) * 100) / 100;
        }
        return next;
      });
    },
    [priceColumn],
  );

  /** Product names flagged as own in the study product list (Company = 1). */
  const ownNames = useMemo(
    () => new Set(session?.companyProducts ?? []),
    [session?.companyProducts],
  );

  const isOwnProduct = useCallback(
    (productName: string) => ownNames.has(productName),
    [ownNames],
  );

  // Studies without Company flags hide the filter — never blank the grid for them.
  const ownerActive = ownerFilter !== "all" && ownNames.size > 0;

  const ownerRows = useMemo(() => {
    if (!ownerActive) return editRows;
    return editRows.filter((r) => {
      const own = isOwnProduct(String(r["Product Name"]));
      return ownerFilter === "own" ? own : !own;
    });
  }, [editRows, ownerActive, ownerFilter, isOwnProduct]);

  const normalizedSearch = searchQuery.trim();
  const searchActive = normalizedSearch.length > 0;

  const searchRows = useMemo(() => {
    const rows = !searchActive
      ? ownerRows
      : ownerRows.filter((r) =>
          rowMatchesSearch(String(r["Product Name"] ?? ""), normalizedSearch),
        );
    return [...rows].sort((a, b) => Number(b["B.Share"] ?? 0) - Number(a["B.Share"] ?? 0));
  }, [ownerRows, searchActive, normalizedSearch]);

  const useBrandPagination = Boolean(session?.groupTypes?.length && groups.length > 0);

  const brandSections = useMemo(() => {
    if (!useBrandPagination) return [];
    const collapseSet =
      viewMode === "grouped" ? allCollapsedNames(groups) : collapsedGroups;
    return buildBrandSections(searchRows, groups, collapseSet, ownNames, {
      normalizedSearch,
      hideEmptyGroups: ownerActive || searchActive,
      // Expandable view opens matches while searching; rollup stays collapsed.
      expandAll: viewMode === "flat" && searchActive,
    });
  }, [
    useBrandPagination,
    searchRows,
    groups,
    collapsedGroups,
    ownNames,
    normalizedSearch,
    ownerActive,
    searchActive,
    viewMode,
  ]);

  const brandPages = useMemo(() => {
    if (!useBrandPagination) return [];
    return paginateBrandSections(brandSections, GRID_ROWS_PER_PAGE);
  }, [useBrandPagination, brandSections]);

  const totalSkuCount = useBrandPagination
    ? searchRows.length
    : searchRows.filter((r) => r["Selected"] !== false).length;
  const totalBrandCount = brandSections.length;
  const pageCount = useBrandPagination
    ? Math.max(1, brandPages.length)
    : Math.max(1, Math.ceil(totalSkuCount / GRID_PAGE_SIZE));
  const safePage = Math.min(gridPage, pageCount - 1);

  const currentBrandSections = useBrandPagination ? (brandPages[safePage] ?? []) : [];
  const brandsBeforePage = brandPages.slice(0, safePage).reduce((n, p) => n + p.length, 0);
  const pageBrandStart = totalBrandCount === 0 ? 0 : brandsBeforePage + 1;
  const pageBrandEnd = brandsBeforePage + currentBrandSections.length;

  const pagedDisplayRows = useMemo(() => {
    if (useBrandPagination) {
      return flattenBrandSections(currentBrandSections);
    }
    const selectedRows = searchRows.filter((r) => r["Selected"] !== false);
    const pageStart = safePage * GRID_PAGE_SIZE;
    return selectedRows.slice(pageStart, pageStart + GRID_PAGE_SIZE);
  }, [useBrandPagination, currentBrandSections, searchRows, safePage]);

  const pageRowCount = useBrandPagination
    ? currentBrandSections.reduce((n, s) => n + visibleRowCount(s), 0)
    : pagedDisplayRows.length;

  const segmentationKey = useMemo(
    () => segmentationFilterKey(session?.segmentation),
    [session?.segmentation],
  );

  useEffect(() => {
    setGridPage(0);
  }, [searchQuery, ownerFilter, groupType, segmentationKey, viewMode]);

  useEffect(() => {
    if (gridPage > pageCount - 1) setGridPage(Math.max(0, pageCount - 1));
  }, [gridPage, pageCount]);

  /**
   * Cards report the company's own SKUs (Company flag in the study product list), so they
   * stay put when the grid's owner filter moves. Studies with no Company flags have nothing
   * to scope by, so they fall back to every SKU in the grid.
   */
  const kpiRows = useMemo(
    () =>
      ownNames.size > 0
        ? editRows.filter((r) => isOwnProduct(String(r["Product Name"])))
        : editRows,
    [editRows, ownNames, isOwnProduct],
  );

  const manufacturerSkuNames = useMemo(() => {
    if (ownNames.size > 0) return ownNames;
    return new Set(editRows.map((r) => String(r["Product Name"] ?? "")));
  }, [ownNames, editRows]);

  /** Brand groups for Trade Effect. Session groups stay on the default Brand type. */
  const tradeEffectBrands = useMemo(() => {
    const brandType = defaultGroupType(session?.groupTypes);
    const brandGroups =
      (brandType && groupsByType[brandType]) ||
      (session?.groups?.length ? session.groups : groups);
    if (!brandGroups?.length) return [];
    return brandGroups
      .map((g) => ({
        name: String(g.Name ?? ""),
        productNames: Array.isArray(g.productNames) ? g.productNames.map(String) : [],
      }))
      .filter((g) => g.name && g.productNames.length > 0);
  }, [session?.groupTypes, session?.groups, groupsByType, groups]);

  /** Own brand rollups for the Base vs Current chart filter (Brand groups containing Company SKUs). */
  const ownBrandsForCompare = useMemo(() => {
    if (ownNames.size === 0) return [];
    const brandType = defaultGroupType(session?.groupTypes);
    const brandGroups =
      (brandType && groupsByType[brandType]) ||
      (session?.groups?.length ? session.groups : groups);
    if (!brandGroups?.length) return [];

    return brandGroups
      .map((g) => {
        const names: string[] = Array.isArray(g.productNames) ? g.productNames : [];
        const skuNames = names.filter((n) => ownNames.has(n));
        const share = Number(g["B.Share"]);
        return {
          name: String(g.Name ?? ""),
          skuNames,
          share: Number.isFinite(share) ? share : -Infinity,
        };
      })
      .filter((b) => b.name && b.skuNames.length > 0)
      .sort((a, b) => {
        if (b.share !== a.share) return b.share - a.share;
        return a.name.localeCompare(b.name);
      })
      .map(({ name, skuNames }) => ({ name, skuNames }));
  }, [ownNames, session?.groupTypes, session?.groups, groupsByType, groups]);

  /** Aggregates for the summary cards, over whatever scenario the grid holds. */
  const kpis = useMemo(() => {
    let baseShare = 0;
    let newShare = 0;
    let revenue = 0;
    let baseRevenue = 0;
    let margin = 0;
    let changed = 0;

    for (const row of kpiRows) {
      const base = Number(row["B.Share"]);
      const next = Number(row["N.Share"]);
      if (Number.isFinite(base)) baseShare += base;
      if (Number.isFinite(next)) newShare += next;

      const rev = Number(row["Revenue"]);
      const rIndex = Number(row["R.Index"]);
      if (Number.isFinite(rev)) {
        revenue += rev;
        // R.Index is Revenue / base revenue, so it recovers the base leg per SKU.
        if (Number.isFinite(rIndex) && rIndex > 0) baseRevenue += rev / rIndex;
      }

      const mm = Number(row["MM$"]);
      if (Number.isFinite(mm)) margin += mm;

      if (isChangedInScenario(row)) changed += 1;
    }

    return {
      volumeIndex: baseShare > 0 ? (newShare / baseShare) * 100 : null,
      valueIndex: baseRevenue > 0 ? (revenue / baseRevenue) * 100 : null,
      marginPct: revenue > 0 ? (margin / revenue) * 100 : null,
      changed,
    };
  }, [kpiRows]);

  const runRecalc = useCallback(() => {
    if (!session) return;
    const changes = readyGridChanges(
      computeGridChanges(baselineRows, editRows, session.editableColumns),
    );
    if (changes.length === 0) return;

    recalcSentRowsRef.current = editRows;
    recalc.mutate(
      { sessionId: session.sessionId, changes },
      {
        onSuccess: (payload) => {
          // Soft-merge in session effect so mid-flight typing is not wiped.
          suppressEditResetRef.current = true;
          setSession(payload);

          if (payload.warnings && payload.warnings.length > 0) {
            payload.warnings.forEach((w: string) => showToast(w, "warn"));
          }
        },
        onError: (err) => {
          recalcSentRowsRef.current = null;
          showToast(err.message || "Recalculate failed", "warn");
        },
      },
    );
  },
  // showToast is stable enough for this page; session/rows drive the payload
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [session, baselineRows, editRows, recalc, setSession]);

  // Live grid: debounce recalculate after edits so shares update without a button press.
  useEffect(() => {
    if (!session || !pageActive) return;
    const ready = readyGridChanges(
      computeGridChanges(baselineRows, editRows, session.editableColumns),
    );
    if (ready.length === 0) return;
    if (recalc.isPending) return;

    const timer = window.setTimeout(() => {
      runRecalc();
    }, LIVE_RECALC_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [session, pageActive, baselineRows, editRows, recalc.isPending, runRecalc]);

  if (!session) {
    return <Navigate to="/data-hub" replace />;
  }

  const scrollToCompare = () => {
    compareSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const pendingChanges = session?.editableColumns
    ? computeGridChanges(baselineRows, editRows, session.editableColumns).length
    : 0;

  const seg = session.segmentation;
  const hasGroups = Boolean(session.groupTypes?.length);
  const hasSegments = Boolean(seg?.dimensions?.length);
  // No Company flags in the study product list → nothing to split on, so hide the filter.
  const hasOwnFlags = ownNames.size > 0;
  const activeFilters = seg?.activeFilters ?? (seg?.active ? [seg.active] : []);
  const segmentSelectValue =
    activeFilters.length === 1
      ? encodeSegmentOption(activeFilters[0].assignmentKey, activeFilters[0].member)
      : SEGMENT_ALL;

  const scenarioLabel = session.scenarioName || "Base Scenario";
  const compareScenarioLabel = scenarioLabel === "Base Scenario" ? "Current" : scenarioLabel;
  const manufacturerLabel = session.study.companyName?.trim() || "Manufacturer";
  const kpiScopeWord = hasOwnFlags ? "own SKUs" : "all SKUs";
  const kpiScopeLabel = [
    hasOwnFlags ? session.study.companyName || kpiScopeWord : kpiScopeWord,
    ...activeFilters.map((f) => f.member),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <TradeEffectPanel
        slug={session.slug}
        brandGroups={tradeEffectBrands}
        ownSkuNames={ownNames}
      />
      <ScenarioManagerBar
        pendingChanges={pendingChanges}
        onCompare={scrollToCompare}
        onToast={showToast}
        allRows={baselineRows}
        rows={editRows}
        priceColumn={priceColumn}
        groupsByType={groupsByType}
        onBulkApply={applyBulkPriceChange}
      />

      <div className="grid-area">
        <div className="grid-wrap grid-wrap-paginated runner-sku-grid">
          <div className="grid-toolbar">
            <div className="grid-toolbar-head">
              <div className="grid-toolbar-heading">
                <h3 className="grid-toolbar-title">SKU price points</h3>
                <p className="grid-toolbar-sub">
                  {viewMode === "grouped"
                    ? "Group-level totals only — switch to expandable view to edit SKU price points"
                    : "Edit a price point directly for fine control, or use bulk actions above for larger groups"}
                </p>
              </div>
              <div className="grid-toolbar-actions">
                {hasGroups ? (
                  <div className="view-toggle view-toggle-icons" role="group" aria-label="Row layout">
                    <button
                      type="button"
                      className={viewMode === "flat" ? "active" : ""}
                      onClick={setViewExpanded}
                      title="Expandable — show SKUs under each group"
                      aria-label="Expandable view"
                      aria-pressed={viewMode === "flat"}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                        <path fill="currentColor" d="M2 3h12v1.5H2V3zm0 4.25h12v1.5H2v-1.5zM2 11.5h12V13H2v-1.5z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={viewMode === "grouped" ? "active" : ""}
                      onClick={setViewCollapsed}
                      title="Rolled up — group totals only (not expandable)"
                      aria-label="Rolled up view"
                      aria-pressed={viewMode === "grouped"}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M2 3h7v1.5H2V3zm3 4.25h9v1.5H5v-1.5zM5 11.5h9V13H5v-1.5zM2 7.25h1.5v5.25H2V7.25z"
                        />
                      </svg>
                    </button>
                  </div>
                ) : null}

                {session.study.financial && (
                  <div className="view-toggle">
                    <div className={finMode === "NOS" ? "active" : ""} onClick={() => setFinMode("NOS")}>NOS</div>
                    <div className={finMode === "TDC" ? "active" : ""} onClick={() => setFinMode("TDC")}>TDC</div>
                    <div className={finMode === "MM$" ? "active" : ""} onClick={() => setFinMode("MM$")}>MM$</div>
                  </div>
                )}

                <SaveScenarioButton
                  buttonClassName="btn-primary"
                  label="Save as scenario"
                  onToast={showToast}
                />

                <AppSelect
                  className="export-app-select"
                  ariaLabel="Export"
                  value=""
                  trigger={<span className="export-icon-glyph" aria-hidden="true">⬇</span>}
                  items={[
                    { value: "csv", label: "CSV" },
                    { value: "xlsx", label: "Excel" },
                  ]}
                  onChange={(format) => {
                    if (format !== "csv" && format !== "xlsx") return;
                    exportSession.mutate({
                      sessionId: session.sessionId,
                      format,
                      filename: `${session.study.studyName}_results.${format}`,
                    });
                  }}
                />
                <SettingsPopover />
              </div>
            </div>

            <div className="grid-field-row">
              <label className="grid-field grid-field-wide">
                <span className="grid-field-label">Search</span>
                <input
                  className="grid-field-input"
                  type="text"
                  placeholder="Search brand, format, pack…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </label>

              {hasOwnFlags ? (
                <label className="grid-field">
                  <span className="grid-field-label">Owner</span>
                  <AppSelect
                    ariaLabel="Owner"
                    value={ownerFilter}
                    onChange={(value) => setOwnerFilter(value as OwnerFilter)}
                    items={[
                      { value: "all", label: "All SKUs" },
                      { value: "own", label: "Own only" },
                      { value: "comp", label: "Competitor only" },
                    ]}
                  />
                </label>
              ) : null}

              {hasGroups ? (
                <label className="grid-field">
                  <span className="grid-field-label">Group by</span>
                  <AppSelect
                    ariaLabel="Group by"
                    value={groupType}
                    onChange={loadGroups}
                    items={session.groupTypes.map((gt) => ({ value: gt, label: gt }))}
                  />
                </label>
              ) : null}

              {hasSegments ? (
                <label className="grid-field">
                  <span className="grid-field-label">Segment by</span>
                  <AppSelect
                    ariaLabel="Segment by"
                    value={segmentSelectValue}
                    disabled={applySeg.isPending}
                    onChange={applySegmentBy}
                    items={[{ value: SEGMENT_ALL, label: "All" }]}
                    groups={seg.dimensions.flatMap((d) => {
                      const members = seg.membersByKey[d.assignmentKey] ?? [];
                      if (members.length === 0) return [];
                      return [
                        {
                          label: d.label,
                          items: members.map((m) => ({
                            value: encodeSegmentOption(d.assignmentKey, m),
                            label: m,
                          })),
                        },
                      ];
                    })}
                  />
                </label>
              ) : null}
            </div>
          </div>
          <div className="grid-table-body">
            <ResultsGrid
              columns={session.columns}
              rows={pagedDisplayRows}
              editableColumns={session.editableColumns}
              discreteAttributeLevels={session.discreteAttributeLevels}
              mode="editable"
              viewMode={useBrandPagination ? viewMode : "flat"}
              finMode={session.study.financial ? finMode : undefined}
              scrollable={false}
              onCellChange={onCellChange}
              onIncludeSku={viewMode === "flat" ? onIncludeSku : undefined}
              onToggleGroup={viewMode === "flat" ? toggleGroup : undefined}
            />
          </div>
          <div className="grid-pager">
            <span className="grid-pager-count">
              {useBrandPagination
                ? `${pageBrandStart}–${pageBrandEnd} of ${totalBrandCount} brands · ${pageRowCount} rows on this page`
                : `${safePage * GRID_PAGE_SIZE + 1}–${Math.min((safePage + 1) * GRID_PAGE_SIZE, totalSkuCount)} of ${totalSkuCount} SKUs`}
            </span>
            <div className="grid-pager-actions">
              <button
                type="button"
                className="btn-secondary grid-pager-btn"
                onClick={() => setGridPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
              >
                ← Previous
              </button>
              <span className="grid-pager-page">
                Page {safePage + 1} of {pageCount}
              </span>
              <button
                type="button"
                className="btn-secondary grid-pager-btn"
                onClick={() => setGridPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="runner-kpi-row">
        <div className="runner-kpi">
          <div className="runner-kpi-label">Volume index</div>
          <div className="runner-kpi-value">
            {kpis.volumeIndex == null ? "—" : fmtNumber(kpis.volumeIndex, 1)}
          </div>
          <div className="runner-kpi-note pos">
            {scenarioLabel} · {kpiScopeLabel}
          </div>
        </div>
        <div className="runner-kpi">
          <div className="runner-kpi-label">Value index</div>
          <div className="runner-kpi-value">
            {kpis.valueIndex == null ? "—" : fmtNumber(kpis.valueIndex, 1)}
          </div>
          <div className="runner-kpi-note pos">vs. base = 100</div>
        </div>
        {session.study.financial ? (
          <div className="runner-kpi">
            <div className="runner-kpi-label">Contribution margin</div>
            <div className="runner-kpi-value">
              {kpis.marginPct == null ? "—" : `${fmtNumber(kpis.marginPct, 1)}%`}
            </div>
            <div className="runner-kpi-note pos">CM%, {kpiScopeWord}</div>
            <div className="runner-kpi-formula">Σ MM$ ÷ Σ revenue · MM$ = revenue − NOS − TDC</div>
          </div>
        ) : null}
        <div className="runner-kpi">
          <div className="runner-kpi-label">SKUs changed</div>
          <div className="runner-kpi-value">{kpis.changed}</div>
          <div className="runner-kpi-note warn">in this scenario, {kpiScopeWord}</div>
        </div>
      </div>

      <ManufacturerScenarioCompare
        rows={editRows}
        manufacturerSkuNames={manufacturerSkuNames}
        manufacturerLabel={manufacturerLabel}
        currentScenarioLabel={compareScenarioLabel}
        ownBrands={ownBrandsForCompare}
      />

      <div ref={compareSectionRef}>
        <ScenarioCompareSection
          slug={session.slug}
          companyProducts={session.companyProducts}
          companyName={session.study.companyName}
          ownBrands={ownBrandsForCompare}
        />
      </div>

      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span className="toast-msg">{t.msg}</span>
            <button className="toast-close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
