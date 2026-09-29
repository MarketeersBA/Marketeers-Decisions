export const DATA_SOURCE_OPTIONS = ["NIQ / Circana", "Retailer EPOS"] as const;

export type DataSourceOption = (typeof DATA_SOURCE_OPTIONS)[number];

export const DEFAULT_DATA_SOURCE: DataSourceOption = "NIQ / Circana";

export const QUARTER_OPTIONS = [1, 2, 3, 4] as const;

export function formatDataPeriod(date: Date): string {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return formatDataPeriodParts(quarter, date.getFullYear());
}

export function formatDataPeriodParts(quarter: number, year: number): string {
  const q = Math.min(4, Math.max(1, quarter));
  return `Q${q} ${year}`;
}

export function parseDataPeriod(value: string): { quarter: number; year: number } {
  const match = value.trim().match(/^Q\s*([1-4])\s+(\d{4})$/i);
  if (match) {
    return { quarter: parseInt(match[1], 10), year: parseInt(match[2], 10) };
  }
  const now = new Date();
  return {
    quarter: Math.floor(now.getMonth() / 3) + 1,
    year: now.getFullYear(),
  };
}

/** Calendar years for the year dropdown (newest first). */
export function buildYearOptions(pastYears = 6, futureYears = 2): number[] {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let y = current + futureYears; y >= current - pastYears; y -= 1) {
    years.push(y);
  }
  return years;
}

export function defaultDataPeriod(): string {
  return formatDataPeriod(new Date());
}

export function normalizeDataPeriod(value: string): string {
  const { quarter, year } = parseDataPeriod(value);
  return formatDataPeriodParts(quarter, year);
}

export function normalizeDataSource(value: string): DataSourceOption {
  const trimmed = value.trim();
  if ((DATA_SOURCE_OPTIONS as readonly string[]).includes(trimmed)) {
    return trimmed as DataSourceOption;
  }
  return DEFAULT_DATA_SOURCE;
}
