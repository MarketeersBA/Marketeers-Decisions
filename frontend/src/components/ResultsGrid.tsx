import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { CellValue, ResultRow } from "../api/types";
import { AppSelect } from "./AppSelect";
import { asCellValue, discreteLevelIndex, formatDiscreteCellValue, isDiscreteEditableColumn, isNumericEditableColumn, parseCellInput, valuesEqual } from "../lib/cellValue";
import { ratioIndexColor, relativeShareColor, resolveShareColorThreshold, type ShareColorClass } from "../lib/shareColor";
import { columnDecimals, fmtNumber, isNumericColumn } from "../shell/format";
import { useSettings } from "../stores/useSettings";
import { hiddenMetricColumns, loadSettings, saveSettings } from "../stores/settingsStore";
import "./results-grid.css";

interface Props {
  columns: string[];
  rows: ResultRow[];
  editableColumns?: string[];
  /** Discrete attribute column -> ordered level labels. */
  discreteAttributeLevels?: Record<string, string[]>;
  mode?: "editable" | "readonly";
  /** flat = expandable SKUs under groups; grouped = non-expandable rollup rows */
  viewMode?: "flat" | "grouped";
  finMode?: "NOS" | "TDC" | "MM$";
  scrollable?: boolean;
  onCellChange?: (productName: string, column: string, value: CellValue) => void;
  onIncludeSku?: (productName: string, groupName: string) => void;
  onToggleGroup?: (groupName: string) => void;
}

const HIDDEN = new Set(["Product Index"]);
/** Preferred attribute order for Base/New value columns after Product Name. */
const VALUE_ATTR_ORDER = ["Price", "Size", "WD"];

type DisplayCol = { kind: "single"; id: string; col: string };

const COLUMN_LABELS: Record<string, string> = {
  "B.Share": "Base Share",
  "N.Share": "New Share",
};

function buildDisplayCols(cols: string[]): DisplayCol[] {
  const present = new Set(cols);
  const consumed = new Set<string>();
  const out: DisplayCol[] = [];

  for (const col of cols) {
    if (consumed.has(col)) continue;

    // Keep Base Share / New Share as adjacent separate columns (Base first).
    if (col === "B.Share" || col === "N.Share") {
      if (present.has("B.Share") && !consumed.has("B.Share")) {
        out.push({ kind: "single", id: "B.Share", col: "B.Share" });
        consumed.add("B.Share");
      }
      if (present.has("N.Share") && !consumed.has("N.Share")) {
        out.push({ kind: "single", id: "N.Share", col: "N.Share" });
        consumed.add("N.Share");
      }
      continue;
    }

    out.push({ kind: "single", id: col, col });
  }

  return out;
}

function displayHeader(dc: DisplayCol): string {
  return COLUMN_LABELS[dc.col] ?? dc.col;
}

function valueAttributeName(col: string): string | null {
  if (col.startsWith("Base ")) return col.slice(5);
  if (col.startsWith("New ")) return col.slice(4);
  return null;
}

function valueColumnSortKey(col: string): [number, number, string] {
  const attr = valueAttributeName(col) ?? col;
  const attrIdx = VALUE_ATTR_ORDER.indexOf(attr);
  const attrOrder = attrIdx === -1 ? VALUE_ATTR_ORDER.length : attrIdx;
  const baseNew = col.startsWith("Base ") ? 0 : col.startsWith("New ") ? 1 : 2;
  return [attrOrder, baseNew, col];
}

function sortValueColumns(valueCols: DisplayCol[]): DisplayCol[] {
  return [...valueCols].sort((a, b) => {
    const [aAttr, aBN, aName] = valueColumnSortKey(a.col);
    const [bAttr, bBN, bName] = valueColumnSortKey(b.col);
    if (aAttr !== bAttr) return aAttr - bAttr;
    if (aBN !== bBN) return aBN - bBN;
    return aName.localeCompare(bName);
  });
}

