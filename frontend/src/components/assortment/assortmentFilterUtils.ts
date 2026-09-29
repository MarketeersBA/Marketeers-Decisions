import type { GroupRow, ResultRow } from "../../api/types";
import { discreteLevelIndex } from "../../lib/cellValue";

export const ALL_MEMBERS = "__all__";
export const OFFER_TYPE_GROUP = "Offer Type";
export const STANDALONE_OFFER = "Standalone";

export function isOfferTypeGroupType(type: string): boolean {
  return type.trim().toLowerCase() === OFFER_TYPE_GROUP.toLowerCase();
}

export function offerTypeGroupKey(groupsByType: Record<string, GroupRow[]>): string | null {
  const key = Object.keys(groupsByType).find((k) => isOfferTypeGroupType(k));
  return key ?? null;
}

export function hasOfferTypeGroups(groupsByType: Record<string, GroupRow[]>): boolean {
  return offerTypeGroupKey(groupsByType) != null;
}

export function standaloneOfferSkus(groupsByType: Record<string, GroupRow[]>): Set<string> {
  const typeKey = offerTypeGroupKey(groupsByType);
  if (!typeKey) return new Set();
  const row = findGroupRow(groupsByType, typeKey, STANDALONE_OFFER);
  const names = Array.isArray(row?.productNames) ? row.productNames : [];
  return new Set(names);
}

/** When Offer Type groups exist, keep only Standalone SKUs; otherwise pass through. */
export function filterStandaloneOfferSkus(
  skus: string[],
  groupsByType: Record<string, GroupRow[]>,
): string[] {
  if (!hasOfferTypeGroups(groupsByType)) return skus;
  const allowed = standaloneOfferSkus(groupsByType);
  return skus.filter((sku) => allowed.has(sku));
}

export function standaloneOfferSkusFromMap(
  groupsByType: Record<string, Record<string, string[]>>,
): Set<string> {
  const typeKey = Object.keys(groupsByType).find((k) => isOfferTypeGroupType(k));
  if (!typeKey) return new Set();
  const members = groupsByType[typeKey] ?? {};
  const standaloneKey = Object.keys(members).find(
    (k) => k.toLowerCase() === STANDALONE_OFFER.toLowerCase(),
  );
  if (!standaloneKey) return new Set();
  return new Set(members[standaloneKey] ?? []);
}

/** When Offer Type groups exist, keep only Standalone SKUs; otherwise pass through. */
export function filterStandaloneOfferSkusFromMap(
  skus: string[],
  groupsByType: Record<string, Record<string, string[]>>,
): string[] {
  const typeKey = Object.keys(groupsByType).find((k) => isOfferTypeGroupType(k));
  if (!typeKey) return skus;
  const allowed = standaloneOfferSkusFromMap(groupsByType);
  return skus.filter((sku) => allowed.has(sku));
}

export function groupsForType(groupsByType: Record<string, GroupRow[]>, type: string): GroupRow[] {
  if (groupsByType[type]?.length) return groupsByType[type];
  const key = Object.keys(groupsByType).find((k) => k.toLowerCase() === type.toLowerCase());
  return key ? (groupsByType[key] ?? []) : [];
}

export function findGroupRow(
  groupsByType: Record<string, GroupRow[]>,
  type: string,
  member: string,
): GroupRow | undefined {
  const groups = groupsForType(groupsByType, type);
  return (
    groups.find((g) => String(g.Name) === member) ??
    groups.find((g) => String(g.Name).toLowerCase() === member.toLowerCase())
  );
}

export function discreteLevelsForType(
  levels: Record<string, string[]> | undefined,
  type: string,
): string[] {
  if (!levels) return [];
  if (levels[type]?.length) return levels[type];
  const key = Object.keys(levels).find((k) => k.toLowerCase() === type.toLowerCase());
  return key ? (levels[key] ?? []) : [];
}

export function resultColumnForType(results: ResultRow[], type: string): string | undefined {
  if (results.length === 0) return undefined;
  const cols = Object.keys(results[0]);
  if (cols.includes(type)) return type;
  return cols.find((c) => c.toLowerCase() === type.toLowerCase());
}

export function skusMatchingAttribute(
  results: ResultRow[],
  type: string,
  member: string,
  discreteLevels?: Record<string, string[]>,
): string[] {
  const col = resultColumnForType(results, type);
  if (!col) return [];

  const levels = discreteLevelsForType(discreteLevels, type);
  const targetIndex = levels.length > 0 ? discreteLevelIndex(member, levels) : null;
  const normalizedMember = member.trim().toLowerCase();

  const out: string[] = [];
  for (const row of results) {
    const name = row["Product Name"];
    if (typeof name !== "string" || !name || name.startsWith("GROUP:")) continue;
    const raw = row[col];

    if (targetIndex != null) {
      const rowIndex = discreteLevelIndex(raw, levels);
      if (rowIndex === targetIndex) out.push(name);
      continue;
    }

    if (String(raw ?? "").trim().toLowerCase() === normalizedMember) {
      out.push(name);
    }
  }
  return out;
}

export function skusForCrossFilter(
  groupsByType: Record<string, GroupRow[]>,
  type: string,
  member: string,
  results: ResultRow[],
  discreteLevels?: Record<string, string[]>,
): string[] {
  const filterRow = findGroupRow(groupsByType, type, member);
  if (Array.isArray(filterRow?.productNames) && filterRow.productNames.length > 0) {
    return filterRow.productNames;
  }
  return skusMatchingAttribute(results, type, member, discreteLevels);
}

export function filterScopedSkus(
  baseSkus: string[],
  crossFilterMembers: Record<string, string>,
  groupsByType: Record<string, GroupRow[]>,
  results: ResultRow[],
  discreteLevels?: Record<string, string[]>,
): string[] {
  const activeCrossFilters = Object.entries(crossFilterMembers).filter(
    ([, member]) => member && member !== ALL_MEMBERS,
  );
  if (activeCrossFilters.length === 0) return baseSkus;

  const filtersByType = new Map<string, string[]>();
  for (const [type, member] of activeCrossFilters) {
    if (!filtersByType.has(type)) filtersByType.set(type, []);
    filtersByType.get(type)!.push(member);
  }

  let filteredSkus = [...baseSkus];
  for (const [type, members] of filtersByType.entries()) {
    const typeSkus = new Set<string>();
    for (const member of members) {
      skusForCrossFilter(groupsByType, type, member, results, discreteLevels).forEach((sku) =>
        typeSkus.add(sku),
      );
    }
    filteredSkus = filteredSkus.filter((sku) => typeSkus.has(sku));
  }
  return filteredSkus;
}
