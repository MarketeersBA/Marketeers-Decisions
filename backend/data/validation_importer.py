"""Parse validation wave Excel (Description + Product List) against an existing study."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from io import BytesIO
from typing import Any

import pandas as pd

from data.excel_importer import FileSource, _read_sheet, _seek_start
from data.validation_store import ValidationWave, ValidationWaveProduct
from model.study_schema import AttributeDef, StudyDocument


class ValidationImportError(ValueError):
    def __init__(self, message: str, *, row_errors: list[str] | None = None) -> None:
        super().__init__(message)
        self.row_errors = row_errors or []


def _parse_validation_date(raw: Any) -> str:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        raise ValidationImportError("Validation Date is required in Description sheet")
    if isinstance(raw, datetime):
        return raw.date().isoformat()
    if isinstance(raw, date):
        return raw.isoformat()
    text = str(raw).strip()
    if not text or text.lower() == "nan":
        raise ValidationImportError("Validation Date is required in Description sheet")
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    try:
        parsed = pd.to_datetime(text, errors="raise")
        return parsed.date().isoformat()
    except (ValueError, TypeError) as exc:
        raise ValidationImportError(f"Could not parse Validation Date: {text}") from exc


def _parse_validation_description(xls: pd.ExcelFile) -> tuple[str, str, str]:
    df = _read_sheet(xls, r"description", header=0)
    if df.empty:
        df = _read_sheet(xls, r"description", header=None)
    if df.empty:
        raise ValidationImportError("Description sheet is required")

    label_col = df.columns[0]
    value_col = df.columns[1] if len(df.columns) > 1 else df.columns[0]

    name = ""
    validation_date = ""
    notes = ""
    for _, row in df.iterrows():
        key = str(row[label_col]).strip() if pd.notna(row[label_col]) else ""
        val = row[value_col] if value_col in row.index else ""
        if not key:
            continue
        kl = key.lower()
        if kl == "validation name":
            name = str(val).strip()
        elif kl == "validation date":
            validation_date = _parse_validation_date(val)
        elif kl == "notes":
            notes = str(val).strip() if pd.notna(val) else ""

    if not name:
        raise ValidationImportError("Validation Name is required in Description sheet")
    if not validation_date:
        raise ValidationImportError("Validation Date is required in Description sheet")
    return name, validation_date, notes


def _attr_value_from_row(
    row: pd.Series,
    attr: AttributeDef,
    df: pd.DataFrame,
) -> Any:
    col = f"Base {attr.name}"
    if col not in df.columns:
        return None
    val = row[col]
    if pd.isna(val):
        return None
    if attr.attr_type == "Discrete":
        if attr.level_names:
            try:
                return attr.level_names.index(str(val).strip()) + 1
            except ValueError:
                return str(val).strip()
        return str(val).strip()
    try:
        return float(val)
    except (TypeError, ValueError):
        return val


def _parse_validation_product_list(
    xls: pd.ExcelFile,
    doc: StudyDocument,
) -> dict[str, ValidationWaveProduct]:
    df = _read_sheet(xls, r"product\s*list")
    if df.empty:
        raise ValidationImportError("Product List sheet is required")

    study_names = {p.name for p in doc.products}
    attributes = list(doc.attributes)

    sku_col = next((c for c in df.columns if "sku" in str(c).lower() and "name" in str(c).lower()), None)
    if sku_col is None:
        sku_col = df.columns[0]

    ms_col = next((c for c in df.columns if "market" in str(c).lower() and "share" in str(c).lower()), None)
    audit_col = next((c for c in df.columns if "audit" in str(c).lower() and "share" in str(c).lower()), None)
    wd_col = next((c for c in df.columns if str(c).upper() == "WD"), None)

    products: dict[str, ValidationWaveProduct] = {}
    row_errors: list[str] = []

    for idx, row in df.iterrows():
        name = str(row.get(sku_col, "")).strip()
        if not name or name.lower() == "nan":
            continue
        if name not in study_names:
            row_errors.append(f"Row {int(idx) + 2}: unknown SKU '{name}' (not in study)")
            continue

        ms = float(row[ms_col]) if ms_col and pd.notna(row[ms_col]) else 0.0
        audit = float(row[audit_col]) if audit_col and pd.notna(row[audit_col]) else ms

        attrs: dict[str, Any] = {}
        for attr in attributes:
            parsed = _attr_value_from_row(row, attr, df)
            if parsed is not None:
                attrs[attr.name] = parsed

        wd: float | None = None
        if wd_col and pd.notna(row[wd_col]):
            wd = float(row[wd_col])

        products[name] = ValidationWaveProduct(
            attributes=attrs,
            wd=wd,
            benchmark_share_pp=audit,
        )

    if row_errors:
        raise ValidationImportError("Product List validation failed", row_errors=row_errors)
    if not products:
        raise ValidationImportError("Product List contains no valid SKU rows")

    return products


def import_validation_workbook(
    source: FileSource,
    doc: StudyDocument,
    *,
    source_filename: str = "",
) -> ValidationWave:
    _seek_start(source)
    xls = pd.ExcelFile(source)
    name, validation_date, notes = _parse_validation_description(xls)
    products = _parse_validation_product_list(xls, doc)
    return ValidationWave(
        id=uuid.uuid4().hex,
        name=name,
        validation_date=validation_date,
        notes=notes,
        source_filename=source_filename,
        products=products,
    )
