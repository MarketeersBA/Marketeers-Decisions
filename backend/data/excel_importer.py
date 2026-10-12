"""Excel import for study creation (ports StudyStructure.cs readExcelTemplate)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from io import BytesIO
from numbers import Integral, Real
from pathlib import Path
from typing import Any, BinaryIO, Union

import pandas as pd

from model.study_schema import (
    AttributeDef,
    ConditionalLevelRow,
    GroupDef,
    ProductDef,
    RespondentSegmentation,
    SegmentDef,
    StudyDocument,
    StudyMeta,
)


FileSource = Union[str, Path, BinaryIO, BytesIO]

_RESPONDENT_HEADERS = frozenset({"Respondent", "RespondentID", "Respondent Id", "ID"})
_WEIGHT_HEADERS = frozenset({"RLH", "RespondentWeight", "Respondent Weight", "Weight"})
_SKIP_HBU_HEADERS = frozenset({"NONE", "NAN", ""})
_PRODUCT_ID_RE = re.compile(r"^ProductID(\d+)$", re.I)
_ATTR_LEVEL_RE = re.compile(r"^(.+?)Level(\d+)$", re.I)
_SKU_HEADER_RE = re.compile(r"^SKU\s*(\d+)$", re.I)


class ExcelImportError(ValueError):
    pass


def format_cell_text(val: Any) -> str:
    """Text for an Excel cell. Numeric values drop binary float noise."""
    if val is None:
        return ""
    try:
        if pd.isna(val):
            return ""
    except (TypeError, ValueError):
        pass
    if isinstance(val, bool):
        return str(val)
    if isinstance(val, Integral):
        return str(int(val))
    if isinstance(val, Real):
        return _format_number(float(val))
    text = str(val).strip()
    if re.fullmatch(r"-?\d+\.\d+", text):
        try:
            return _format_number(float(text))
        except ValueError:
            return text
    return text


def _format_number(num: float) -> str:
    if num.is_integer():
        return str(int(num))
    rounded = round(num, 12)
    return f"{rounded:.12f}".rstrip("0").rstrip(".")


def _seek_start(source: FileSource) -> None:
    if hasattr(source, "seek"):
        source.seek(0)


def _flatten_columns(columns: Any) -> list[str]:
    flat: list[str] = []
    for col in columns:
        if isinstance(col, tuple):
            parts = [str(p).strip() for p in col if p is not None and str(p).strip().lower() != "nan"]
            flat.append(" ".join(parts).strip() or str(col))
        else:
            flat.append(str(col).strip())
    return flat


def _unique_headers(headers: list[str]) -> list[str]:
    """Disambiguate duplicate Excel headers (e.g. two relative levels both named ``0.1``)."""
    seen: dict[str, int] = {}
    unique: list[str] = []
    for header in headers:
        count = seen.get(header, 0)
        seen[header] = count + 1
        unique.append(header if count == 0 else f"{header}__dup{count}")
    return unique


def _is_reserved_hbu_header(header: str) -> bool:
    if header in _RESPONDENT_HEADERS or header in _WEIGHT_HEADERS:
        return True
    if _PRODUCT_ID_RE.match(header):
        return True
    if _ATTR_LEVEL_RE.match(header):
        return True
    return False


def _coerce_numeric_series(series: pd.Series | pd.DataFrame, *, as_int: bool = False) -> pd.Series:
    if isinstance(series, pd.DataFrame):
        series = series.iloc[:, 0]
    out = pd.to_numeric(series, errors="coerce")
    if as_int:
        return out.fillna(0).astype(int)
    return out.fillna(0.0)


def _dedupe_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Keep first occurrence when rename produced duplicate column names."""
    if not df.columns.duplicated().any():
        return df
    return df.loc[:, ~df.columns.duplicated()].copy()


def _find_sheet(xls: pd.ExcelFile, pattern: str) -> str | None:
    pat = re.compile(pattern, re.I)
    for name in xls.sheet_names:
        if pat.search(name):
            return name
    return None


