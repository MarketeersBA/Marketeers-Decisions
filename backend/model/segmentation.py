"""Segmentation helpers — map study segments to respondent assignment columns."""

from __future__ import annotations

from model.study_schema import StudyDocument


def _assignment_keys(doc: StudyDocument) -> list[str]:
    if not doc.respondent_segmentation:
        return []
    return list(doc.respondent_segmentation[0].assignments.keys())


def _is_respondent_id_key(key: str) -> bool:
    norm = key.lower().replace("_", " ").strip()
    return norm in {"respondent id", "respondentid"}


def resolve_assignment_key(doc: StudyDocument, segment_label: str) -> str | None:
    """Map a segment dimension label (e.g. 'Gender') to an assignments column key."""
    keys = _assignment_keys(doc)
    if not keys:
        return None
    candidates = [
        f"Segment {segment_label}",
        segment_label,
        f"Segment{segment_label}",
    ]
    for cand in candidates:
        if cand in keys:
            return cand
    label_l = segment_label.lower()
    for key in keys:
        if _is_respondent_id_key(key):
            continue
        if label_l in key.lower():
            return key
    return None


def segmentation_dimensions(doc: StudyDocument) -> list[tuple[str, str]]:
    """Return (display_label, assignment_column_key) pairs for UI dropdowns."""
    keys = _assignment_keys(doc)
    if not keys:
        return []

    dims: list[tuple[str, str]] = []
    seen: set[str] = set()
    for seg in doc.segments:
        key = resolve_assignment_key(doc, seg.segment_name)
        if key and key not in seen:
            dims.append((seg.segment_name, key))
            seen.add(key)

    if not dims:
        for key in keys:
            if _is_respondent_id_key(key):
                continue
            label = key.replace("Segment ", "").strip() or key
            if key not in seen:
                dims.append((label, key))
                seen.add(key)
    return dims


def segment_members(doc: StudyDocument, assignment_key: str) -> list[str]:
    """Distinct member values for an assignment column."""
    vals: set[str] = set()
    for rs in doc.respondent_segmentation:
        raw = rs.assignments.get(assignment_key, "")
        if raw is None:
            continue
        s = str(raw).strip()
        if s and s.lower() != "nan":
            vals.add(s)
    return sorted(vals, key=lambda x: (len(x), x))
