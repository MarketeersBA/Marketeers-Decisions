import { useEffect, useState } from "react";

import type { CrossBrandData } from "../../../api/analytics_types";
import { AnalyticsField } from "../AnalyticsField";
import { AnalyticsSection } from "../AnalyticsSection";
import { AnalyticsTabLayout } from "../AnalyticsTabLayout";
import { CrossBrandHeatmap } from "../charts";
import type { AnalyticsControllerProps } from "../types";

export function BrandInteractionController({
  context,
  data,
  isLoading,
  error,
  onParamsChange,
}: AnalyticsControllerProps) {
  const [level, setLevel] = useState<"sku" | "group">("sku");
  const [driverProduct, setDriverProduct] = useState("");
  const { productNames, groupTypes, groupType, setGroupType } = context;

  useEffect(() => {
    if (!driverProduct && productNames.length > 0) {
      setDriverProduct(productNames[0]);
    }
  }, [driverProduct, productNames]);

  useEffect(() => {
    if (!driverProduct) return;
    const p: Record<string, string> = {
      level,
      driver_product: driverProduct,
      group_type: groupType,
    };
    onParamsChange(p);
  }, [level, driverProduct, groupType, onParamsChange]);

  const payload = data && !Array.isArray(data) ? (data as CrossBrandData) : null;

  const controls = (
    <AnalyticsSection title="Brand Interaction Global Configuration">
      <AnalyticsField label="Series level">
        <div className="analytics-radio-row">
          <label className="analytics-checkbox">
            <input
              type="radio"
              checked={level === "sku"}
              onChange={() => setLevel("sku")}
            />
            SKU
          </label>
          <label className="analytics-checkbox">
            <input
              type="radio"
              checked={level === "group"}
              onChange={() => setLevel("group")}
            />
            Group
          </label>
        </div>
      </AnalyticsField>
      {level === "group" && (
        <AnalyticsField label="Group type">
          <select value={groupType} onChange={(e) => setGroupType(e.target.value)}>
            {groupTypes.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </AnalyticsField>
      )}
      <AnalyticsField label="Driver SKU (price mover)">
        <select value={driverProduct} onChange={(e) => setDriverProduct(e.target.value)}>
          {productNames.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </AnalyticsField>
      <p className="analytics-hint">
        Price multipliers 0.9× / 1.0× / 1.1× on the driver; cells are share deltas
        {level === "group" ? " at group totals" : " per SKU"}.
      </p>
    </AnalyticsSection>
  );

  const output = payload ? (
    <CrossBrandHeatmap data={payload} />
  ) : (
    <p className="analytics-empty">No brand interaction data.</p>
  );

  return (
    <AnalyticsTabLayout
      title="Brand Interaction"
      controls={controls}
      output={output}
      isLoading={isLoading}
      error={error}
    />
  );
}
