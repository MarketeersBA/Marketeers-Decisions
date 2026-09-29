import { useCallback, useEffect, useState } from "react";

import { useStudyMeta } from "../api/hooks";
import {
  CURRENCY_PRESETS,
  DEFAULT_CURRENCY_SYMBOL,
  DEFAULT_SIZE_UNIT_LABEL,
  SIZE_UNIT_PRESETS,
  resolveUnitField,
  unitSelectState,
} from "../lib/studyDisplay";

export function useStudyDisplayUnitsDraft(slug: string | undefined) {
  const { data, isLoading, isError } = useStudyMeta(slug);
  const [currencySelect, setCurrencySelect] = useState(DEFAULT_CURRENCY_SYMBOL);
  const [currencyCustom, setCurrencyCustom] = useState("");
  const [sizeUnitSelect, setSizeUnitSelect] = useState(DEFAULT_SIZE_UNIT_LABEL);
  const [sizeUnitCustom, setSizeUnitCustom] = useState("");

  const syncFromData = useCallback(() => {
    if (!data) return;
    const cur = unitSelectState(
      data.price_currency_symbol,
      CURRENCY_PRESETS,
      DEFAULT_CURRENCY_SYMBOL,
    );
    setCurrencySelect(cur.select);
    setCurrencyCustom(cur.custom);
    const size = unitSelectState(data.size_unit_label, SIZE_UNIT_PRESETS, DEFAULT_SIZE_UNIT_LABEL);
    setSizeUnitSelect(size.select);
    setSizeUnitCustom(size.custom);
  }, [data]);

  useEffect(() => {
    syncFromData();
  }, [syncFromData]);

  const getPayload = useCallback(() => {
    return {
      price_currency_symbol: resolveUnitField(
        currencySelect,
        currencyCustom,
        CURRENCY_PRESETS,
        DEFAULT_CURRENCY_SYMBOL,
      ),
      size_unit_label: resolveUnitField(
        sizeUnitSelect,
        sizeUnitCustom,
        SIZE_UNIT_PRESETS,
        DEFAULT_SIZE_UNIT_LABEL,
      ),
    };
  }, [currencySelect, currencyCustom, sizeUnitSelect, sizeUnitCustom]);

  return {
    data,
    isLoading,
    isError,
    currencySelect,
    currencyCustom,
    sizeUnitSelect,
    sizeUnitCustom,
    setCurrencySelect,
    setCurrencyCustom,
    setSizeUnitSelect,
    setSizeUnitCustom,
    getPayload,
    reset: syncFromData,
  };
}

export type StudyDisplayUnitsDraft = ReturnType<typeof useStudyDisplayUnitsDraft>;
