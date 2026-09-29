import { useMemo } from "react";

import { useSession } from "../stores/sessionStore";
import { fmtNumber } from "../shell/format";

export const DEFAULT_CURRENCY_SYMBOL = "€";
export const DEFAULT_SIZE_UNIT_LABEL = "L";

export const CURRENCY_PRESETS = ["€", "$", "£", "SAR"] as const;
export const SIZE_UNIT_PRESETS = ["L", "kg", "ml", "unit"] as const;

export const CUSTOM_SELECT_VALUE = "__custom__";

export function isPresetValue(
  value: string,
  presets: readonly string[],
): boolean {
  return presets.includes(value);
}

/** Resolve select + optional custom field into the stored symbol/label. */
export function resolveUnitField(
  selectValue: string,
  customValue: string,
  _presets: readonly string[],
  fallback: string,
): string {
  if (selectValue === CUSTOM_SELECT_VALUE) {
    const trimmed = customValue.trim();
    return trimmed || fallback;
  }
  return selectValue || fallback;
}

/** Initialize select state from a stored value. */
export function unitSelectState(
  stored: string | undefined,
  presets: readonly string[],
  fallback: string,
): { select: string; custom: string } {
  const value = (stored?.trim() || fallback).trim();
  if (isPresetValue(value, presets)) {
    return { select: value, custom: "" };
  }
  return { select: CUSTOM_SELECT_VALUE, custom: value };
}

export function perUnitLabel(currencySymbol: string, sizeUnit: string): string {
  return `${currencySymbol}/${sizeUnit}`;
}

export function fmtPrice(
  value: number | null | undefined,
  symbol: string,
  decimals = 2,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${symbol}${fmtNumber(value, decimals)}`;
}

export function fmtPerUnitPrice(
  value: number | null | undefined,
  symbol: string,
  sizeUnit: string,
  decimals = 2,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${fmtPrice(value, symbol, decimals)}/${sizeUnit}`;
}

export interface StudyDisplayUnits {
  currencySymbol: string;
  sizeUnitLabel: string;
  perUnitLabel: string;
  fmtPrice: (value: number | null | undefined, decimals?: number) => string;
  fmtPerUnitPrice: (
    value: number | null | undefined,
    decimals?: number,
  ) => string;
}

export function studyDisplayFromContext(
  currencySymbol?: string,
  sizeUnitLabel?: string,
): StudyDisplayUnits {
  const sym = currencySymbol?.trim() || DEFAULT_CURRENCY_SYMBOL;
  const unit = sizeUnitLabel?.trim() || DEFAULT_SIZE_UNIT_LABEL;
  const perUnit = perUnitLabel(sym, unit);
  return {
    currencySymbol: sym,
    sizeUnitLabel: unit,
    perUnitLabel: perUnit,
    fmtPrice: (value, decimals) => fmtPrice(value, sym, decimals),
    fmtPerUnitPrice: (value, decimals) =>
      fmtPerUnitPrice(value, sym, unit, decimals),
  };
}

export function useStudyDisplay(): StudyDisplayUnits {
  const { session } = useSession();
  return useMemo(
    () =>
      studyDisplayFromContext(
        session?.study?.currencySymbol,
        session?.study?.sizeUnitLabel,
      ),
    [session?.study?.currencySymbol, session?.study?.sizeUnitLabel],
  );
}
