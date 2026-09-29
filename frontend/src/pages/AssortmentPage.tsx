import { useCallback, useState } from "react";

import { AssortmentIncrementalPanel } from "../components/AssortmentIncrementalPanel";
import type { IntroStep } from "../components/assortment/cumulativeIntroUtils";
// OwnBrandSkuEfficiencyPanel temporarily disabled
// import { OwnBrandSkuEfficiencyPanel } from "../components/assortment/OwnBrandSkuEfficiencyPanel";

import "./pages.css";
import "./optimizer.css";
import "./assortment.css";

const recClass = {
  Keep: "cell-in",
  Watch: "cell-watch",
  "Push WD": "cell-push",
} as const;

const recLabel = {
  Keep: "Keep",
  Watch: "Watch",
  "Push WD": "Push WD",
} as const;

function formatPsr(psr: number | null): string {
  if (psr == null || !Number.isFinite(psr)) return "—";
  return psr.toFixed(2);
}

function formatWd(wd: number | null): string {
  if (wd == null || !Number.isFinite(wd)) return "—";
  return wd.toFixed(0);
}

export function AssortmentPage() {
  const [steps, setSteps] = useState<IntroStep[]>([]);
  const [headline, setHeadline] = useState<string | null>(null);

  const handleResultsChange = useCallback((nextSteps: IntroStep[], nextHeadline: string | null) => {
    setSteps(nextSteps);
    setHeadline(nextHeadline);
  }, []);

  return (
    <div className="assortment-page">
      <div className="opt-stack">
        {/* <OwnBrandSkuEfficiencyPanel /> */}

        <AssortmentIncrementalPanel onResultsChange={handleResultsChange} />

        {headline ? (
          <div className="opt-card assortment-headline-card">
            <div className="opt-table-head">
              <h2 className="opt-section-title">Headline insight</h2>
              <p className="opt-section-sub">Auto-generated from introduction order and WD push flags</p>
            </div>
            <p className="assortment-note push-note">
              <strong>{headline}</strong>
              {steps.some((s) => s.pushWd)
                ? " — prioritize distribution investment on flagged SKUs before expanding lower-efficiency items."
                : null}
            </p>
          </div>
        ) : null}

        <div className="opt-card">
          <div className="opt-table-head">
            <h2 className="opt-section-title">Recommended assortment</h2>
            <p className="opt-section-sub">
              Keep / Watch / Push WD for the current group and filter context — derived from
              cumulative introduction, Product Sales Rate, and WD vs anchor.
            </p>
          </div>

          {steps.length === 0 ? (
            <p className="assortment-inc-empty assortment-table-empty">
              Run cumulative introduction above to populate recommendations.
            </p>
          ) : (
            <>
              <table className="assortment-matrix assortment-matrix--list">
                <thead>
                  <tr>
                    <th className="assortment-sku-col">SKU</th>
                    <th>Step</th>
                    <th>WD</th>
                    <th>PSR</th>
                    <th>Recommendation</th>
                    <th className="assortment-why-col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((row) => (
                    <tr key={row.productName}>
                      <td className="assortment-sku-name">{row.productName}</td>
                      <td>{row.step}</td>
                      <td>{formatWd(row.wd)}</td>
                      <td>{formatPsr(row.psr)}</td>
                      <td className={recClass[row.recommendation]}>{recLabel[row.recommendation]}</td>
                      <td className="assortment-why">{row.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="assortment-legend">
                <span>
                  <i className="assortment-dot cell-in" />
                  Keep / in lineup
                </span>
                <span>
                  <i className="assortment-dot cell-watch" />
                  Watch — low efficiency
                </span>
                <span>
                  <i className="assortment-dot cell-push" />
                  Push WD
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
