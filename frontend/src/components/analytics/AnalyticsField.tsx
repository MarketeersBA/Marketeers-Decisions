import type { ReactNode } from "react";

interface AnalyticsFieldProps {
  label: string;
  wide?: boolean;
  children: ReactNode;
}

export function AnalyticsField({ label, wide, children }: AnalyticsFieldProps) {
  return (
    <label className={`analytics-field${wide ? " wide" : ""}`}>
      <span className="analytics-field-label">{label}</span>
      {children}
    </label>
  );
}
