"""Apply grid edits from the React Simulator to a ProjectCore session."""

from __future__ import annotations

from api.schemas import GridChange
from model.project_core import ProjectCore


def apply_grid_changes(project: ProjectCore, changes: list[GridChange]) -> tuple[int, list[str]]:
    """Apply attribute / include edits. Returns (count applied, list of warnings)."""
    applied = 0
    warnings = []
    for change in changes:
        col = change.column
        product = change.product
        value = change.value

        if col == "Selected":
            project.include_exclude_product(product, bool(value), reload=False)
            applied += 1
        elif col.startswith("New ") or col in ["NOS", "TDC"]:
            attr = col.removeprefix("New ")
            str_val = str(value)

            if attr == "WD":
                try:
                    num = float(str_val)
                    if num < 0:
                        warnings.append(f"WD for {product} cannot be < 0. Set to 0.")
                        str_val = "0"
                    elif num > 100:
                        warnings.append(f"WD for {product} cannot be > 100. Set to 100.")
                        str_val = "100"
                except ValueError:
                    pass
            elif attr == "Price":
                try:
                    num = float(str_val)
                    if num < 0.01:
                        warnings.append(f"Price for {product} cannot be < 0.01. Set to 0.01.")
                        str_val = "0.01"
                except ValueError:
                    pass

            project.change_product_attribute(product, attr, str_val, reload=False)
            applied += 1
        elif col in project.discrete_attributes:
            project.change_product_attribute(product, col, str(value), reload=False)
            applied += 1

    return applied, warnings
