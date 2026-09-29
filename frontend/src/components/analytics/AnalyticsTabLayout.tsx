import type { ReactNode } from "react";

interface AnalyticsTabLayoutProps {
  title: string;
  controls: ReactNode;
  output: ReactNode;
  isLoading?: boolean;
  error?: Error | null;
}

export function AnalyticsTabLayout({
  title,
  controls,
  output,
  isLoading,
  error,
}: AnalyticsTabLayoutProps) {
  return (
    <div className="analytics-tab-layout">
      <div className="analytics-controls-pane">{controls}</div>
      <div className="analytics-chart-pane">
        <h2 className="analytics-chart-title">{title}</h2>
        {isLoading ? <p className="analytics-status">Loading…</p> : null}
        {error ? (
          <p className="error-text analytics-status">
            Failed to load analytics. {error.message || ""}
          </p>
        ) : null}
        {!isLoading && !error ? output : null}
      </div>
    </div>
  );
}
