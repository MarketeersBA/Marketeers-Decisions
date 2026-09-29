import type { GroupRow, ResultRow } from "../../api/types";

export type BrandSkuEfficiencyRow = {
  brand: string;
  valueShare: number;
  skuShare: number;
  /** SKU share ÷ value share × 100. &lt; 100 = efficient (fewer SKUs than value weight). */
  indexPct: number;
  skuCount: number;
  isOwn: boolean;
  efficient: boolean;
};

function isProductRow(row: ResultRow): boolean {
  const name = row["Product Name"];
  return typeof name === "string" && name.length > 0 && !name.startsWith("GROUP:");
}

function numValueShare(row: ResultRow): number {
  const raw = Number(row["Value Share"]);
  return Number.isFinite(raw) ? raw : 0;
}

export function productNamesInResults(results: ResultRow[]): Set<string> {
  const names = new Set<string>();
  for (const row of results) {
    if (!isProductRow(row)) continue;
    names.add(String(row["Product Name"]));
  }
  return names;
}

/**
 * Brand-level SKU efficiency: SKU share (count share) vs value share.
 * Index = skuShare / valueShare × 100; efficient when index &lt; 100.
 */
export function buildBrandSkuEfficiencyRows(
  brandGroups: GroupRow[],
  results: ResultRow[],
  ownSkuNames: Iterable<string>,
  /** Limit universe to these SKUs (e.g. segment filter). Defaults to all product rows. */
  skuUniverse?: Iterable<string>,
): BrandSkuEfficiencyRow[] {
  const ownSet = new Set(ownSkuNames);
  const resultsByName = new Map<string, ResultRow>();
  for (const row of results) {
    if (!isProductRow(row)) continue;
    resultsByName.set(String(row["Product Name"]), row);
  }

  const universe =
    skuUniverse != null
      ? new Set([...skuUniverse].filter((n) => resultsByName.has(n)))
      : new Set(resultsByName.keys());

  const totalSkuCount = universe.size;
  if (totalSkuCount === 0) return [];

  const rows: BrandSkuEfficiencyRow[] = [];

  for (const group of brandGroups) {
    const brand = String(group.Name ?? "").trim();
    if (!brand) continue;

    const groupSkus = Array.isArray(group.productNames) ? group.productNames : [];
    const skus = groupSkus.filter((sku) => universe.has(sku));
    if (skus.length === 0) continue;

    let valueShare = 0;
    for (const sku of skus) {
      const row = resultsByName.get(sku);
      if (row) valueShare += numValueShare(row);
    }

    // Prefer group rollup when SKU-level values are missing but group has a share.
    if (valueShare <= 0) {
      const fromGroup = Number(group["Value Share"] ?? group["B.Share"]);
      if (Number.isFinite(fromGroup) && fromGroup > 0) valueShare = fromGroup;
    }

    const skuShare = (skus.length / totalSkuCount) * 100;
    // Non-finite when value share is ~0 — chart skips these index points.
    const indexPct = valueShare > 1e-9 ? (skuShare / valueShare) * 100 : Number.NaN;
    const efficient = Number.isFinite(indexPct) && indexPct < 100;
    const isOwn = skus.some((sku) => ownSet.has(sku));

    rows.push({
      brand,
      valueShare,
      skuShare,
      indexPct,
      skuCount: skus.length,
      isOwn,
      efficient,
    });
  }

  return rows.sort((a, b) => {
    if (b.valueShare !== a.valueShare) return b.valueShare - a.valueShare;
    return a.brand.localeCompare(b.brand);
  });
}

export function buildSkuEfficiencyHeadline(rows: BrandSkuEfficiencyRow[]): string | null {
  if (rows.length === 0) return null;

  const own = rows.filter((r) => r.isOwn);
  const scope = own.length > 0 ? own : rows;
  const efficient = scope.filter((r) => r.efficient);

  if (efficient.length === 0) {
    return own.length > 0
      ? "No own brand is efficient in its number of SKUs vs its Value Share"
      : "No brand is efficient in its number of SKUs vs its Value Share";
  }

  if (efficient.length === 1) {
    const prefix = own.length > 0 ? "Only " : "";
    return `${prefix}${efficient[0].brand} is efficient in its number of SKUs vs its Value Share`;
  }

  const names = efficient.map((r) => r.brand);
  if (names.length === 2) {
    return `${names[0]} and ${names[1]} are efficient in their number of SKUs vs Value Share`;
  }
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]} are efficient in their number of SKUs vs Value Share`;
}

/** Inefficient own brands (highest index first) for the opportunity prompt. */
export function inefficientOwnBrandNames(rows: BrandSkuEfficiencyRow[], limit = 3): string[] {
  return rows
    .filter((r) => r.isOwn && !r.efficient && Number.isFinite(r.indexPct))
    .sort((a, b) => b.indexPct - a.indexPct)
    .slice(0, limit)
    .map((r) => r.brand);
}

export function buildOpportunityPrompt(brandNames: string[]): string | null {
  if (brandNames.length === 0) return null;
  if (brandNames.length === 1) {
    return `Is ${brandNames[0]}'s opportunity in Brand Value OR Distribution?`;
  }
  if (brandNames.length === 2) {
    return `Are ${brandNames[0]} & ${brandNames[1]}'s opportunity in Brand Value OR Distribution?`;
  }
  const head = brandNames.slice(0, -1).join(", ");
  const last = brandNames[brandNames.length - 1];
  return `Are ${head} & ${last}'s opportunity in Brand Value OR Distribution?`;
}
