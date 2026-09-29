import { useEffect, useMemo, useState } from "react";

import type { PriceIndexData, PriceIndexRow } from "../../../api/analytics_types";
import { AnalyticsField } from "../AnalyticsField";
import { AnalyticsSection } from "../AnalyticsSection";
import { AnalyticsTabLayout } from "../AnalyticsTabLayout";
import { PriceIndexLineChart } from "../charts";
import type { AnalyticsControllerProps } from "../types";
import { getPriceIndexExportRows, isRevenueRow } from "../utils";

export function PriceIndexController({
  context,
  data,
  isLoading,
  error,
  onParamsChange,
}: AnalyticsControllerProps) {
  const [productName, setProductName] = useState("");
  const [referenceProduct, setReferenceProduct] = useState("");
  const [scale, setScale] = useState("0.8,0.9,1.0,1.1,1.2");
  const [selectedSeries, setSelectedSeries] = useState<string[]>([]);

  const { productNames } = context;

  useEffect(() => {
    if (!productName && productNames.length > 0) {
      setProductName(productNames[0]);
      setReferenceProduct(productNames[0]);
    }
  }, [productName, productNames]);

  useEffect(() => {
    const p: Record<string, string> = {};
    if (productName) p.product_name = productName;
    if (referenceProduct) p.reference_product = referenceProduct;
    if (scale.trim()) p.scale = scale.trim();
    onParamsChange(p);
  }, [productName, referenceProduct, scale, onParamsChange]);

  const payload = data && !Array.isArray(data) ? (data as PriceIndexData) : null;
  const allRows = payload?.rows ?? [];
  const shareRows = useMemo(
    () => allRows.filter((r: PriceIndexRow) => !isRevenueRow(r.name)),
    [allRows],
  );

  useEffect(() => {
    if (shareRows.length > 0 && selectedSeries.length === 0) {
      setSelectedSeries(shareRows.slice(0, 5).map((r) => r.name));
    }
  }, [shareRows, selectedSeries.length]);

  const toggleSeries = (name: string) => {
    setSelectedSeries((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  const controls = (
    <>
      <AnalyticsSection title="Price Index Global Configuration">
        <AnalyticsField label="Target SKU">
          <select value={productName} onChange={(e) => setProductName(e.target.value)}>
            {productNames.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </AnalyticsField>
        <AnalyticsField label="Reference SKU">
          <select value={referenceProduct} onChange={(e) => setReferenceProduct(e.target.value)}>
            {productNames.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </AnalyticsField>
        <AnalyticsField label="Scale" wide>
          <input
            value={scale}
            onChange={(e) => setScale(e.target.value)}
            placeholder="0.8,0.9,1.0,1.1,1.2"
          />
        </AnalyticsField>
      </AnalyticsSection>
      <AnalyticsSection title="Chart Output Series">
        <div className="analytics-series-checkboxes">
          {shareRows.map((r) => (
            <label key={r.name} className="analytics-checkbox">
              <input
                type="checkbox"
                checked={selectedSeries.includes(r.name)}
                onChange={() => toggleSeries(r.name)}
              />
              {r.name}
            </label>
          ))}
        </div>
      </AnalyticsSection>
    </>
  );

  const output = payload ? (
    <PriceIndexLineChart
      columns={payload.columns}
      rows={shareRows}
      selectedSeries={selectedSeries}
      yAxisLabel="Share %"
      valueScale={100}
    />
  ) : (
    <p className="analytics-empty">No price index data.</p>
  );

  return (
    <AnalyticsTabLayout
      title="Price Index & Revenues"
      controls={controls}
      output={output}
      isLoading={isLoading}
      error={error}
    />
  );
}

export function getPriceIndexControllerExportRows(data: unknown) {
  return getPriceIndexExportRows(data);
}
