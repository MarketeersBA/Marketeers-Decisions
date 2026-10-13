import { useEffect, useMemo, useRef, useState } from "react";

import { useOptimizerContext, runOptimizerJob, useOptimizerBounds } from "../api/hooks";
import type { ResultRow } from "../api/types";
import { buildOptimizerSetup, type OptimizerRunResult, type RunOptimizerRequest } from "../api/optimizer_types";
import {
  filterStandaloneOfferSkusFromMap,
  isOfferTypeGroupType,
} from "../components/assortment/assortmentFilterUtils";
import { useStudyDisplay } from "../lib/studyDisplay";
import { useSession } from "../stores/sessionStore";

import "./pages.css";
import "./optimizer.css";
import "./price-pack-architecture.css";

type Objective = "ValueShare" | "Share" | "Margin";

function objectiveToBackend(objective: Objective): string {
  if (objective === "Margin") return "margin";
  if (objective === "Share") return "volume_share";
  return "value_share";
}

/** Config shape ready for a future optimizer API call. */
export interface PpaLadderConfig {
  primaryGrouping: string;
  classOrder: string[];
  focusBrand: string;
  minClassPremiumPct: number;
  minUnitSavingPct: number | null;
  maxUnitSavingPct: number | null;
  referenceByClass: Record<string, string>;
}

interface SkuMetrics {
  name: string;
  price: number;
  size: number | null;
  unitPrice: number | null;
  volumeShare: number;
}

interface ClassLadderPreview {
  className: string;
  skus: SkuMetrics[];
  referenceSku: string | null;
}

function fmt(n: number | null | undefined, d = 1): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numFromRow(row: ResultRow | undefined, keys: string[]): number | null {
  if (!row) return null;
  for (const key of keys) {
    const raw = Number(row[key]);
    if (Number.isFinite(raw) && raw > 0) return raw;
  }
  return null;
}

function resultRowPrice(row: ResultRow | undefined): number {
  return numFromRow(row, ["New Price", "Base Price", "Price"]) ?? 0;
}

function resultRowSize(row: ResultRow | undefined): number | null {
  return numFromRow(row, ["New Size", "Base Size", "Size"]);
}

function resultRowVolumeShare(row: ResultRow | undefined): number {
  if (!row) return 0;
  for (const key of ["N.Share", "New Vol Share", "Vol Share", "Volume Share", "Volume", "New Vol"]) {
    const raw = Number(row[key]);
    if (Number.isFinite(raw) && raw >= 0) return raw;
  }
  return 0;
}

function isRowSelected(row: ResultRow): boolean {
  const selected = row["Selected"];
  return selected !== false && selected !== 0;
}

function bucketPriceForRow(row: ResultRow, useUnitPrice: boolean): number | null {
  const packPrice = resultRowPrice(row);
  if (packPrice <= 0) return null;
  if (!useUnitPrice) return packPrice;
  const size = resultRowSize(row);
  if (size == null || size <= 0) return null;
  return packPrice / size;
}

function studyUsesUnitPrice(rows: ResultRow[]): boolean {
  return rows.some((row) => resultRowSize(row) != null);
}

/** Move item at `fromIndex` to 1-based rank (clamped). Other items shift to fill the gap. */
function moveToRank(list: string[], fromIndex: number, rank: number): string[] {
  if (fromIndex < 0 || fromIndex >= list.length) return list;
  const target = Math.max(1, Math.min(list.length, Math.round(rank))) - 1;
  if (target === fromIndex) return list;
  const copy = [...list];
  const [item] = copy.splice(fromIndex, 1);
  copy.splice(target, 0, item);
  return copy;
}