function insertValueColumnsAfterProductName(built: DisplayCol[], valueCols: DisplayCol[]): DisplayCol[] {
  if (valueCols.length === 0) return built;
  const ordered = sortValueColumns(valueCols);
  const valueIds = new Set(ordered.map((dc) => dc.id));
  const rest = built.filter((dc) => !valueIds.has(dc.id));
  const productIdx = rest.findIndex((dc) => dc.col === "Product Name");
  if (productIdx === -1) return [...ordered, ...rest];
  return [
    ...rest.slice(0, productIdx + 1),
    ...ordered,
    ...rest.slice(productIdx + 1),
  ];
}

function applyColumnOrder(cols: DisplayCol[], savedOrder: string[]): DisplayCol[] {
  if (!savedOrder.length) return cols;
  const byId = new Map(cols.map((c) => [c.id, c]));
  const ordered: DisplayCol[] = [];
  const used = new Set<string>();

  const product = cols.find((c) => c.col === "Product Name");
  if (product) {
    ordered.push(product);
    used.add(product.id);
  }

  for (const id of savedOrder) {
    if (used.has(id)) continue;
    const col = byId.get(id);
    if (col) {
      ordered.push(col);
      used.add(id);
    }
  }

  for (const col of cols) {
    if (!used.has(col.id)) ordered.push(col);
  }

  return ordered;
}

