import {
  DATA_SOURCE_OPTIONS,
  QUARTER_OPTIONS,
  buildYearOptions,
  formatDataPeriodParts,
  parseDataPeriod,
  type DataSourceOption,
} from "../lib/studyTrustOptions";

type StudyTrustFieldsProps = {
  dataPeriod: string;
  dataSource: string;
  onDataPeriodChange: (value: string) => void;
  onDataSourceChange: (value: string) => void;
  /** When false, values render as read-only text (not disabled inputs). */
  editing?: boolean;
  className?: string;
};

export function StudyTrustFields({
  dataPeriod,
  dataSource,
  onDataPeriodChange,
  onDataSourceChange,
  editing = true,
  className,
}: StudyTrustFieldsProps) {
  const { quarter, year } = parseDataPeriod(dataPeriod);
  const yearOptions = buildYearOptions();
  const yearInList = yearOptions.includes(year);

  const setQuarter = (q: number) => {
    onDataPeriodChange(formatDataPeriodParts(q, year));
  };

  const setYear = (y: number) => {
    onDataPeriodChange(formatDataPeriodParts(quarter, y));
  };

  const rootClass = [
    "study-trust-fields",
    editing ? "" : "study-trust-fields-readonly",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (!editing) {
    return (
      <div className={rootClass}>
        <div className="study-trust-info-item">
          <span className="study-trust-field-label">Data period</span>
          <span className="study-trust-info-value">
            Q{quarter} {year}
          </span>
        </div>
        <div className="study-trust-info-item">
          <span className="study-trust-field-label">Source</span>
          <span className="study-trust-info-value">{dataSource}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <div className="study-trust-field study-trust-field-period">
        <span className="study-trust-field-label">Data period</span>
        <div className="study-trust-period-row">
          <label className="study-trust-period-part">
            <span className="visually-hidden">Quarter</span>
            <select
              className="study-trust-select study-trust-select-quarter"
              value={quarter}
              onChange={(e) => setQuarter(parseInt(e.target.value, 10))}
              aria-label="Quarter"
            >
              {QUARTER_OPTIONS.map((q) => (
                <option key={q} value={q}>
                  Q{q}
                </option>
              ))}
            </select>
          </label>
          <label className="study-trust-period-part">
            <span className="visually-hidden">Year</span>
            <select
              className="study-trust-select study-trust-select-year"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
              aria-label="Year"
            >
              {!yearInList ? <option value={year}>{year}</option> : null}
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <label className="study-trust-field">
        <span className="study-trust-field-label">Source</span>
        <select
          className="study-trust-select"
          value={dataSource}
          onChange={(e) => onDataSourceChange(e.target.value as DataSourceOption)}
        >
          {DATA_SOURCE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
