import type { ReactNode } from "react";

interface AnalyticsSectionProps {
  title: string;
  children: ReactNode;
}

export function AnalyticsSection({ title, children }: AnalyticsSectionProps) {
  return (
    <section className="analytics-section">
      <h3 className="analytics-section-title">{title}</h3>
      <div className="analytics-section-body">{children}</div>
    </section>
  );
}