def _read_sheet(xls: pd.ExcelFile, pattern: str, header: int | None = 0) -> pd.DataFrame:
    sheet = _find_sheet(xls, pattern)
    if sheet is None:
        return pd.DataFrame()
    return pd.read_excel(xls, sheet_name=sheet, header=header)


@dataclass
class ImportedStudy:
    document: StudyDocument
    hbu: pd.DataFrame


def import_design_sheet(source: FileSource) -> StudyDocument:
    """Parse design Excel workbook into StudyDocument (without HBU)."""
    _seek_start(source)
    xls = pd.ExcelFile(source)
    meta = _parse_description(xls)
    attributes, attr_levels = _parse_attributes(xls)
    products = _parse_products(xls, attributes)
    segments, seg_shares = _parse_segments(xls)
    groups = _parse_groups(xls, products)
    if groups:
        meta.use_grouping = True
    resp_seg = _parse_segmentation(xls)
    excluded = _parse_excluded_sales(xls)
    conditional = _parse_conditional_levels(xls, products, attributes)

    meta.products_count = len(products)
    doc = StudyDocument(
        meta=meta,
        attributes=attributes,
        products=products,
        conditional_levels=conditional,
        segments=segments,
        segment_shares_wd=seg_shares,
        groups=groups,
        respondent_segmentation=resp_seg,
        excluded_sales_units=excluded,
    )
    # Store discrete level names on attributes
    for attr in doc.attributes:
        if attr.name in attr_levels:
            attr.level_names = attr_levels[attr.name]
    return doc


def import_hbu_sheet(source: FileSource, doc: StudyDocument) -> pd.DataFrame:
    """Parse HBU Excel and map named columns to ProductID / AttributeLevel fields."""
    _seek_start(source)
    xls = pd.ExcelFile(source)
    sheet = xls.sheet_names[0]
    raw = pd.read_excel(xls, sheet_name=sheet, header=0)
    raw.columns = _unique_headers(_flatten_columns(raw.columns))

    rename_map = _build_hbu_column_map(raw.columns.tolist(), doc)
    if not rename_map:
        raise ExcelImportError("Could not map HBU columns to study products/attributes")

    has_respondent = any(h in raw.columns for h in _RESPONDENT_HEADERS)
    has_product_cols = any(p.name in raw.columns for p in doc.products) or any(
        _PRODUCT_ID_RE.match(str(h)) for h in raw.columns
    )
    if not has_respondent and not has_product_cols:
        raise ExcelImportError("HBU sheet missing Respondent column and product name columns")

    hbu_df = raw.rename(columns=rename_map)
    hbu_df = _dedupe_columns(hbu_df)

    for src, dst in (
        ("Respondent", "RespondentID"),
        ("Respondent Id", "RespondentID"),
        ("ID", "RespondentID"),
        ("RLH", "RespondentWeight"),
        ("Respondent Weight", "RespondentWeight"),
        ("Weight", "RespondentWeight"),
    ):
        if src in hbu_df.columns and dst not in hbu_df.columns:
            hbu_df = hbu_df.rename(columns={src: dst})

    standard_targets = set(rename_map.values()) | {"RespondentID", "RespondentWeight"}
    keep_cols = list(dict.fromkeys(c for c in hbu_df.columns if c in standard_targets))
    if not keep_cols:
        raise ExcelImportError("HBU mapping produced no usable columns")
    hbu_df = hbu_df[keep_cols].copy()
    hbu_df = _dedupe_columns(hbu_df)

    for col in list(hbu_df.columns):
        hbu_df[col] = _coerce_numeric_series(
            hbu_df[col],
            as_int=(col == "RespondentID"),
        )

    if "RespondentID" not in hbu_df.columns:
        hbu_df.insert(0, "RespondentID", range(1, len(hbu_df) + 1))

    if "RespondentWeight" not in hbu_df.columns:
        hbu_df["RespondentWeight"] = 1.0

    expected = len(_expected_hbu_columns(doc))
    if len(hbu_df.columns) < min(expected, 3):
        raise ExcelImportError(
            f"HBU mapped column count {len(hbu_df.columns)} too low (expected ~{expected})"
        )

    has_sku = any(a.is_sku or a.name.upper() == "SKU" for a in doc.attributes)
    if has_sku and doc.products:
        pid_cols = [c for c in hbu_df.columns if _PRODUCT_ID_RE.match(str(c))]
        if len(pid_cols) < len(doc.products):
            raise ExcelImportError(
                f"HBU mapped {len(pid_cols)} ProductID columns but study has "
                f"{len(doc.products)} products (Arabic/non-matching headers need "
                f"positional product columns before attribute levels)"
            )

    doc.meta.respondents_count = len(hbu_df)
    return hbu_df


