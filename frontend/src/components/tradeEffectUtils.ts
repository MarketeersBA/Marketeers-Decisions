import type { SomSopRow } from "../api/analytics_types";

export interface TradeEffectBrandGroup {
  name: string;
  productNames: string[];
}

export interface TradeEffectPoint {
  name: string;
  /** Volume share, percent. */
  som: number;
  /** Penetration, percent. */
  sop: number;
  own: boolean;
}

/** Roll SKU-level base SoM / SoP up to brand groups. */
export function rollupSomSopByBrand(
  skuRows: SomSopRow[],
  brandGroups: TradeEffectBrandGroup[],
  ownSkuNames: Set<string>,
): TradeEffectPoint[] {
  const skuToBrand = new Map<string, string>();
  const ownByBrand = new Map<string, boolean>();
  for (const group of brandGroups) {
    const name = group.name.trim();
    if (!name) continue;
    let own = ownByBrand.get(name) ?? false;
    for (const sku of group.productNames) {
      if (!sku) continue;
      skuToBrand.set(sku, name);
      if (ownSkuNames.has(sku)) own = true;
    }
    ownByBrand.set(name, own);
  }

  const totals = new Map<string, { som: number; sop: number }>();
  for (const row of skuRows) {
    const brand = skuToBrand.get(row.name);
    if (!brand) continue;
    const current = totals.get(brand) ?? { som: 0, sop: 0 };
    current.som += Number(row.som) || 0;
    current.sop += Number(row.sop) || 0;
    totals.set(brand, current);
  }

  const points: TradeEffectPoint[] = [];
  for (const [name, value] of totals) {
    points.push({
      name,
      som: value.som * 100,
      sop: value.sop * 100,
      own: ownByBrand.get(name) ?? false,
    });
  }
  points.sort((a, b) => b.som - a.som || a.name.localeCompare(b.name));
  return points;
}
