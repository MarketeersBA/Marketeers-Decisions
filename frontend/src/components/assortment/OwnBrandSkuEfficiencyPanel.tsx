import { useEffect, useMemo, useState } from "react";

import { api } from "../../api/client";
import type { GroupRow, ResultRow } from "../../api/types";
import { useSession } from "../../stores/sessionStore";
import { OwnBrandSkuEfficiencyChart } from "./OwnBrandSkuEfficiencyChart";
import {
  buildBrandSkuEfficiencyRows,
  buildOpportunityPrompt,
  buildSkuEfficiencyHeadline,
  inefficientOwnBrandNames,
} from "./ownBrandSkuEfficiencyUtils";

function defaultBrandType(groupTypes: string[] | undefined): string {
  return groupTypes?.find((t) => /^brand$/i.test(t)) ?? "Brand";
}

export function OwnBrandSkuEfficiencyPanel() {
  const { session } = useSession();
  const [brandGroups, setBrandGroups] = useState<GroupRow[]>([]);

  const brandType = useMemo(
    () => defaultBrandType(session?.groupTypes),
    [session?.groupTypes],
  );

  useEffect(() => {
    if (!session?.sessionId) {
      setBrandGroups([]);
      return;
    }

    // Session payload already includes Brand groups for the default study layout.
    if (session.groups?.length) {
      setBrandGroups(session.groups);
      return;
    }

    let cancelled = false;
    api
      .get<{ groups: GroupRow[] }>(
        `/api/sessions/${session.sessionId}/groups?group_type=${encodeURIComponent(brandType)}`,
      )
      .then((data) => {
        if (!cancelled) setBrandGroups(data.groups ?? []);
      })
      .catch(() => {
        if (!cancelled) setBrandGroups([]);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.sessionId, session?.groups, brandType]);

  const results = useMemo(
    () => (session?.results ?? []) as ResultRow[],
    [session?.results],
  );

  const ownSkus = useMemo(
    () => session?.companyProducts ?? [],
    [session?.companyProducts],
  );

  const rows = useMemo(
    () => buildBrandSkuEfficiencyRows(brandGroups, results, ownSkus),
    [brandGroups, results, ownSkus],
  );

  const headline = useMemo(() => buildSkuEfficiencyHeadline(rows), [rows]);
  const opportunity = useMemo(
    () => buildOpportunityPrompt(inefficientOwnBrandNames(rows)),
    [rows],
  );

  const ownCount = rows.filter((r) => r.isOwn).length;

  return (
    <div className="opt-card assortment-sku-eff-card">
      <div className="opt-table-head">
        <h2 className="opt-section-title">Own brands SKU efficiency</h2>
        <p className="opt-section-sub">
          SKU Share (count of brand SKUs ÷ category SKUs) vs Value Share. Index{" "}
          {"<"} 100% means the brand earns more value than its assortment breadth.
          {ownCount > 0 ? ` Own brands highlighted (${ownCount}).` : null}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="assortment-inc-empty assortment-table-empty">
          No brand assortment data available for this study.
        </p>
      ) : (
        <div className="assortment-sku-eff-body">
          {headline ? <p className="assortment-chart-headline">{headline}</p> : null}
          <p className="assortment-chart-subtitle">
            SKU Share vs. Value Share | Index = SKU Share ÷ Value Share
          </p>
          <div className="assortment-sku-eff-chart">
            <OwnBrandSkuEfficiencyChart rows={rows} />
          </div>
          <div className="assortment-chart-legend assortment-sku-eff-legend">
            <span>
              <i className="swatch sku-eff-value" />
              Value Share
            </span>
            <span>
              <i className="swatch sku-eff-sku" />
              SKU Share
            </span>
            <span>
              <i className="swatch sku-eff-index" />
              Index (SKU ÷ Value)
            </span>
            <span>
              <i className="swatch sku-eff-efficient" />
              Efficient ({"<"} 100%)
            </span>
            <span>
              <i className="swatch sku-eff-own-ineff" />
              Own brand opportunity
            </span>
          </div>
          <p className="assortment-chart-formula">
            Index = SKU Share ÷ Value Share. Efficient when Index {"<"} 100% (fewer SKUs than
            value weight).
          </p>
          {opportunity ? (
            <p className="assortment-sku-eff-opportunity">{opportunity}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
