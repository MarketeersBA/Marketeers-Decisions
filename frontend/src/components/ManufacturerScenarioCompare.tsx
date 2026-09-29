import { useEffect, useMemo, useState } from "react";

import type { ResultRow } from "../api/types";
import {
  aggregateManufacturerScope,
  toScenarioComparePoints,
} from "../lib/scenarioCompareChart";
import { ScenarioCompareChart } from "./ScenarioCompareChart";

export type OwnBrandOption = {
  name: string;
  skuNames: string[];
};

interface Props {
  rows: ResultRow[];
  manufacturerSkuNames: Set<string>;
  manufacturerLabel: string;
  currentScenarioLabel: string;
  /** Own brands (with their SKUs). When set, a checkbox list filters the chart. */
  ownBrands?: OwnBrandOption[];
}

export function ManufacturerScenarioCompare({
  rows,
  manufacturerSkuNames,
  manufacturerLabel,
  currentScenarioLabel,
  ownBrands = [],
}: Props) {
  const brandNamesKey = ownBrands.map((b) => b.name).join("\0");
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(
    () => new Set(ownBrands.map((b) => b.name)),
  );

  useEffect(() => {
    setSelectedBrands(new Set(ownBrands.map((b) => b.name)));
  }, [brandNamesKey]); // eslint-disable-line react-hooks/exhaustive-deps -- sync when brand list changes

  const scopedSkuNames = useMemo(() => {
    if (ownBrands.length === 0) return manufacturerSkuNames;
    const names = new Set<string>();
    for (const brand of ownBrands) {
      if (!selectedBrands.has(brand.name)) continue;
      for (const sku of brand.skuNames) {
        if (manufacturerSkuNames.has(sku)) names.add(sku);
      }
    }
    return names;
  }, [ownBrands, selectedBrands, manufacturerSkuNames]);

  const chartData = useMemo(() => {
    if (!rows.length || scopedSkuNames.size === 0) return null;
    const agg = aggregateManufacturerScope(rows, scopedSkuNames);
    return toScenarioComparePoints(
      agg.baseVol,
      agg.newVol,
      agg.baseVal,
      agg.newVal,
      agg.baseRev,
      agg.newRev,
      currentScenarioLabel,
    );
  }, [rows, scopedSkuNames, currentScenarioLabel]);

  const selectedCount = selectedBrands.size;
  const scopeHint =
    ownBrands.length === 0
      ? (
          <>
            Scope: manufacturer — <b>{manufacturerLabel}</b>.
          </>
        )
      : selectedCount === 0
        ? <>Scope: no brands selected.</>
        : selectedCount === ownBrands.length
          ? (
              <>
                Scope: manufacturer — <b>{manufacturerLabel}</b> (all own brands).
              </>
            )
          : (
              <>
                Scope: {selectedCount} of {ownBrands.length} own brands.
              </>
            );

  const toggleBrand = (name: string) => {
    setSelectedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const setAllBrands = (checked: boolean) => {
    setSelectedBrands(checked ? new Set(ownBrands.map((b) => b.name)) : new Set());
  };

  return (
    <section className="runner-scenario-compare">
      <div className="runner-scenario-compare-head">
        <div>
          <h2 className="runner-scenario-compare-title">Base vs {currentScenarioLabel}</h2>
          <p className="runner-scenario-compare-sub">
            Volume and value share (columns) with revenue index (line) across scenarios.
            {" "}
            {scopeHint}
          </p>
        </div>
      </div>

      <div
        className={
          ownBrands.length > 0
            ? "runner-scenario-compare-body has-brands"
            : "runner-scenario-compare-body"
        }
      >
        {ownBrands.length > 0 ? (
          <aside className="runner-scenario-compare-brands" aria-label="Own brands">
            <div className="runner-scenario-brands-head">
              <h3>Own brands</h3>
              <div className="runner-scenario-brands-actions">
                <button type="button" className="linkish" onClick={() => setAllBrands(true)}>
                  All
                </button>
                <span aria-hidden="true">·</span>
                <button type="button" className="linkish" onClick={() => setAllBrands(false)}>
                  None
                </button>
              </div>
            </div>
            <p className="runner-scenario-brands-hint">
              Check brands to include in the chart.
            </p>
            <div className="scenario-checkbox-list runner-brand-checkbox-list">
              {ownBrands.map((brand) => {
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
                      <span className="sc-desc">
                        {brand.skuNames.length} SKU{brand.skuNames.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          </aside>
        ) : null}

        <div className="runner-scenario-compare-chart">
          {chartData ? (
            <ScenarioCompareChart data={chartData} />
          ) : (
            <p className="runner-scenario-compare-empty">
              {ownBrands.length > 0 && selectedCount === 0
                ? "Select at least one own brand to see the comparison."
                : "Comparison metrics are not available."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