def _build_hbu_column_map(headers: list[str], doc: StudyDocument) -> dict[str, str]:
    """Map HBU header names to standard ProductID / AttrLevel column names.

    When product headers do not match design names (e.g. Arabic labels), remaining
    columns are assigned positionally: product utilities in product-list order,
    then each non-SKU attribute's levels.
    """
    mapping: dict[str, str] = {}
    used_targets: set[str] = set()
    product_by_name = {p.name: p for p in doc.products}
    product_by_id = {p.product_id: p for p in doc.products}

    def _add_map(src: str, target: str) -> None:
        if target in used_targets:
            return
        mapping[src] = target
        used_targets.add(target)

    def _skippable(header: str) -> bool:
        return (
            header in mapping
            or _is_reserved_hbu_header(header)
            or header.upper() in _SKIP_HBU_HEADERS
        )

    for header in headers:
        if _PRODUCT_ID_RE.match(header):
            _add_map(header, header)
        else:
            level_match = _ATTR_LEVEL_RE.match(header)
            if level_match:
                _add_map(header, header)

    for header in headers:
        if header in mapping:
            continue
        if header in product_by_name:
            p = product_by_name[header]
            _add_map(header, f"ProductID{p.product_id}")
            continue
        sku_match = _SKU_HEADER_RE.match(header)
        if sku_match:
            pid = int(sku_match.group(1))
            if pid in product_by_id:
                _add_map(header, f"ProductID{pid}")

    missing_pids = [
        p.product_id for p in doc.products if f"ProductID{p.product_id}" not in used_targets
    ]
    free_headers = [h for h in headers if not _skippable(h)]
    free_idx = 0
    for pid in missing_pids:
        if free_idx >= len(free_headers):
            break
        _add_map(free_headers[free_idx], f"ProductID{pid}")
        free_idx += 1

    attr_level_headers = [h for h in headers if not _skippable(h)]
    idx = 0
    for attr in doc.attributes:
        if attr.is_sku or attr.name.upper() == "SKU":
            continue
        count = attr.level_count or len(attr.level_names) or 0
        for i in range(1, count + 1):
            if idx >= len(attr_level_headers):
                break
            src = attr_level_headers[idx]
            _add_map(src, f"{attr.name}Level{i}")
            idx += 1
    return mapping


def import_study(design_source: FileSource, hbu_source: FileSource) -> ImportedStudy:
    doc = import_design_sheet(design_source)
    hbu = import_hbu_sheet(hbu_source, doc)
    return ImportedStudy(document=doc, hbu=hbu)


def _looks_like_header(row: pd.Series) -> bool:
    first = str(row.iloc[0]).lower()
    return "respondent" in first or "id" in first


def _expected_hbu_columns(doc: StudyDocument) -> list[str]:
    cols = ["RespondentID", "RespondentWeight"]
    for attr in doc.attributes:
        if attr.is_sku or attr.name.upper() == "SKU":
            for p in doc.products:
                cols.append(f"ProductID{p.product_id}")
        else:
            count = max(attr.level_count, len(attr.level_names), 1)
            for i in range(1, count + 1):
                cols.append(f"{attr.name}Level{i}")
    return cols