function ClassRankInput({
  rank,
  max,
  label,
  onCommit,
  disabled,
}: {
  rank: number;
  max: number;
  label: string;
  onCommit: (rank: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(rank));

  useEffect(() => {
    setDraft(String(rank));
  }, [rank]);

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(rank));
      return;
    }
    onCommit(parsed);
  };

  return (
    <input
      type="number"
      className="ppa-class-rank-input"
      min={1}
      max={max}
      step={1}
      value={draft}
      disabled={disabled}
      aria-label={`Rank for ${label}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(String(rank));
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Primary ladder dimensions — Size and Offer Type are never primary. */
function primaryGroupTypes(groupTypes: string[]): string[] {
  return groupTypes.filter((t) => !/^size$/i.test(t) && !isOfferTypeGroupType(t));
}

function initialPrimary(groupTypes: string[]): string {
  const primary = primaryGroupTypes(groupTypes);
  return (
    primary.find((t) => /oil type/i.test(t)) ??
    primary.find((t) => /format/i.test(t)) ??
    primary.find((t) => /tier/i.test(t)) ??
    primary[0] ??
    ""
  );
}

function brandGroupType(groupTypes: string[]): string {
  return groupTypes.find((t) => /^brand$/i.test(t)) ?? groupTypes.find((t) => /brand/i.test(t)) ?? "";
}

function defaultReferenceSku(skus: SkuMetrics[]): string {
  if (skus.length === 0) return "";
  // Pick the SKU with the highest volume share as the default reference
  return skus.reduce((best, s) => (s.volumeShare > best.volumeShare ? s : best)).name;
}

function isSkuIncluded(includedBySku: Record<string, boolean>, skuName: string): boolean {
  return includedBySku[skuName] !== false;
}

function optimizedPackPrice(
  skuName: string,
  optResult: OptimizerRunResult | null,
): number | null {
  if (!optResult) return null;
  const price = optResult.prices[skuName];
  if (price != null) return price;
  return optResult.ppa_ladder_rows?.find((r) => r.sku === skuName)?.price ?? null;
}

function sortSkusBySize(skus: SkuMetrics[]): SkuMetrics[] {
  return [...skus].sort((a, b) => {
    const sa = a.size ?? Number.POSITIVE_INFINITY;
    const sb = b.size ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });
}

const TIER_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

function tierColor(classIdx: number): string {
  return TIER_COLORS[classIdx % TIER_COLORS.length];
}

function tierRowBackground(classIdx: number): string {
  const hex = tierColor(classIdx).replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.16)`;
}

export function PricePackArchitecturePage() {
  const { session } = useSession();
  const display = useStudyDisplay();
  const slug = session?.slug ?? "";
  const { data: optContext, isLoading: contextLoading } = useOptimizerContext(slug, {
    enabled: Boolean(slug),
  });

  const [autoTierCount, setAutoTierCount] = useState(5);
  const [bucketPriceView, setBucketPriceView] = useState<"pack" | "unit">("pack");
  /** "" = all company SKUs count as own brand; otherwise only SKUs in this brand. */
  const [bucketBrandFilter, setBucketBrandFilter] = useState("");
  const [primaryGrouping, setPrimaryGrouping] = useState("");
  /** Per primary group-type: class names ordered higher → lower on the ladder. */
  const [classOrderByGrouping, setClassOrderByGrouping] = useState<Record<string, string[]>>({});
  const [focusBrand, setFocusBrand] = useState("");
  const [objective, setObjective] = useState<Objective>("ValueShare");
  const [marginFloor, setMarginFloor] = useState(34);
  const [shareLossLimit, setShareLossLimit] = useState(10);
  const [minClassPremiumPct, setMinClassPremiumPct] = useState<number | "">(0);
  const [minUnitSavingPct, setMinUnitSavingPct] = useState<number | "">(0);
  const [maxUnitSavingPct, setMaxUnitSavingPct] = useState<number | "">("");
  const [showPctConstraints, setShowPctConstraints] = useState(false);
  const [fastOptimize, setFastOptimize] = useState(true);
  /** className → included */
  const [includedByClass, setIncludedByClass] = useState<Record<string, boolean>>({});
  /** sku name → included in optimization */
  const [includedBySku, setIncludedBySku] = useState<Record<string, boolean>>({});
  /** className → reference SKU name */
  const [referenceByClass, setReferenceByClass] = useState<Record<string, string>>({});
  const didInitGrouping = useRef(false);
  const didInitBrand = useRef(false);
  const didInitIncludes = useRef<string>("");

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);
  const [optResult, setOptResult] = useState<OptimizerRunResult | null>(null);
  const abortController = useRef<AbortController | null>(null);

  const groupTypes = optContext?.group_types?.length
    ? optContext.group_types
    : (session?.groupTypes ?? []);
  const primaryOptions = useMemo(() => primaryGroupTypes(groupTypes), [groupTypes]);
  const brandType = useMemo(() => brandGroupType(groupTypes), [groupTypes]);

  const groupsByTypeMap = useMemo(
    () => optContext?.groups_by_type ?? {},
    [optContext?.groups_by_type],
  );

  const ownSet = useMemo(
    () => new Set(session?.companyProducts ?? []),
    [session?.companyProducts],
  );

  const setup = useMemo(
    () => buildOptimizerSetup(session?.segmentation, null),
    [session?.segmentation],
  );

  const { data: skuBounds = [] } = useOptimizerBounds(
    slug,
    brandType || undefined,
    focusBrand || undefined,
    setup,
    { enabled: Boolean(slug && brandType && focusBrand) },
  );

  const resultsByName = useMemo(() => {
    const map = new Map<string, ResultRow>();
    for (const row of session?.results ?? []) {
      const name = String(row["Product Name"] ?? "");
      if (name) map.set(name, row);
    }
    return map;
  }, [session?.results]);

  const ownBrands = useMemo(() => {
    const brandMap = brandType ? (optContext?.groups_by_type?.[brandType] ?? {}) : {};
    const names = Object.keys(brandMap);
    if (names.length === 0) return [] as string[];
    if (ownSet.size === 0) return names;
    return names.filter((b) => (brandMap[b] ?? []).some((sku) => ownSet.has(sku)));
  }, [optContext, brandType, ownSet]);

  const focusBrandSkus = useMemo(() => {
    if (!focusBrand || !brandType) return [] as string[];
    const skus = groupsByTypeMap[brandType]?.[focusBrand] ?? [];
    const owned = ownSet.size === 0 ? skus : skus.filter((s) => ownSet.has(s));
    return filterStandaloneOfferSkusFromMap(owned, groupsByTypeMap);
  }, [groupsByTypeMap, brandType, focusBrand, ownSet]);

  const focusBrandSkuSet = useMemo(() => new Set(focusBrandSkus), [focusBrandSkus]);

  const classNamesForPrimary = useMemo(() => {
    if (!primaryGrouping) return [] as string[];
    const fromContext = optContext?.groups_by_type?.[primaryGrouping];
    if (fromContext) return Object.keys(fromContext);
    if (session?.groups?.length && /^brand$/i.test(primaryGrouping)) {
      return session.groups.map((g) => String(g.Name));
    }
    return [] as string[];
  }, [primaryGrouping, optContext, session?.groups]);

  const skusForClass = useMemo(() => {
    const map: Record<string, SkuMetrics[]> = {};
    if (!primaryGrouping) return map;
    const groups = optContext?.groups_by_type?.[primaryGrouping] ?? {};
    for (const className of classNamesForPrimary) {
      const members = filterStandaloneOfferSkusFromMap(
        (groups[className] ?? []).filter((sku) => focusBrandSkuSet.has(sku)),
        groupsByTypeMap,
      );
      const metrics = members.map((name) => {
        const row = resultsByName.get(name);
        const price = resultRowPrice(row);
        const size = resultRowSize(row);
        const unitPrice = size && size > 0 && price > 0 ? price / size : null;
        const volumeShare = numFromRow(row, ["N.Share", "New Vol Share", "Vol Share", "Volume Share"]) ?? 0;
        return { name, price, size, unitPrice, volumeShare };
      });
      map[className] = sortSkusBySize(metrics);
    }
    return map;
  }, [primaryGrouping, optContext, classNamesForPrimary, focusBrandSkuSet, groupsByTypeMap, resultsByName]);

  // Reset init flags when study changes.
  useEffect(() => {
    didInitGrouping.current = false;
    didInitBrand.current = false;
    didInitIncludes.current = "";
  }, [slug]);

  useEffect(() => {
    if (didInitGrouping.current || primaryOptions.length === 0) return;
    didInitGrouping.current = true;
    setPrimaryGrouping(initialPrimary(groupTypes));
  }, [groupTypes, primaryOptions, slug]);

  useEffect(() => {
    if (!primaryGrouping) return;
    if (!primaryOptions.includes(primaryGrouping)) {
      setPrimaryGrouping(initialPrimary(groupTypes));
    }
  }, [primaryGrouping, primaryOptions, groupTypes]);

  useEffect(() => {
    if (didInitBrand.current || ownBrands.length === 0) return;
    didInitBrand.current = true;
    setFocusBrand(ownBrands[0]);
  }, [ownBrands, slug]);

  useEffect(() => {
    if (!focusBrand) return;
    if (ownBrands.length > 0 && !ownBrands.includes(focusBrand)) {
      setFocusBrand(ownBrands[0]);
    }
  }, [focusBrand, ownBrands]);

  useEffect(() => {
    if (!studyUsesUnitPrice(session?.results ?? [])) {
      setBucketPriceView("pack");
    }
  }, [session?.results]);

  // Merge class names into order list (preserve user reordering).
  useEffect(() => {
    if (!primaryGrouping || classNamesForPrimary.length === 0) return;
    setClassOrderByGrouping((prev) => {
      const existing = prev[primaryGrouping] ?? [];
      const kept = existing.filter((n) => classNamesForPrimary.includes(n));
      const missing = classNamesForPrimary.filter((n) => !kept.includes(n));
      const next = [...kept, ...missing];
      if (existing.length === next.length && existing.every((n, i) => n === next[i])) {
        return prev;
      }
      return { ...prev, [primaryGrouping]: next };
    });
  }, [primaryGrouping, classNamesForPrimary]);

  // Default include: classes with ≥1 focus-brand SKU. Re-init when brand/grouping changes.
  useEffect(() => {
    if (!primaryGrouping || !focusBrand || classNamesForPrimary.length === 0) return;
    if (contextLoading) return;
    const key = `${slug}|${primaryGrouping}|${focusBrand}`;
    if (didInitIncludes.current === key) return;
    didInitIncludes.current = key;
    const nextInc: Record<string, boolean> = {};
    const nextRef: Record<string, string> = {};
    for (const className of classNamesForPrimary) {
      const skus = skusForClass[className] ?? [];
      nextInc[className] = skus.length > 0;
      nextRef[className] = defaultReferenceSku(skus);
    }
    setIncludedByClass(nextInc);
    setReferenceByClass(nextRef);
    const nextSkuInc: Record<string, boolean> = {};
    for (const className of classNamesForPrimary) {
      for (const sku of skusForClass[className] ?? []) {
        nextSkuInc[sku.name] = true;
      }
    }
    setIncludedBySku(nextSkuInc);
  }, [
    slug,
    primaryGrouping,
    focusBrand,
    classNamesForPrimary,
    skusForClass,
    contextLoading,
  ]);

  // Keep references valid when SKU lists or inclusion change.
  useEffect(() => {
    setReferenceByClass((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const className of classNamesForPrimary) {
        const skus = (skusForClass[className] ?? []).filter((s) =>
          isSkuIncluded(includedBySku, s.name),
        );
        const names = new Set(skus.map((s) => s.name));
        if (!next[className] || !names.has(next[className])) {
          const def = defaultReferenceSku(skus);
          if (next[className] !== def) {
            next[className] = def;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [classNamesForPrimary, skusForClass, includedBySku]);

  // Add new SKUs as included when the ladder list grows (preserve user exclusions).
  useEffect(() => {
    setIncludedBySku((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const className of classNamesForPrimary) {
        for (const sku of skusForClass[className] ?? []) {
          next[sku.name] = prev[sku.name] ?? true;
          if (!(sku.name in prev)) changed = true;
        }
      }
      if (Object.keys(prev).length !== Object.keys(next).length) changed = true;
      return changed ? next : prev;
    });
  }, [classNamesForPrimary, skusForClass]);

  const includedSkuCount = useMemo(
    () => focusBrandSkus.filter((sku) => isSkuIncluded(includedBySku, sku)).length,
    [focusBrandSkus, includedBySku],
  );

  const setSkuIncluded = (className: string, skuName: string, included: boolean) => {
    setIncludedBySku((prev) => {
      const next = { ...prev, [skuName]: included };
      if (!included) {
        setReferenceByClass((refPrev) => {
          if (refPrev[className] !== skuName) return refPrev;
          const remaining = (skusForClass[className] ?? []).filter(
            (s) => s.name !== skuName && isSkuIncluded(next, s.name),
          );
          return { ...refPrev, [className]: defaultReferenceSku(remaining) };
        });
      }
      return next;
    });
  };

  const classOrder = classOrderByGrouping[primaryGrouping] ?? [];
  const classesLoading = Boolean(slug) && contextLoading && classNamesForPrimary.length === 0;

  const includedClassOrder = useMemo(
    () => classOrder.filter((c) => includedByClass[c]),
    [classOrder, includedByClass],
  );

  /** Classes that have at least one focus-brand SKU — empty groups stay out of the ladder UI. */
  const classesWithSkus = useMemo(
    () => classOrder.filter((name) => (skusForClass[name] ?? []).length > 0),
    [classOrder, skusForClass],
  );

  const ladderPreview = useMemo((): ClassLadderPreview[] => {
    return includedClassOrder.map((className) => ({
      className,
      skus: skusForClass[className] ?? [],
      referenceSku: referenceByClass[className] || null,
    }));
  }, [includedClassOrder, skusForClass, referenceByClass]);

  const ppaDiagnosticRows = useMemo(() => {
    if (!optResult) return [] as Array<{
      sku: string;
      size: number | null;
      price: number;
      unit_price: number | null;
      saving_vs_prev: number | null;
      tier_premium_vs_low: number | null;
      status: string;
      detail: string;
      is_tier_link?: boolean;
      classIdx: number;
    }>;
    const ladderBySku = new Map(
      (optResult.ppa_ladder_rows ?? []).map((r) => [r.sku, r]),
    );
    const rows: Array<{
      sku: string;
      size: number | null;
      price: number;
      unit_price: number | null;
      saving_vs_prev: number | null;
      tier_premium_vs_low: number | null;
      status: string;
      detail: string;
      is_tier_link?: boolean;
      classIdx: number;
    }> = [];
    for (let classIdx = 0; classIdx < ladderPreview.length; classIdx++) {
      const cls = ladderPreview[classIdx];
      for (const sku of cls.skus) {
        if (!isSkuIncluded(includedBySku, sku.name)) continue;
        const ladderRow = ladderBySku.get(sku.name);
        const packPrice = optimizedPackPrice(sku.name, optResult);
        if (packPrice == null) continue;
        const unitPrice =
          sku.size != null && sku.size > 0 ? packPrice / sku.size : null;
        rows.push({
          sku: sku.name,
          size: sku.size,
          price: packPrice,
          unit_price: unitPrice,
          saving_vs_prev: ladderRow?.saving_vs_prev ?? null,
          tier_premium_vs_low:
            ladderRow?.tier_premium_vs_low ?? ladderRow?.premium_vs_low ?? null,
          status: ladderRow?.status ?? "ok",
          detail: ladderRow?.detail ?? "optimized",
          is_tier_link: ladderRow?.is_tier_link,
          classIdx,
        });
      }
    }
    return rows;
  }, [optResult, ladderPreview, includedBySku]);

  /** Config object for a future optimizer API (kept in sync with UI). */
  const ppaConfig: PpaLadderConfig = useMemo(
    () => ({
      primaryGrouping,
      classOrder: includedClassOrder,
      focusBrand,
      minClassPremiumPct: minClassPremiumPct === "" ? 0 : Number(minClassPremiumPct),
      minUnitSavingPct: minUnitSavingPct === "" ? null : Number(minUnitSavingPct),
      maxUnitSavingPct: maxUnitSavingPct === "" ? null : Number(maxUnitSavingPct),
      referenceByClass: Object.fromEntries(
        includedClassOrder.map((c) => [c, referenceByClass[c] ?? ""]),
      ),
    }),
    [
      primaryGrouping,
      includedClassOrder,
      focusBrand,
      minClassPremiumPct,
      minUnitSavingPct,
      maxUnitSavingPct,
      referenceByClass,
    ],
  );
  void ppaConfig;

  const bucketOwnSkuSet = useMemo(() => {
    if (!bucketBrandFilter || !brandType) return ownSet;
    const brandSkus = groupsByTypeMap[brandType]?.[bucketBrandFilter] ?? [];
    return new Set(brandSkus.filter((sku) => ownSet.has(sku)));
  }, [bucketBrandFilter, brandType, groupsByTypeMap, ownSet]);

  const bucketData = useMemo(() => {
    const offerTypeFilteredRows = (dataRows: ResultRow[]) => {
      const names = dataRows
        .map((row) => String(row["Product Name"] ?? ""))
        .filter((name) => name.length > 0);
      const allowed = new Set(filterStandaloneOfferSkusFromMap(names, groupsByTypeMap));
      return dataRows.filter((row) => allowed.has(String(row["Product Name"] ?? "")));
    };

    type BucketRow = { label: string; ownPct: number; compPct: number };

    const rows = offerTypeFilteredRows((session?.results ?? []).filter(isRowSelected));
    const hasUnitPriceData = studyUsesUnitPrice(rows);

    const buildView = (useUnitPrice: boolean): { buckets: BucketRow[]; hasData: boolean } => {
      let bounds: number[] = [];
      let minPrice = Infinity;
      let maxPrice = -Infinity;

      for (const row of rows) {
        const vol = resultRowVolumeShare(row);
        if (vol <= 0) continue;
        const price = bucketPriceForRow(row, useUnitPrice);
        if (price == null) continue;
        minPrice = Math.min(minPrice, price);
        maxPrice = Math.max(maxPrice, price);
      }

      if (minPrice < Infinity && maxPrice > minPrice) {
        const range = maxPrice - minPrice;
        const step = range / autoTierCount;
        for (let i = 1; i < autoTierCount; i++) {
          bounds.push(minPrice + step * i);
        }
      } else if (minPrice < Infinity) {
        bounds = [minPrice];
      }

      const buckets = Array.from({ length: Math.max(bounds.length, 0) + 1 }, () => ({
        ownVol: 0,
        compVol: 0,
      }));

      for (const row of rows) {
        if (!isRowSelected(row)) continue;

        const vol = resultRowVolumeShare(row);
        if (vol <= 0) continue;

        const price = bucketPriceForRow(row, useUnitPrice);
        if (price == null) continue;

        const isOwn = bucketOwnSkuSet.has(String(row["Product Name"] ?? ""));
        let bIdx = bounds.findIndex((b) => price < b);
        if (bIdx === -1) bIdx = bounds.length;

        if (isOwn) buckets[bIdx].ownVol += vol;
        else buckets[bIdx].compVol += vol;
      }

      const bucketRows = buckets.map((b, i) => {
        let label = "";
        if (bounds.length === 0) {
          label = "All prices";
        } else if (i === 0) {
          label = `< ${useUnitPrice ? display.currencySymbol : ""}${fmtMoney(bounds[0])}`;
        } else if (i === bounds.length) {
          label = `> ${useUnitPrice ? display.currencySymbol : ""}${fmtMoney(bounds[bounds.length - 1])}`;
        } else {
          label = `${useUnitPrice ? display.currencySymbol : ""}${fmtMoney(bounds[i - 1])}–${fmtMoney(bounds[i])}`;
        }

        const bandVol = b.ownVol + b.compVol;
        return {
          label,
          ownPct: bandVol > 0 ? (b.ownVol / bandVol) * 100 : 0,
          compPct: bandVol > 0 ? (b.compVol / bandVol) * 100 : 0,
        };
      });

      const hasData = bucketRows.some((b) => b.ownPct + b.compPct > 0);
      return { buckets: bucketRows, hasData };
    };

    const pack = buildView(false);
    const unit = hasUnitPriceData ? buildView(true) : null;
    const active =
      bucketPriceView === "unit" && unit ? unit : pack;
    return {
      pack,
      unit,
      buckets: active.buckets,
      hasData: active.hasData,
      hasUnitPriceData,
    };
  }, [
    autoTierCount,
    session?.results,
    bucketOwnSkuSet,
    bucketPriceView,
    display.currencySymbol,
    groupsByTypeMap,
  ]);

  const setActiveClassRank = (name: string, rank: number) => {
    setClassOrderByGrouping((prev) => {
      const order = [...(prev[primaryGrouping] ?? [])];
      const active = order.filter((className) => (skusForClass[className] ?? []).length > 0);
      const fromIndex = active.indexOf(name);
      if (fromIndex < 0) return prev;

      const nextActive = moveToRank(active, fromIndex, rank);
      let activeIdx = 0;
      const next = order.map((className) =>
        (skusForClass[className] ?? []).length > 0 ? nextActive[activeIdx++] : className,
      );
      return { ...prev, [primaryGrouping]: next };
    });
  };

  const handleRunOptimizer = async () => {
    if (!slug || !primaryGrouping || !focusBrand) return;

    if (abortController.current) {
      abortController.current.abort();
    }
    abortController.current = new AbortController();
    setIsOptimizing(true);
    setOptError(null);
    setOptResult(null);

    try {
      const ppa_size_chains: string[][] = [];
      for (const className of ppaConfig.classOrder) {
        const skus = (skusForClass[className] ?? [])
          .filter((s) => isSkuIncluded(includedBySku, s.name))
          .map((s) => s.name);
        if (skus.length > 1) {
          ppa_size_chains.push(skus);
        }
      }

      const ppa_tier_links = [];
      for (let i = 0; i < ppaConfig.classOrder.length - 1; i++) {
        const highClass = ppaConfig.classOrder[i];
        const lowClass = ppaConfig.classOrder[i + 1];
        const highSku = ppaConfig.referenceByClass[highClass];
        const lowSku = ppaConfig.referenceByClass[lowClass];
        if (
          highSku &&
          lowSku &&
          isSkuIncluded(includedBySku, highSku) &&
          isSkuIncluded(includedBySku, lowSku)
        ) {
          ppa_tier_links.push({
            high_sku: highSku,
            low_sku: lowSku,
            min_premium_pct:
              ppaConfig.minClassPremiumPct > 0
                ? ppaConfig.minClassPremiumPct / 100
                : null,
          });
        }
      }

      const bounds = skuBounds;
      const request: RunOptimizerRequest = {
        group_type: brandType,
        brand: focusBrand,
        bounds: focusBrandSkus.map((sku) => {
          const b = bounds.find((bound) => bound.sku === sku);
          return {
            sku,
            base_price: b?.base_price ?? 0,
            lo: b?.lo ?? 0,
            hi: b?.hi ?? 0,
            cost: b?.cost ?? 0,
            included: isSkuIncluded(includedBySku, sku),
          };
        }),
        objective: objectiveToBackend(objective),
        scope: "selected",
        min_margin_pct: marginFloor,
        max_volume_drop_pct: shareLossLimit,
        enforce_ppa_ladder: ppa_size_chains.length > 0 || ppa_tier_links.length > 0,
        ppa_size_chains,
        ppa_tier_links,
        ppa_min_saving: ppaConfig.minUnitSavingPct != null ? ppaConfig.minUnitSavingPct / 100 : null,
        ppa_max_saving: ppaConfig.maxUnitSavingPct != null ? ppaConfig.maxUnitSavingPct / 100 : null,
        max_iters: fastOptimize ? 5 : 15,
        multi_start: fastOptimize ? "current" : "full",
        ...setup,
      };

      const outcome = await runOptimizerJob(
        slug,
        request,
        () => {}, // progress callback
        abortController.current.signal
      );
      setOptResult(outcome.result);
    } catch (err: any) {
      if (err.message !== "Optimization cancelled") {
        setOptError(err.message || "Optimization failed");
      }
    } finally {
      setIsOptimizing(false);
    }
  };

  const includedCount = includedClassOrder.length;

  return (
    <div className="ppa-page">
      <div className="opt-stack">
        <div className="ppa-setup-stack">
          <div className="opt-card ppa-setup-card">
            <div className="ppa-setup-head">
              <h3 className="opt-panel-title">Optimization objective</h3>
              <p className="opt-panel-sub">
                Tied to brand and category performance — volume, value, and CM
              </p>
            </div>
            <div className="ppa-setup-fields">
              <label className="opt-field">
                Objective
                <select
                  value={objective}
                  onChange={(e) => setObjective(e.target.value as Objective)}
                >
                  <option value="Margin">Maximize category contribution margin</option>
                  <option value="Share">Maximize volume</option>
                  <option value="ValueShare">Maximize value share</option>
                </select>
              </label>
              <label className="opt-field">
                Scope
                <select
                  value={focusBrand}
                  onChange={(e) => setFocusBrand(e.target.value)}
                  disabled={ownBrands.length === 0}
                >
                  {ownBrands.length === 0 ? (
                    <option value="">No own brands</option>
                  ) : (
                    ownBrands.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>

            <div className="opt-guardrail-sliders">
              <div className="opt-slider-row">
                <div className="opt-slider-lab">
                  <span>Max volume drop</span>
                  <span className="opt-slider-lab-note">(vs current)</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={shareLossLimit}
                  style={
                    {
                      "--opt-slider-fill": `${(shareLossLimit / 20) * 100}%`,
                    } as React.CSSProperties
                  }
                  onChange={(e) => setShareLossLimit(Number(e.target.value))}
                />
                <div className="opt-slider-val">{shareLossLimit}%</div>
              </div>
              <div className="opt-slider-row">
                <div className="opt-slider-lab">
                  <span>Min contribution margin</span>
                  <span className="opt-slider-lab-note">(absolute)</span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={50}
                  value={marginFloor}
                  style={
                    {
                      "--opt-slider-fill": `${((marginFloor - 20) / 30) * 100}%`,
                    } as React.CSSProperties
                  }
                  onChange={(e) => setMarginFloor(Number(e.target.value))}
                />
                <div className="opt-slider-val">{marginFloor}%</div>
              </div>
            </div>

            <p className="opt-note">
              Guardrails apply on top of the ladder constraints — the optimizer won&apos;t recommend
              prices that breach either limit.
            </p>
          </div>

          <div className="opt-card ppa-setup-card">
            <div className="ppa-setup-head">
              <h3 className="opt-panel-title">Product line structure</h3>
              <p className="opt-panel-sub">
                How SKUs are grouped and ordered on the ladder below
              </p>
            </div>
            <div className="ppa-setup-fields">
              <label className="opt-field">
                Primary grouping
                <select
                  value={primaryGrouping}
                  onChange={(e) => setPrimaryGrouping(e.target.value)}
                  disabled={primaryOptions.length === 0}
                >
                  {primaryOptions.length === 0 ? (
                    <option value="">No group types in study</option>
                  ) : (
                    primaryOptions.map((gt) => (
                      <option key={gt} value={gt}>
                        {gt}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="opt-field">
                Secondary grouping
                <select value="size-pack" disabled aria-readonly>
                  <option value="size-pack">Size / pack (show every SKU)</option>
                </select>
              </label>
            </div>
            <p className="opt-note">
              Primary sets the grouping shown on the ladder; secondary controls resolution — every
              pack size, or one averaged point per group.
            </p>
          </div>
        </div>

        <div className="opt-card ppa-ladder-card">
          <div className="opt-table-head">
            <h2 className="opt-section-title">Ladder configuration</h2>
            <p className="opt-section-sub">
              Rank classes from higher to lower, then nest by size inside each class. Cross-class
              order is enforced on each class&apos;s reference SKU ({display.perUnitLabel}).
            </p>
          </div>

          <div className="ppa-ladder-order">
            <div className="ppa-order-head">
              <span className="ppa-order-title">Class order</span>
              {classOrder.length > 0 && (
                <span className="ppa-order-count">
                  {includedCount} of {classesWithSkus.length} included
                </span>
              )}
            </div>

            <div className="ppa-ladder-legend">
              <div className="ppa-ladder-legend-row">
                <span className="ppa-legend-dot ppa-legend-high" />
                Rank 1 = top of ladder (Reference SKU {display.perUnitLabel} order)
              </div>
              <div className="ppa-ladder-legend-row">
                <span className="ppa-legend-dot ppa-legend-low" />
                Within class: size small → large
              </div>
              <p className="ppa-ladder-legend-note">
                {minClassPremiumPct !== "" && Number(minClassPremiumPct) > 0
                  ? "Unit saving applies between adjacent sizes in a class. Class premium applies between adjacent class reference SKUs."
                  : "Unit saving applies between adjacent sizes in a class. Reference SKUs enforce cross-class order."}
              </p>
            </div>

              {!primaryGrouping ? (
                <p className="ppa-order-empty">Load a study with group types to configure the ladder.</p>
              ) : classesLoading ? (
                <p className="ppa-order-empty">Loading classes…</p>
              ) : classesWithSkus.length === 0 ? (
                <p className="ppa-order-empty">No classes with SKUs for {focusBrand || "this brand"}.</p>
              ) : (
                <ol className="ppa-class-list">
                  {classesWithSkus.map((name, i) => {
                    const skus = skusForClass[name] ?? [];
                    const included = Boolean(includedByClass[name]);
                    const refSku = referenceByClass[name] ?? "";
                    return (
                      <li
                        key={name}
                        className={`ppa-class-row${included ? "" : " ppa-class-row-off"}`}
                      >
                        <label className="ppa-class-include" title="Include in ladder">
                          <input
                            type="checkbox"
                            checked={included}
                            onChange={(e) =>
                              setIncludedByClass((prev) => ({
                                ...prev,
                                [name]: e.target.checked,
                              }))
                            }
                          />
                        </label>
                        <ClassRankInput
                          rank={i + 1}
                          max={classesWithSkus.length}
                          label={name}
                          disabled={!included}
                          onCommit={(rank) => setActiveClassRank(name, rank)}
                        />
                        <div className="ppa-class-main">
                          <span className="ppa-class-name">{name}</span>
                          <label className="ppa-class-ref">
                            <span>Ref</span>
                            <select
                              value={refSku}
                              disabled={!included}
                              onChange={(e) =>
                                setReferenceByClass((prev) => ({
                                  ...prev,
                                  [name]: e.target.value,
                                }))
                              }
                            >
                              {skus
                                .filter((s) => isSkuIncluded(includedBySku, s.name))
                                .map((s) => (
                                <option key={s.name} value={s.name}>
                                  {s.name}
                                  {s.size != null ? ` · ${fmt(s.size, 2)}` : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {included && name === includedClassOrder[0] && (
                          <span className="ppa-class-tag">Highest</span>
                        )}
                        {included &&
                          name === includedClassOrder[includedClassOrder.length - 1] &&
                          includedClassOrder.length > 1 && (
                            <span className="ppa-class-tag ppa-class-tag-muted">Lowest</span>
                          )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>

          <div className="ppa-constraints-panel">
            <label className="ppa-constraints-toggle">
              <input
                type="checkbox"
                checked={showPctConstraints}
                onChange={(e) => setShowPctConstraints(e.target.checked)}
              />
              Set % thresholds
            </label>

            {showPctConstraints && (
              <>
                <div className="ppa-toggle-row">
                  <label className="opt-field ppa-constraint-field">
                    Min class premium %
                    <div className="ppa-inline-input-wrap">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        placeholder="None"
                        value={minClassPremiumPct}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMinClassPremiumPct(v === "" ? "" : Number(v));
                        }}
                      />
                      <span className="ppa-inline-unit">%</span>
                    </div>
                  </label>
                </div>

                <div className="ppa-saving-row">
                  <label className="opt-field">
                    Min unit saving %
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={minUnitSavingPct}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMinUnitSavingPct(v === "" ? "" : Number(v));
                      }}
                    />
                  </label>
                  <label className="opt-field">
                    Max unit saving %
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      placeholder="None"
                      value={maxUnitSavingPct}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMaxUnitSavingPct(v === "" ? "" : Number(v));
                      }}
                    />
                  </label>
                </div>
              </>
            )}
          </div>

          <div className="ppa-preview">
            <div className="ppa-order-head">
              <span className="ppa-order-title">Ladder preview</span>
              <span className="ppa-order-count">
                {focusBrand ? focusBrand : "Select brand"} · {includedSkuCount} of{" "}
                {focusBrandSkus.length} SKUs included
              </span>
            </div>
            {ladderPreview.length === 0 ? (
              <p className="ppa-order-empty">Include at least one class with SKUs to preview the ladder.</p>
            ) : (
              <div className="ppa-preview-stack">
                {ladderPreview.map((cls, classIdx) => (
                  <div key={cls.className} className="ppa-preview-class">
                    {classIdx > 0 && (
                      <div className="ppa-preview-cross" title="Cross-class reference link">
                        <span className="ppa-preview-cross-line" />
                      </div>
                    )}
                    <div className="ppa-preview-class-head">
                      <span className="ppa-preview-rank">{classIdx + 1}</span>
                      <span className="ppa-preview-class-name">{cls.className}</span>
                      <span className="ppa-preview-sku-count">
                        {cls.skus.filter((s) => isSkuIncluded(includedBySku, s.name)).length} of{" "}
                        {cls.skus.length} SKU{cls.skus.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {cls.skus.length === 0 ? (
                      <p className="ppa-preview-empty">No focus-brand SKUs in this class.</p>
                    ) : (
                      <ul className="ppa-preview-skus">
                        {cls.skus.map((sku, skuIdx) => {
                          const isRef = sku.name === cls.referenceSku;
                          const skuIncluded = isSkuIncluded(includedBySku, sku.name);
                          const includedInClass = cls.skus.filter((s) =>
                            isSkuIncluded(includedBySku, s.name),
                          ).length;
                          return (
                            <li key={sku.name}>
                              {skuIdx > 0 && skuIncluded && (
                                <div className="ppa-preview-size-link" title="Within-class size link">
                                  size ladder
                                  {minUnitSavingPct !== "" && Number(minUnitSavingPct) > 0
                                    ? ` · min save ${fmt(Number(minUnitSavingPct), 1)}%`
                                    : ""}
                                  {maxUnitSavingPct !== ""
                                    ? ` · max save ${fmt(Number(maxUnitSavingPct), 1)}%`
                                    : ""}
                                </div>
                              )}
                              <div
                                className={`ppa-preview-sku${isRef && skuIncluded ? " ppa-preview-sku-ref" : ""}${skuIncluded ? "" : " ppa-preview-sku-off"}`}
                              >
                                <label
                                  className="ppa-preview-sku-include"
                                  title={
                                    skuIncluded
                                      ? "Exclude from optimization"
                                      : "Include in optimization"
                                  }
                                >
                                  <input
                                    type="checkbox"
                                    checked={skuIncluded}
                                    disabled={
                                      isOptimizing ||
                                      (skuIncluded && includedInClass <= 1)
                                    }
                                    onChange={(e) =>
                                      setSkuIncluded(cls.className, sku.name, e.target.checked)
                                    }
                                  />
                                </label>
                                <span className="ppa-preview-sku-name">
                                  {sku.name}
                                  {isRef && skuIncluded && (
                                    <span className="ppa-class-tag">Ref</span>
                                  )}
                                </span>
                                <span className="ppa-preview-sku-metrics">
                                  {sku.size != null ? (
                                    <span>{fmt(sku.size, 2)} u</span>
                                  ) : (
                                    <span className="ppa-muted">no size</span>
                                  )}
                                  <span>
                                    {sku.price > 0 ? display.fmtPrice(sku.price) : "—"}
                                  </span>
                                  <span>
                                    {sku.unitPrice != null
                                      ? display.fmtPerUnitPrice(sku.unitPrice)
                                      : "—"}
                                  </span>
                                </span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="ppa-run-actions">
            <div className="ppa-run-actions-row">
              <button
                type="button"
                className="btn-primary ppa-run-btn"
                disabled={isOptimizing || includedCount === 0 || includedSkuCount === 0}
                onClick={handleRunOptimizer}
              >
                {isOptimizing ? "Optimizing…" : "Run ladder optimizer"}
              </button>
              <label className="ppa-checkbox-label ppa-fast-opt-label">
                <input
                  type="checkbox"
                  checked={fastOptimize}
                  onChange={(e) => setFastOptimize(e.target.checked)}
                  disabled={isOptimizing}
                />
                Fast optimize
              </label>
            </div>
            {optError && <div className="opt-error-panel-msg ppa-run-error">{optError}</div>}
            <p className="opt-note">
              {fastOptimize
                ? "Fast mode: starts from current prices only, up to 5 refinement passes (~2–4× quicker)."
                : "Full mode: 5 multi-starts and up to 15 passes for the best objective."}{" "}
              Run the optimizer to generate an optimized ladder and see the impact on brand and
              category volume, value, and CM.
            </p>
          </div>
        </div>

        {optResult && optResult.brand_totals && (
          <div className="opt-card" style={{ padding: "16px 20px", display: "flex", gap: "24px", alignItems: "center", background: "var(--bg, #f6f7f9)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>Volume Impact</div>
              <div style={{ fontSize: "20px", fontWeight: 500, color: optResult.brand_totals.vol_delta_pp >= 0 ? "var(--green, #10b981)" : "var(--red, #ef4444)" }}>
                {optResult.brand_totals.vol_delta_pp > 0 ? "+" : ""}{fmt(optResult.brand_totals.vol_delta_pp, 2)} pp
              </div>
            </div>
            <div style={{ width: "1px", height: "30px", background: "var(--border)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>Value Share Impact</div>
              <div style={{ fontSize: "20px", fontWeight: 500, color: optResult.brand_totals.val_delta_pp >= 0 ? "var(--green, #10b981)" : "var(--red, #ef4444)" }}>
                {optResult.brand_totals.val_delta_pp > 0 ? "+" : ""}{fmt(optResult.brand_totals.val_delta_pp, 2)} pp
              </div>
            </div>
            <div style={{ width: "1px", height: "30px", background: "var(--border)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>Revenue Impact</div>
              <div style={{ fontSize: "20px", fontWeight: 500, color: optResult.brand_totals.rev_delta_pct >= 0 ? "var(--green, #10b981)" : "var(--red, #ef4444)" }}>
                {optResult.brand_totals.rev_delta_pct > 0 ? "+" : ""}{fmt(optResult.brand_totals.rev_delta_pct, 1)}%
              </div>
            </div>
            <div style={{ width: "1px", height: "30px", background: "var(--border)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>Margin Impact</div>
              {optResult.brand_totals.cm_delta_pp == null ? (
                <div style={{ fontSize: "20px", fontWeight: 500, color: "var(--text-muted)" }}>—</div>
              ) : (
                <div style={{ fontSize: "20px", fontWeight: 500, color: optResult.brand_totals.cm_delta_pp >= 0 ? "var(--green, #10b981)" : "var(--red, #ef4444)" }}>
                  {optResult.brand_totals.cm_delta_pp > 0 ? "+" : ""}{fmt(optResult.brand_totals.cm_delta_pp, 1)} pp
                </div>
              )}
              {optResult.brand_totals.new_cm_pct != null ? (
                <div className="opt-impact-kpi-formula">
                  {fmt(optResult.brand_totals.new_cm_pct, 1)}% brand margin after optimization
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div className="opt-card opt-bucket-card">
          <div className="opt-table-head">
            <h2 className="opt-section-title">Price Ladder — Current vs. Optimized</h2>
            <p className="opt-section-sub">
              Prices ordered by class and size. Dashed line is current, solid lines are optimized (colored by tier).
            </p>
          </div>
          <div style={{ padding: "0 10px 20px 10px", overflowX: "auto" }}>
            {(() => {
              // Build ladder points for the chart
              const points: { label: string; current: number | null; opt: number | null; classIdx: number; className: string }[] = [];
              let hasUnitPrice = false;
              
              for (const cls of ladderPreview) {
                for (const sku of cls.skus) {
                  if (!isSkuIncluded(includedBySku, sku.name)) continue;
                  if (sku.unitPrice != null) hasUnitPrice = true;
                }
              }

              ladderPreview.forEach((cls, classIdx) => {
                for (const sku of cls.skus) {
                  if (!isSkuIncluded(includedBySku, sku.name)) continue;
                  const optPack = optimizedPackPrice(sku.name, optResult);
                  const optUnit =
                    optPack != null && sku.size != null && sku.size > 0
                      ? optPack / sku.size
                      : optPack;
                  points.push({
                    label: sku.name,
                    current: hasUnitPrice ? sku.unitPrice : sku.price,
                    opt: optUnit != null ? (hasUnitPrice ? optUnit : optPack) : null,
                    classIdx,
                    className: cls.className,
                  });
                }
              });

              if (points.length === 0) return <div className="opt-muted">No SKUs in ladder.</div>;

              const maxVal = Math.max(0.1, ...points.map(p => Math.max(p.current || 0, p.opt || 0)));
              const minVal = Math.min(...points.map(p => Math.min(p.current || maxVal, p.opt || maxVal))) * 0.9;
              const range = maxVal - minVal;
              
              const svgWidth = Math.max(600, points.length * 35); // Further compressed width
              const svgHeight = 550; // Increased height significantly for long labels
              
              const getX = (i: number) => 40 + (i * (svgWidth - 60) / Math.max(1, points.length - 1));
              const getY = (val: number) => 20 + (1 - (val - minVal) / range) * (svgHeight - 250); // Leave bottom 230px for labels

              let currentPath = '';
              let firstCurr = true;

              points.forEach((p, i) => {
                if (p.current != null) {
                  currentPath += `${firstCurr ? 'M' : ' L'} ${getX(i)} ${getY(p.current)}`;
                  firstCurr = false;
                }
              });

              const usedClasses = Array.from(new Set(points.map(p => p.classIdx)));

              return (
                <div>
                  {/* Legend */}
                  <div style={{ display: "flex", gap: "16px", marginBottom: "16px", flexWrap: "wrap", justifyContent: "center" }}>
                    {usedClasses.map(cIdx => (
                      <div key={cIdx} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-main)" }}>
                        <span style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: tierColor(cIdx) }}></span>
                        {ladderPreview[cIdx].className}
                      </div>
                    ))}
                  </div>

                  <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ minWidth: svgWidth }}>
                    {/* Grid lines */}
                    {[0, 0.5, 1].map(pct => {
                      const y = 20 + pct * (svgHeight - 250);
                      const val = minVal + (1 - pct) * range;
                      return (
                        <g key={pct}>
                          <line x1="40" y1={y} x2={svgWidth - 20} y2={y} stroke="var(--border)" strokeDasharray="4 4" />
                          <text x="35" y={y + 4} fontSize="10" fill="var(--text-muted)" textAnchor="end">{display.fmtPrice(val)}</text>
                        </g>
                      );
                    })}
                    
                    {/* Current Line */}
                    {currentPath && <path d={currentPath} fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="6 4" />}
                    {points.map((p, i) => p.current != null && (
                      <circle key={`c-${i}`} cx={getX(i)} cy={getY(p.current)} r="4" fill="var(--bg)" stroke="var(--text-muted)" strokeWidth="2" />
                    ))}

                    {/* Opt Line Segments */}
                    {(() => {
                      const segments = [];
                      let lastValidIdx = -1;
                      for (let i = 0; i < points.length; i++) {
                        if (points[i].opt != null) {
                          if (lastValidIdx !== -1) {
                            const p1 = points[lastValidIdx];
                            const p2 = points[i];
                            const isSameTier = p1.classIdx === p2.classIdx;
                            const color = isSameTier ? tierColor(p1.classIdx) : "var(--border, #cbd5e1)";
                            segments.push(
                              <line 
                                key={`opt-seg-${lastValidIdx}-${i}`}
                                x1={getX(lastValidIdx)} y1={getY(p1.opt!)}
                                x2={getX(i)} y2={getY(p2.opt!)}
                                stroke={color}
                                strokeWidth={isSameTier ? "2.5" : "1.5"}
                                strokeDasharray={isSameTier ? "none" : "4 4"}
                              />
                            );
                          }
                          lastValidIdx = i;
                        }
                      }
                      return segments;
                    })()}

                    {/* Opt Circles */}
                    {points.map((p, i) => p.opt != null && (
                      <circle 
                        key={`o-${i}`} 
                        cx={getX(i)} 
                        cy={getY(p.opt)} 
                        r="5" 
                        fill={tierColor(p.classIdx)} 
                      />
                    ))}

                    {/* X Axis Labels */}
                    {points.map((p, i) => (
                      <text 
                        key={`l-${i}`} 
                        x={getX(i)} 
                        y={svgHeight - 220} 
                        fontSize="10" 
                        fill="var(--text-muted)" 
                        textAnchor="end" 
                        transform={`rotate(-45 ${getX(i)} ${svgHeight - 220})`}
                      >
                        {p.label}
                      </text>
                    ))}
                  </svg>
                </div>
              );
            })()}
          </div>
        </div>

        <div className="opt-card opt-bucket-card">
          <div className="opt-table-head">
            <h2 className="opt-section-title">PPA Ladder Diagnostics</h2>
            <p className="opt-section-sub">
              Constraint evaluation for the optimized prices.
            </p>
          </div>
          {ppaDiagnosticRows.length > 0 ? (
            <div className="opt-table-wrap">
              <table className="opt-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th className="num">Size</th>
                    <th className="num">Price</th>
                    <th className="num">{bucketData.hasUnitPriceData ? display.perUnitLabel : "Unit Price"}</th>
                    <th className="num">discount%</th>
                    <th className="num">Tier Premium</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ppaDiagnosticRows.map((row, i) => {
                    const rowBgColor = tierRowBackground(row.classIdx);
                    const rowBorderColor = tierColor(row.classIdx);
                    return (
                      <tr 
                        key={i} 
                        className={row.is_tier_link ? "ppa-tier-link-row" : ""}
                      >
                        <td style={{ backgroundColor: rowBgColor, boxShadow: `inset 3px 0 0 ${rowBorderColor}` }}>{row.sku}</td>
                        <td className="num" style={{ backgroundColor: rowBgColor }}>{row.size != null ? fmt(row.size, 2) : "—"}</td>
                        <td className="num" style={{ backgroundColor: rowBgColor }}>{display.fmtPrice(row.price)}</td>
                        <td className="num" style={{ backgroundColor: rowBgColor }}>{row.unit_price != null ? display.fmtPerUnitPrice(row.unit_price) : "—"}</td>
                        <td className="num" style={{ backgroundColor: rowBgColor }}>{row.saving_vs_prev != null ? `${fmt(row.saving_vs_prev * 100, 1)}%` : "—"}</td>
                        <td className="num" style={{ backgroundColor: rowBgColor }}>{row.tier_premium_vs_low != null ? `${fmt(row.tier_premium_vs_low * 100, 1)}%` : "—"}</td>
                        <td style={{ backgroundColor: rowBgColor }}>
                          <span className={`opt-badge ${row.status === "ok" ? "opt-badge-ok" : "opt-badge-err"}`}>
                            {row.status}
                          </span>
                          {row.detail ? (
                            <span className="opt-muted" style={{ marginLeft: "0.5rem" }}>
                              {row.detail}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="opt-empty-state" style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
              Run the optimizer to see ladder diagnostics.
            </div>
          )}
        </div>

        <div className="opt-card opt-bucket-card">
          <div className="opt-table-head">
            <h2 className="opt-section-title">Where does volume sit across price bands?</h2>
            <p className="opt-section-sub">
              Within each price band, share of volume for your brand vs. competitors (100% stacked).
            </p>
          </div>

          <div className="opt-bucket-options">
            <div className="opt-bucket-options-copy">
              <span className="opt-bucket-options-title">Price bands</span>
              <span className="opt-bucket-options-note">
                Auto-calculated from the category{" "}
                {bucketPriceView === "unit" && bucketData.hasUnitPriceData
                  ? display.perUnitLabel
                  : "pack price"}{" "}
                range
              </span>
            </div>
            <div className="opt-bucket-options-fields">
              {ownBrands.length > 0 ? (
                <label className="opt-bucket-tier-field">
                  <span className="opt-bucket-tier-label">Own brand</span>
                  <select
                    className="opt-bucket-tier-select"
                    value={bucketBrandFilter}
                    onChange={(e) => setBucketBrandFilter(e.target.value)}
                  >
                    <option value="">All own brands</option>
                    {ownBrands.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="opt-bucket-tier-field">
                <span className="opt-bucket-tier-label">Number of tiers</span>
                <input
                  type="number"
                  min={2}
                  max={10}
                  step={1}
                  value={autoTierCount}
                  onChange={(e) => {
                    const parsed = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(parsed)) {
                      setAutoTierCount(Math.max(2, Math.min(10, parsed)));
                    }
                  }}
                />
              </label>
            </div>
          </div>

          {bucketData.hasUnitPriceData ? (
            <div className="section-tabs opt-bucket-tabs">
              <button
                type="button"
                className={`tab-btn${bucketPriceView === "pack" ? " active" : ""}`}
                onClick={() => setBucketPriceView("pack")}
              >
                Pack price
              </button>
              <button
                type="button"
                className={`tab-btn${bucketPriceView === "unit" ? " active" : ""}`}
                onClick={() => setBucketPriceView("unit")}
              >
                {display.perUnitLabel}
              </button>
            </div>
          ) : null}

          {!bucketData.hasData ? (
            <div className="opt-empty-state" style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
              No volume share data available for the current study. Run a simulation first if results are empty.
            </div>
          ) : (
            <>
              <div className="opt-bucket-chart">
                <div className="opt-bucket-yaxis">
                  {[4, 3, 2, 1, 0].map((i) => (
                    <div key={i} className="opt-bucket-ytick">
                      {Math.round((100 / 4) * i)}%
                    </div>
                  ))}
                </div>
                <div className="opt-bucket-plot">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="opt-bucket-gridline"
                      style={{ bottom: `${(i / 4) * 100}%` }}
                    />
                  ))}
                  {bucketData.buckets.map((b) => (
                    <div key={b.label} className="opt-bucket-col">
                      <div className="opt-bucket-bar">
                        <div
                          className="opt-bucket-seg opt-bucket-own"
                          style={{ height: `${b.ownPct}%` }}
                          title={`Own: ${fmt(b.ownPct)}%`}
                        />
                        <div
                          className="opt-bucket-seg opt-bucket-comp"
                          style={{ height: `${b.compPct}%` }}
                          title={`Competitors: ${fmt(b.compPct)}%`}
                        />
                      </div>
                      <div className="opt-bucket-label">{b.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="opt-bucket-legend">
                <span className="opt-bucket-legend-item">
                  <span className="opt-bucket-swatch opt-bucket-own" />{" "}
                  {bucketBrandFilter || "Own brand"}
                </span>
                <span className="opt-bucket-legend-item">
                  <span className="opt-bucket-swatch opt-bucket-comp" /> Competitors
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
