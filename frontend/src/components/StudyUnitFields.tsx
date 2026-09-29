import {
  CURRENCY_PRESETS,
  CUSTOM_SELECT_VALUE,
  DEFAULT_CURRENCY_SYMBOL,
  DEFAULT_SIZE_UNIT_LABEL,
  SIZE_UNIT_PRESETS,
} from "../lib/studyDisplay";

export type StudyUnitFieldsProps = {
  currencySelect: string;
  currencyCustom: string;
  onCurrencySelect: (value: string) => void;
  onCurrencyCustom: (value: string) => void;
  sizeUnitSelect: string;
  sizeUnitCustom: string;
  onSizeUnitSelect: (value: string) => void;
  onSizeUnitCustom: (value: string) => void;
};

export function StudyUnitFields({
  currencySelect,
  currencyCustom,
  onCurrencySelect,
  onCurrencyCustom,
  sizeUnitSelect,
  sizeUnitCustom,
  onSizeUnitSelect,
  onSizeUnitCustom,
}: StudyUnitFieldsProps) {
  return (
    <>
      <div className="form-row">
        <div className="form-group">
          <label>Price currency</label>
          <select
            value={currencySelect}
            onChange={(e) => onCurrencySelect(e.target.value)}
          >
            {CURRENCY_PRESETS.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
            <option value={CUSTOM_SELECT_VALUE}>Custom…</option>
          </select>
          {currencySelect === CUSTOM_SELECT_VALUE ? (
            <input
              type="text"
              style={{ marginTop: "0.5rem" }}
              maxLength={8}
              value={currencyCustom}
              onChange={(e) => onCurrencyCustom(e.target.value)}
              placeholder={DEFAULT_CURRENCY_SYMBOL}
            />
          ) : null}
        </div>
        <div className="form-group">
          <label>Size unit</label>
          <select
            value={sizeUnitSelect}
            onChange={(e) => onSizeUnitSelect(e.target.value)}
          >
            {SIZE_UNIT_PRESETS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
            <option value={CUSTOM_SELECT_VALUE}>Custom…</option>
          </select>
          {sizeUnitSelect === CUSTOM_SELECT_VALUE ? (
            <input
              type="text"
              style={{ marginTop: "0.5rem" }}
              maxLength={16}
              value={sizeUnitCustom}
              onChange={(e) => onSizeUnitCustom(e.target.value)}
              placeholder={DEFAULT_SIZE_UNIT_LABEL}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