def _parse_description(xls: pd.ExcelFile) -> StudyMeta:
    meta = StudyMeta()
    df = _read_sheet(xls, r"description", header=0)
    if df.empty:
        df = _read_sheet(xls, r"description", header=None)
    if df.empty:
        return meta

    # Study name is the second column header (e.g. "ELARABY PTV 2021")
    if len(df.columns) > 1:
        meta.study_name = str(df.columns[1]).strip()

    label_col = df.columns[0]
    value_col = df.columns[1] if len(df.columns) > 1 else df.columns[0]

    for _, row in df.iterrows():
        key = str(row[label_col]).strip() if pd.notna(row[label_col]) else ""
        val = row[value_col] if value_col in row.index else ""
        if not key:
            continue
        kl = key.lower()
        if kl == "msu":
            meta.msu = float(val or 1)
        elif kl == "sales unit":
            meta.su = float(val or 1)
        elif kl == "vsu":
            meta.vsu = float(val or 0)
        elif kl == "study description":
            meta.study_description = str(val)
        elif kl == "company name":
            meta.company_name = str(val)
        elif "location" in kl:
            meta.company_location = str(val)
    meta.exponent_factor = 1.0
    return meta


def _parse_attributes(xls: pd.ExcelFile) -> tuple[list[AttributeDef], dict[str, list[str]]]:
    df = _read_sheet(xls, r"^attributes?$")
    if df.empty:
        return [], {}
    attrs: list[AttributeDef] = []
    level_names: dict[str, list[str]] = {}
    cols = {c.lower().replace(" ", "_"): c for c in df.columns}

    for _, row in df.iterrows():
        name_col = cols.get("attribute_name", "Attribute Name")
        name = str(row.get(name_col, row.iloc[0])).strip()
        if not name or name.lower() == "nan":
            continue
        discrete = str(row.get(cols.get("discrete_type", "Discrete Type"), 0)) == "1"
        conditional = str(row.get(cols.get("conditional_type", "Conditional Type"), 0)) == "1"
        attr_type = "Discrete" if discrete else ("Conditional" if conditional else "Discrete")
        level_count = int(row.get(cols.get("levels_count", "Levels Count"), 0) or 0)
        attrs.append(
            AttributeDef(
                name=name if name.upper() != "SKU" else "SKU",
                attr_type=attr_type,
                level_count=level_count,
                is_sku=name.upper() == "SKU",
                is_size=name.lower() == "size",
                included=True,
                visible=True,
            )
        )
        # Discrete level names from "{Name} Attribute Levels" sheet
        levels_df = _read_sheet(xls, rf"{re.escape(name)}\s*attribute\s*levels", header=0)
        if not levels_df.empty:
            level_names[name] = _extract_level_names_from_sheet(levels_df, name)
        list_df = _read_sheet(xls, rf"{re.escape(name)}.*list", header=0)
        if not list_df.empty and "Name" in list_df.columns:
            level_names[name] = [format_cell_text(v) for v in list_df["Name"].dropna().tolist()]
    return attrs, level_names


def _extract_level_names_from_sheet(df: pd.DataFrame, attr_name: str) -> list[str]:
    """Read level names from row 0 of an attribute levels sheet (e.g. Inch)."""
    if df.empty:
        return []
    row0 = df.iloc[0]
    names: list[str] = []
    for col in df.columns:
        val = row0[col]
        if pd.isna(val):
            continue
        s = format_cell_text(val)
        if not s or s.lower() in ("nan", "levels"):
            continue
        col_str = str(col)
        if re.match(r"Level\s*\d+", col_str, re.I):
            names.append(s)
        elif s.lower() != attr_name.lower():
            names.append(s)
    return names


