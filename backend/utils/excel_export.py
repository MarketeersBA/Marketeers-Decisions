"""Excel export utilities — REQ-EXP-01 formatted parity with desktop ExcelSheet styling."""

from __future__ import annotations

import io
from typing import Any

import pandas as pd
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.utils.dataframe import dataframe_to_rows


# Desktop ExcelSheet header interior ≈ RGB(191, 80, 80-ish) stored as BGR 12419407
HEADER_FILL = PatternFill("solid", fgColor="BF4F4F")
HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)
POS_FILL = PatternFill("solid", fgColor="C6EFCE")  # green — share up
NEG_FILL = PatternFill("solid", fgColor="FFC7CE")  # red — share down
THIN = Border(
    left=Side(style="thin", color="BF4F4F"),
    right=Side(style="thin", color="BF4F4F"),
    top=Side(style="thin", color="BF4F4F"),
    bottom=Side(style="thin", color="BF4F4F"),
)


def _style_header_row(ws, col_count: int, row: int = 1) -> None:
    for col in range(1, col_count + 1):
        cell = ws.cell(row=row, column=col)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = THIN
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions


def _autosize(ws, max_width: int = 28) -> None:
    for col_cells in ws.columns:
        letter = get_column_letter(col_cells[0].column)
        width = 10
        for cell in col_cells[:80]:
            if cell.value is None:
                continue
            width = max(width, min(max_width, len(str(cell.value)) + 2))
        ws.column_dimensions[letter].width = width


def _number_format_for(col_name: str, decimals: int = 2) -> str | None:
    name = col_name.lower()
    if any(k in name for k in ("share", "penetration", "index", "wd")):
        return f"0.{'0' * decimals}"
    if "revenue" in name or name in ("nos", "tdc", "mm$"):
        return "#,##0.00"
    return None


def _write_dataframe(
    ws,
    df: pd.DataFrame,
    *,
    decimals: int = 2,
    color_threshold: float = 3.5,
    base_share_col: str | None = "B.Share",
    share_col: str | None = "N.Share",
) -> None:
    rows = list(dataframe_to_rows(df, index=False, header=True))
    for r_idx, row in enumerate(rows, start=1):
        for c_idx, value in enumerate(row, start=1):
            ws.cell(row=r_idx, column=c_idx, value=value)

    if not rows:
        return

    headers = [str(h) for h in rows[0]]
    _style_header_row(ws, len(headers))

    for c_idx, header in enumerate(headers, start=1):
        fmt = _number_format_for(header, decimals)
        if not fmt:
            continue
        for r_idx in range(2, len(rows) + 1):
            cell = ws.cell(row=r_idx, column=c_idx)
            if isinstance(cell.value, (int, float)):
                cell.number_format = fmt

    # Color N.Share by *relative* change vs B.Share (desktop: ±threshold%)
    if (
        share_col
        and base_share_col
        and share_col in headers
        and base_share_col in headers
    ):
        s_i = headers.index(share_col) + 1
        b_i = headers.index(base_share_col) + 1
        thr = color_threshold / 100.0
        for r_idx in range(2, len(rows) + 1):
            share = ws.cell(row=r_idx, column=s_i).value
            base = ws.cell(row=r_idx, column=b_i).value
            if not isinstance(share, (int, float)) or not isinstance(base, (int, float)):
                continue
            if not base:
                continue
            rel = (share - base) / base
            if rel > thr:
                ws.cell(row=r_idx, column=s_i).fill = POS_FILL
            elif rel < -thr:
                ws.cell(row=r_idx, column=s_i).fill = NEG_FILL

    # Color S.Index / R.Index when present (ratios ~1.0)
    for idx_col in ("S.Index", "R.Index"):
        if idx_col not in headers:
            continue
        c_i = headers.index(idx_col) + 1
        thr = color_threshold / 100.0
        for r_idx in range(2, len(rows) + 1):
            val = ws.cell(row=r_idx, column=c_i).value
            if not isinstance(val, (int, float)):
                continue
            if val > 1.0 + thr:
                ws.cell(row=r_idx, column=c_i).fill = POS_FILL
            elif val < 1.0 - thr:
                ws.cell(row=r_idx, column=c_i).fill = NEG_FILL

    _autosize(ws)


def export_results_to_excel(
    df: pd.DataFrame,
    study_name: str,
    *,
    groups_df: pd.DataFrame | None = None,
    decimals: int = 2,
    color_threshold: float = 3.5,
    scenario_name: str = "",
) -> bytes:
    """Formatted results workbook (header style, freeze, share colors, optional Groups)."""
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        # Create empty sheet then write styled
        pd.DataFrame().to_excel(writer, sheet_name="Results", index=False)
        ws = writer.sheets["Results"]
        if ws.max_row:
            ws.delete_rows(1, ws.max_row)
        _write_dataframe(
            ws,
            df,
            decimals=decimals,
            color_threshold=color_threshold,
        )

        if groups_df is not None and not groups_df.empty:
            pd.DataFrame().to_excel(writer, sheet_name="Groups", index=False)
            gws = writer.sheets["Groups"]
            if gws.max_row:
                gws.delete_rows(1, gws.max_row)
            _write_dataframe(
                gws,
                groups_df,
                decimals=decimals,
                color_threshold=color_threshold,
                base_share_col="B.Share",
                share_col="N.Share",
            )

        meta = pd.DataFrame(
            {
                "Study": [study_name],
                "Scenario": [scenario_name or "Base"],
                "Decimals": [decimals],
                "ColorThreshold": [color_threshold],
            }
        )
        meta.to_excel(writer, sheet_name="Info", index=False)
        info = writer.sheets["Info"]
        _style_header_row(info, meta.shape[1])
        _autosize(info)

    buffer.seek(0)
    return buffer.getvalue()


def export_comparison_to_excel(
    volume: pd.DataFrame | None = None,
    value_share: pd.DataFrame | None = None,
    revenue: pd.DataFrame | None = None,
    study_name: str = "",
    *,
    decimals: int = 2,
) -> bytes:
    """Export scenario comparison tables with styled headers."""
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        sheets: list[tuple[str, pd.DataFrame]] = []
        if volume is not None and not volume.empty:
            pivot = volume.pivot(index="Product", columns="Scenario", values="Share")
            sheets.append(("Market Share", pivot.reset_index()))
        if value_share is not None and not value_share.empty:
            pivot = value_share.pivot(index="Product", columns="Scenario", values="Share")
            sheets.append(("Value Share", pivot.reset_index()))
        if revenue is not None and not revenue.empty:
            pivot = revenue.pivot(index="Product", columns="Scenario", values="Revenue")
            sheets.append(("Revenue", pivot.reset_index()))

        for name, frame in sheets:
            frame.to_excel(writer, sheet_name=name, index=False)
            ws = writer.sheets[name]
            if ws.max_row:
                ws.delete_rows(1, ws.max_row)
            _write_dataframe(ws, frame, decimals=decimals, share_col=None, base_share_col=None)

        if study_name:
            meta = pd.DataFrame({"Study": [study_name]})
            meta.to_excel(writer, sheet_name="Info", index=False)
            info = writer.sheets["Info"]
            _style_header_row(info, 1)
            _autosize(info)

    buffer.seek(0)
    return buffer.getvalue()


def read_excel_template_sheets(file_path_or_buffer: Any) -> dict[str, pd.DataFrame]:
    """Read all sheets from an Excel study template."""
    xls = pd.ExcelFile(file_path_or_buffer)
    return {name: pd.read_excel(file_path_or_buffer, sheet_name=name) for name in xls.sheet_names}