function reorderColumnIds(order: string[], fromId: string, toId: string): string[] {
  const fromIdx = order.indexOf(fromId);
  const toIdx = order.indexOf(toId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return order;
  const next = [...order];
  const [moved] = next.splice(fromIdx, 1);
  const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
  next.splice(insertAt, 0, moved);
  return next;
}

function isPinnedColumn(col: string): boolean {
  return col === "Product Name";
}

/** Rounded engine output — anything past this is a real edit rather than float noise. */
const CHANGE_EPS = 1e-6;

/** True when an editable "New X" cell differs from its paired "Base X" value. */
function isNewColumnChanged(row: ResultRow, col: string): boolean {
  if (!col.startsWith("New ")) return false;
  const baseKey = `Base ${col.slice(4)}`;
  if (!(baseKey in row)) return false;
  const next = row[col];
  const base = row[baseKey];
  const nextNum = Number(next);
  const baseNum = Number(base);
  if (Number.isFinite(nextNum) && Number.isFinite(baseNum)) {
    return Math.abs(nextNum - baseNum) > CHANGE_EPS;
  }
  return !valuesEqual(next, base);
}

/** Local draft while typing; commits on Enter or blur (Escape cancels). */
function EditableNumberCell({
  value,
  productName,
  column,
  onCommit,
  onNavigateKeyDown,
}: {
  value: CellValue | undefined;
  productName: string;
  column: string;
  onCommit: (productName: string, column: string, value: CellValue) => void;
  onNavigateKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const committed = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(committed);
  const focusedRef = useRef(false);
  const skipCommitRef = useRef(false);
  const numeric = isNumericEditableColumn(column);

  // Sync from parent when not editing (live recalc / reset / scenario load).
  useEffect(() => {
    if (!focusedRef.current) setDraft(committed);
  }, [committed]);

  const commit = () => {
    const next = parseCellInput(draft, column);
    if (valuesEqual(next, value ?? null)) return;
    onCommit(productName, column, next);
  };

  return (
    <input
      className={`cell-input${numeric ? " num" : ""}`}
      type="text"
      value={draft}
      onFocus={(e) => {
        focusedRef.current = true;
        setDraft(committed);
        e.target.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focusedRef.current = false;
        if (skipCommitRef.current) {
          skipCommitRef.current = false;
          setDraft(committed);
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          skipCommitRef.current = true;
          setDraft(committed);
          e.currentTarget.blur();
          return;
        }
        if (e.key === "Enter") {
          // Commit the full number, then move to the next row.
          commit();
          focusedRef.current = false;
          onNavigateKeyDown(e);
          return;
        }
        onNavigateKeyDown(e);
      }}
    />
  );
}

/** Dropdown for discrete study attributes (Breakability, HDTypes, etc.). */
function EditableDiscreteCell({
  value,
  levels,
  productName,
  column,
  onCommit,
}: {
  value: CellValue | undefined;
  levels: string[];
  productName: string;
  column: string;
  onCommit: (productName: string, column: string, value: CellValue) => void;
}) {
  const currentIndex = discreteLevelIndex(value ?? null, levels);
  return (
    <AppSelect
      className="cell-select"
      ariaLabel={`${column} for ${productName}`}
      value={currentIndex == null ? "" : String(currentIndex)}
      items={levels.map((label, idx) => ({ value: String(idx + 1), label }))}
      onChange={(nextValue) => {
        const next = Number(nextValue);
        if (!Number.isFinite(next) || next < 1) return;
        if (next === currentIndex) return;
        onCommit(productName, column, next);
      }}
    />
  );
}

/** Compact + control that opens a left-aligned SKU menu (replaces native select). */
function GroupAddSkuMenu({
  groupName,
  skus,
  onAdd,
}: {
  groupName: string;
  skus: string[];
  onAdd: (sku: string, groupName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({ top: rect.bottom + 4, left: rect.left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="group-add-sku-root">
      <button
        ref={buttonRef}
        type="button"
        className="group-add-sku"
        aria-label={`Add SKU to ${groupName} (${skus.length} available)`}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={`Add SKU (${skus.length})`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        +
      </button>
      {open && menuPos
        ? createPortal(
            <ul
              ref={menuRef}
              className="group-add-sku-menu"
              role="listbox"
              aria-label={`Excluded SKUs for ${groupName}`}
              style={{ top: menuPos.top, left: menuPos.left }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {skus.map((sku) => (
                <li key={sku} role="option">
                  <button
                    type="button"
                    className="group-add-sku-item"
                    onClick={() => {
                      onAdd(sku, groupName);
                      setOpen(false);
                    }}
                  >
                    {sku}
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </span>
  );
}

function cellClassForDisplay(
  dc: DisplayCol,
  row: ResultRow,
  thresholdPct: number,
): ShareColorClass {
  const col = dc.col;
  const val = row[col];
  if (typeof val !== "number") return "";
  if (col === "N.Share") {
    const base = row["B.Share"];
    if (typeof base === "number") {
      return relativeShareColor(val, base, thresholdPct);
    }
    return "";
  }
  if (col === "S.Index" || col === "R.Index") {
    return ratioIndexColor(val, thresholdPct);
  }
  return "";
}

function displayColHasValue(dc: DisplayCol, rows: ResultRow[]): boolean {
  if (dc.col === "Product Name") return true;
  return rows.some((r) => {
    const v = r[dc.col];
    return v !== null && v !== undefined && v !== "";
  });
}

function isEditable(col: string, editableColumns: string[], mode: string): boolean {
  return mode === "editable" && editableColumns.includes(col);
}

function isValueColumn(col: string, editableColumns: string[]): boolean {
  return editableColumns.includes(col) && col !== "Selected";
}

function isDisplayValueColumn(dc: DisplayCol, editableColumns: string[]): boolean {
  const col = dc.col;
  if (isValueColumn(col, editableColumns)) return true;
  // Keep Base X beside editable New X in the value zone
  if (col.startsWith("Base ")) {
    return isValueColumn(`New ${col.slice(5)}`, editableColumns);
  }
  return false;
}

function isDisplayEditable(dc: DisplayCol, editableColumns: string[], mode: string): boolean {
  if (mode !== "editable") return false;
  return isEditable(dc.col, editableColumns, mode);
}

export function ResultsGrid({
  columns,
  rows,
  editableColumns = [],
  discreteAttributeLevels = {},
  mode = "readonly",
  viewMode = "flat",
  finMode,
  scrollable = true,
  onCellChange,
  onIncludeSku,
  onToggleGroup,
}: Props) {
  const settings = useSettings();
  const helper = createColumnHelper<ResultRow>();
  const threshold = useMemo(
    () =>
      resolveShareColorThreshold(
        settings.shareColorThresholdMode,
        settings.shareColorThreshold,
        rows,
      ),
    [settings.shareColorThresholdMode, settings.shareColorThreshold, rows],
  );
  const decimals = settings.decimalPlaces;
  const metricHidden = useMemo(
    () => hiddenMetricColumns(settings),
    [
      settings.showVolumeShare,
      settings.showValueShare,
      settings.showRevenue,
      settings.showPreferenceShare,
      settings.showPenetration,
      settings.showAuditShare,
    ],
  );

  const isRollup = viewMode === "grouped";
  const gridMode = isRollup ? "readonly" : mode;
  const hasSelectedColumn = columns.includes("Selected");
  const selectedEditable = isEditable("Selected", editableColumns, gridMode);
  const hasGroupHeaders = useMemo(
    () => rows.some((r) => String(r["Product Name"] ?? "").startsWith("GROUP:")),
    [rows],
  );

  const defaultDisplayCols = useMemo(() => {
    // "Selected" is rendered as a checkbox inside the Product Name cell, not its own column
    let cols = columns.filter((c) => !HIDDEN.has(c) && !metricHidden.has(c) && c !== "Selected");

    if (finMode === "NOS") {
      cols = cols.filter((c) => c !== "TDC" && c !== "MM$");
    } else if (finMode === "TDC") {
      cols = cols.filter((c) => c !== "NOS" && c !== "MM$");
    } else if (finMode === "MM$") {
      cols = cols.filter((c) => c !== "NOS" && c !== "TDC");
    }

    let built = buildDisplayCols(cols);

    // Rolled-up group view: only columns that carry values on the visible rows
    if (isRollup) {
      built = built.filter((dc) => displayColHasValue(dc, rows));
      return built;
    }

    // Place value-changeable columns immediately after Product Name
    const valueCols = built.filter((dc) => isDisplayValueColumn(dc, editableColumns));
    return insertValueColumnsAfterProductName(built, valueCols);
  }, [columns, finMode, metricHidden, editableColumns, isRollup, rows]);

  const displayCols = useMemo(
    () => applyColumnOrder(defaultDisplayCols, settings.gridColumnOrder),
    [defaultDisplayCols, settings.gridColumnOrder],
  );

  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dropColId, setDropColId] = useState<string | null>(null);

  const persistColumnOrder = useCallback(
    (fromId: string, toId: string) => {
      if (isPinnedColumn(fromId) || isPinnedColumn(toId)) return;
      const baseOrder =
        settings.gridColumnOrder.length > 0
          ? settings.gridColumnOrder
          : defaultDisplayCols.map((dc) => dc.id);
      const next = reorderColumnIds(baseOrder, fromId, toId);
      saveSettings({ ...loadSettings(), gridColumnOrder: next });
    },
    [defaultDisplayCols, settings.gridColumnOrder],
  );

  const displayById = useMemo(() => {
    const map = new Map<string, DisplayCol>();
    for (const dc of displayCols) map.set(dc.id, dc);
    return map;
  }, [displayCols]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" || e.key === "Delete") return;

    const target = e.target as HTMLInputElement;
    const td = target.closest("td");
    const tr = td?.closest("tr");

    if (!td || !tr) return;

    const allInputsInRow = Array.from(tr.querySelectorAll("input.cell-input"));
    const currentIndex = allInputsInRow.indexOf(target);

    let nextInput: HTMLInputElement | null = null;

    if (e.key === "ArrowRight") {
      nextInput = allInputsInRow[currentIndex + 1] as HTMLInputElement;
    } else if (e.key === "ArrowLeft") {
      nextInput = allInputsInRow[currentIndex - 1] as HTMLInputElement;
    } else if (e.key === "ArrowDown" || e.key === "Enter") {
      const nextTr = tr.nextElementSibling as HTMLTableRowElement;
      if (nextTr) {
        const nextTd = nextTr.children[td.cellIndex];
        nextInput = nextTd?.querySelector("input.cell-input") as HTMLInputElement;
      }
    } else if (e.key === "ArrowUp") {
      const prevTr = tr.previousElementSibling as HTMLTableRowElement;
      if (prevTr) {
        const prevTd = prevTr.children[td.cellIndex];
        nextInput = prevTd?.querySelector("input.cell-input") as HTMLInputElement;
      }
    }

    if (nextInput) {
      e.preventDefault();
      nextInput.focus();
      nextInput.select();
    }
  };

  const tableColumns = useMemo(
    () =>
      displayCols.map((dc) =>
        helper.display({
          id: dc.id,
          header: displayHeader(dc),
          cell: (info) => {
            const row = info.row.original;
            const rowProductName = String(row["Product Name"] ?? "");
            const isGroupRow = rowProductName.startsWith("GROUP:");
            const isPlaceholder = Boolean(row["_placeholder"]);
            const isSpecialRow = isGroupRow || isPlaceholder;

            const col = dc.col;
            const raw = row[col];
            const editable = isEditable(col, editableColumns, gridMode);

            if (col === "Product Name") {
              const name = String(raw ?? "");
              if (name.startsWith("GROUP:")) {
                const groupName = name.replace("GROUP:", "");
                if (isRollup) {
                  return (
                    <span dir="auto" className="product-name">
                      {groupName}
                    </span>
                  );
                }
                const collapsed = Boolean(row["_collapsed"]);
                const unselectedSkus = Array.isArray(row["_unselectedSkus"])
                  ? (row["_unselectedSkus"] as string[])
                  : [];
                return (
                  <span dir="auto" className="group-name">
                    <span className="group-chevron">{collapsed ? "▸" : "▾"}</span>
                    <span className="group-add-sku-slot">
                      {unselectedSkus.length > 0 && selectedEditable ? (
                        <GroupAddSkuMenu
                          groupName={groupName}
                          skus={unselectedSkus}
                          onAdd={(sku, group) => onIncludeSku?.(sku, group)}
                        />
                      ) : null}
                    </span>
                    <span className="group-label">{groupName}</span>
                  </span>
                );
              }
              if (row["_placeholder"]) {
                return (
                  <span dir="auto" className="group-placeholder">
                    {name}
                  </span>
                );
              }
              const selected = Boolean(row["Selected"]);
              return (
                <span dir="auto" className="product-name-cell">
                  {hasSelectedColumn ? (
                    <input
                      type="checkbox"
                      className="product-selected"
                      checked={selected}
                      readOnly={!selectedEditable}
                      onChange={
                        selectedEditable
                          ? (e) => onCellChange?.(rowProductName, "Selected", e.target.checked)
                          : undefined
                      }
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Include ${name} in simulation`}
                      title="Include in simulation"
                    />
                  ) : null}
                  <span className="product-name">{name}</span>
                </span>
              );
            }

            if (editable) {
              if (isSpecialRow) return null;
              if (isDiscreteEditableColumn(col, discreteAttributeLevels)) {
                return (
                  <EditableDiscreteCell
                    value={asCellValue(raw)}
                    levels={discreteAttributeLevels[col]!}
                    productName={rowProductName}
                    column={col}
                    onCommit={(product, columnName, next) => onCellChange?.(product, columnName, next)}
                  />
                );
              }
              return (
                <EditableNumberCell
                  value={asCellValue(raw)}
                  productName={rowProductName}
                  column={col}
                  onCommit={(product, columnName, next) => onCellChange?.(product, columnName, next)}
                  onNavigateKeyDown={handleKeyDown}
                />
              );
            }

            if (discreteAttributeLevels[col]?.length) {
              if (isSpecialRow && raw == null) return null;
              return <span>{formatDiscreteCellValue(raw, discreteAttributeLevels[col])}</span>;
            }

            if (isNumericColumn(col)) {
              if (isSpecialRow && raw == null) return null;
              return (
                <span className={`num${isGroupRow ? " group-metric" : ""}`}>
                  {fmtNumber(raw, columnDecimals(col, decimals))}
                </span>
              );
            }
            return String(raw ?? "");
          },
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      displayCols,
      editableColumns,
      discreteAttributeLevels,
      gridMode,
      isRollup,
      onCellChange,
      onIncludeSku,
      decimals,
      hasSelectedColumn,
      selectedEditable,
    ],
  );

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div
      className={[
        "grid-scroll",
        !isRollup && hasGroupHeaders ? "grouped-view" : "",
        isRollup ? "rollup-view" : "",
        scrollable ? "" : "grid-scroll-fixed",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <table className="results-grid">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const dc = displayById.get(header.column.id);
                const editable = dc ? isDisplayEditable(dc, editableColumns, gridMode) : false;
                const colId = header.column.id;
                const draggable = Boolean(dc && !isPinnedColumn(dc.col));
                const thClass = [
                  editable ? "editable-header" : "",
                  draggable ? "col-draggable" : "",
                  dragColId === colId ? "col-dragging" : "",
                  dropColId === colId ? "col-drop-target" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <th
                    key={header.id}
                    className={thClass || undefined}
                    draggable={draggable}
                    title={draggable ? "Drag to reorder column" : undefined}
                    onDragStart={
                      draggable
                        ? (e) => {
                            setDragColId(colId);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", colId);
                          }
                        : undefined
                    }
                    onDragOver={
                      draggable
                        ? (e) => {
                            e.preventDefault();
                            if (dragColId && dragColId !== colId) setDropColId(colId);
                          }
                        : undefined
                    }
                    onDragLeave={
                      draggable
                        ? () => {
                            if (dropColId === colId) setDropColId(null);
                          }
                        : undefined
                    }
                    onDrop={
                      draggable
                        ? (e) => {
                            e.preventDefault();
                            const fromId = e.dataTransfer.getData("text/plain") || dragColId;
                            if (fromId) persistColumnOrder(fromId, colId);
                            setDragColId(null);
                            setDropColId(null);
                          }
                        : undefined
                    }
                    onDragEnd={() => {
                      setDragColId(null);
                      setDropColId(null);
                    }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const isGroupRow = String(row.original["Product Name"] ?? "").startsWith("GROUP:");
            const isGroup = !isRollup && isGroupRow;
            const isPlaceholder = Boolean(row.original["_placeholder"]);
            const isSpecial = isGroupRow || isPlaceholder;
            const excluded = row.original["Selected"] === false && !isSpecial;
            const canToggle = isGroup && Boolean(onToggleGroup);
            const skuShadeClass = !isGroup && !isPlaceholder ? "sku-row" : "";

            return (
              <tr
                key={row.id}
                className={`${excluded ? "excluded" : ""} ${isGroup ? "group-header" : ""} ${isPlaceholder ? "group-placeholder-row" : ""} ${skuShadeClass}`}
                onClick={
                  canToggle
                    ? () => onToggleGroup?.(String(row.original["Product Name"]).replace("GROUP:", ""))
                    : undefined
                }
                style={canToggle ? { cursor: "pointer" } : undefined}
              >
                {row.getVisibleCells().map((cell) => {
                  const dc = displayById.get(cell.column.id);
                  const editable = !isSpecial && dc ? isDisplayEditable(dc, editableColumns, gridMode) : false;
                  const col = dc?.col ?? "";
                  const isBaseCompanion =
                    Boolean(dc) && col.startsWith("Base ") && isDisplayValueColumn(dc!, editableColumns);
                  const changed = editable && isNewColumnChanged(row.original, col);
                  const colorClass = dc ? cellClassForDisplay(dc, row.original, threshold) : "";
                  return (
                    <td
                      key={cell.id}
                      className={[
                        editable ? "editable" : "",
                        changed ? "cell-changed" : "",
                        isBaseCompanion ? "base-value" : "",
                        colorClass ? `metric-${colorClass}` : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