def _parse_products(xls: pd.ExcelFile, attributes: list[AttributeDef]) -> list[ProductDef]:
    df = _read_sheet(xls, r"product\s*list")
    if df.empty:
        return []
    products: list[ProductDef] = []
    names_seen: list[str] = []
    attr_map = {a.name: a for a in attributes}

    for _, row in df.iterrows():
        sku_col = next((c for c in df.columns if "sku" in c.lower() and "name" in c.lower()), None)
        if sku_col is None:
            sku_col = df.columns[0]
        name = str(row.get(sku_col, "")).strip()
        if not name or name.lower() == "nan":
            continue
        if name not in names_seen:
            names_seen.append(name)
        pid = names_seen.index(name) + 1

        base_attrs: dict[str, Any] = {}
        for attr in attributes:
            col = f"Base {attr.name}"
            if col not in df.columns:
                continue
            val = row[col]
            if attr.attr_type == "Discrete":
                if attr.level_names:
                    try:
                        base_attrs[attr.name] = attr.level_names.index(format_cell_text(val)) + 1
                    except ValueError:
                        base_attrs[attr.name] = format_cell_text(val)
                else:
                    base_attrs[attr.name] = format_cell_text(val)
            else:
                try:
                    base_attrs[attr.name] = float(val)
                except (TypeError, ValueError):
                    base_attrs[attr.name] = val

        ms_col = next((c for c in df.columns if "market" in c.lower() and "share" in c.lower()), None)
        audit_col = next((c for c in df.columns if "audit" in c.lower() and "share" in c.lower()), None)
        wd_col = next((c for c in df.columns if c.upper() == "WD"), None)
        company_col = next((c for c in df.columns if "company" in c.lower()), None)
        bp_col = next((c for c in df.columns if "base product" in c.lower()), None)

        ms = float(row[ms_col]) if ms_col and pd.notna(row[ms_col]) else 0.0
        audit = float(row[audit_col]) if audit_col and pd.notna(row[audit_col]) else ms
        wd = float(row[wd_col]) if wd_col and pd.notna(row[wd_col]) else 1.0
        company_val = str(row[company_col]) if company_col else ""
        company = company_val == "1" or company_val.lower() == "true"
        base_product = 0
        if bp_col and pd.notna(row[bp_col]) and str(row[bp_col]).strip():
            try:
                base_product = names_seen.index(str(row[bp_col])) + 1
            except ValueError:
                base_product = 0

        products.append(
            ProductDef(
                product_id=pid,
                name=name,
                company="Company" if company else "",
                included=ms != 0 and base_product == 0,
                base_market_share=ms,
                audit_share=audit,
                base_wd=wd,
                base_product_id=base_product,
                base_attributes=base_attrs,
                is_new_product=ms == 0 and base_product == 0,
                is_replaced_product=ms == 0 and base_product != 0,
            )
        )
    return products


def _parse_segments(xls: pd.ExcelFile) -> tuple[list[SegmentDef], list[dict[str, Any]]]:
    segs: list[SegmentDef] = []
    shares: list[dict[str, Any]] = []
    seg_df = _read_sheet(xls, r"^segments?$")
    for _, row in seg_df.iterrows():
        name = str(row.iloc[0]) if len(row) else ""
        if name and name.lower() != "nan":
            segs.append(SegmentDef(segment_type="Default", segment_name=name))

    swd_df = _read_sheet(xls, r"segments?\s*shares")
    for _, row in swd_df.iterrows():
        shares.append(row.to_dict())
    return segs, shares


def _group_type_from_column(column: str) -> str | None:
    """Return group type label from a Product List column like 'Group Brand' or 'group inches'."""
    m = re.match(r"^group\s*(.+)$", str(column).strip(), re.I)
    if not m:
        return None
    label = m.group(1).strip()
    if not label or label.lower() == "nan":
        return None
    return label[0].upper() + label[1:] if len(label) > 1 else label.upper()


def _product_name_column(df: pd.DataFrame) -> str:
    sku_col = next((c for c in df.columns if "sku" in str(c).lower() and "name" in str(c).lower()), None)
    return sku_col if sku_col is not None else df.columns[0]


def _groups_from_product_list_df(df: pd.DataFrame, products: list[ProductDef]) -> list[GroupDef]:
    """Build groups from Product List columns whose names start with 'Group'."""
    if df.empty or not products:
        return []

    valid_products = {p.name for p in products}
    group_cols = [c for c in df.columns if _group_type_from_column(str(c))]
    if not group_cols:
        return []

    name_col = _product_name_column(df)
    buckets: dict[tuple[str, str], list[str]] = {}

    for _, row in df.iterrows():
        product_name = str(row.get(name_col, "")).strip()
        if not product_name or product_name.lower() == "nan" or product_name not in valid_products:
            continue
        for col in group_cols:
            g_type = _group_type_from_column(str(col))
            if not g_type:
                continue
            raw = row.get(col)
            if pd.isna(raw):
                continue
            group_name = str(raw).strip()
            if not group_name or group_name.lower() == "nan":
                continue
            key = (g_type, group_name)
            members = buckets.setdefault(key, [])
            if product_name not in members:
                members.append(product_name)

    groups: list[GroupDef] = []
    for (g_type, group_name), members in sorted(buckets.items()):
        groups.append(
            GroupDef(
                group_type=g_type,
                group_name=group_name,
                product_names=members,
            )
        )
    return groups


def _parse_groups(xls: pd.ExcelFile, products: list[ProductDef]) -> list[GroupDef]:
    """Parse the Groups sheet, or fall back to Group* columns on the Product List sheet."""
    groups: list[GroupDef] = []

    # Try reading the "Groups" or "Groupings" sheet
    df = _read_sheet(xls, r"^groups?$")
    if not df.empty:
        # The sheet is usually two columns: Group Name, Products
        # Or multiple columns where header is Group Type and rows are mappings
        name_col = next((c for c in df.columns if "group" in str(c).lower() and "name" in str(c).lower()), None)
        prod_col = next((c for c in df.columns if "product" in str(c).lower()), None)
        type_col = next((c for c in df.columns if "type" in str(c).lower()), None)

        if not name_col:
            name_col = df.columns[0]
        if not prod_col and len(df.columns) > 1:
            prod_col = df.columns[1]

        if name_col and prod_col:
            for name, group_df in df.groupby(name_col):
                group_name = str(name).strip()
                if not group_name or group_name.lower() == "nan":
                    continue

                members = []
                for _, row in group_df.iterrows():
                    p_name = str(row[prod_col]).strip()
                    if p_name and p_name.lower() != "nan":
                        members.append(p_name)

                g_type = "Brand"
                if type_col and not group_df[type_col].isna().all():
                    g_type = str(group_df.iloc[0][type_col]).strip()
                elif "brand" in group_name.lower():
                    g_type = "Brand"

                groups.append(
                    GroupDef(
                        group_type=g_type,
                        group_name=group_name,
                        product_names=members,
                    )
                )

    if groups:
        return groups

    product_df = _read_sheet(xls, r"product\s*list")
    return _groups_from_product_list_df(product_df, products)


def _parse_segmentation(xls: pd.ExcelFile) -> list[RespondentSegmentation]:
    df = _read_sheet(xls, r"segmentation")
    result: list[RespondentSegmentation] = []
    for i, row in df.iterrows():
        assignments = {str(c): str(row[c]) for c in df.columns if pd.notna(row[c])}
        result.append(RespondentSegmentation(respondent_id=i + 1, assignments=assignments))
    return result


def _parse_excluded_sales(xls: pd.ExcelFile) -> list[dict[str, Any]]:
    df = _read_sheet(xls, r"excluded\s*sales")
    return [row.to_dict() for _, row in df.iterrows()]


def _parse_conditional_levels(
    xls: pd.ExcelFile,
    products: list[ProductDef],
    attributes: list[AttributeDef],
) -> list[ConditionalLevelRow]:
    rows: list[ConditionalLevelRow] = []
    for attr in attributes:
        if attr.attr_type != "Conditional":
            continue
        sheet_pat = rf"{re.escape(attr.name)}\s*attribute\s*levels"
        df = _read_sheet(xls, sheet_pat)
        if df.empty:
            continue
        sku_col = next((c for c in df.columns if "sku" in c.lower() and "name" in c.lower()), df.columns[0])
        level_cols = [c for c in df.columns if re.match(r"Level\s*\d+", str(c), re.I)]
        for _, row in df.iterrows():
            pname = str(row.get(sku_col, row.iloc[0])).strip()
            if not pname or pname.lower() in ("nan", "levels", "sku name"):
                continue
            match = next((p for p in products if p.name == pname), None)
            if not match:
                continue
            levels: dict[str, float] = {}
            for c in level_cols:
                if pd.notna(row[c]):
                    try:
                        levels[str(c)] = float(row[c])
                    except (TypeError, ValueError):
                        pass
            if levels:
                rows.append(
                    ConditionalLevelRow(
                        product_id=match.product_id,
                        product_name=pname,
                        levels=levels,
                        attribute_name=attr.name,
                    )
                )
    return rows
