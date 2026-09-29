import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { useSession } from "../stores/sessionStore";
import { isSessionWorkspacePath, sectionForPath } from "./sections";
import { ValidationScoreChip } from "./ValidationScoreChip";

function Popover({
  isOpen,
  onClose,
  local = false,
  children,
  width = 280,
}: {
  isOpen: boolean;
  onClose: () => void;
  local?: boolean;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    requestAnimationFrame(() => document.addEventListener("click", handleClick));
    return () => document.removeEventListener("click", handleClick);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className={`popover${local ? " popover-local" : ""}`} style={{ width }} ref={ref}>
      {children}
    </div>
  );
}

function FilterDropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="filter-dropdown-wrap">
      <div
        className="chip-btn filter"
        onClick={() => setOpen((o) => !o)}
        title={label}
      >
        <span dir="auto">{value || label}</span>
        <span className={`caret${open ? " up" : ""}`}>▾</span>
      </div>
      <Popover isOpen={open} onClose={() => setOpen(false)} local width={200}>
        <div className="filter-option-list" role="listbox">
          {options.length === 0 ? (
            <div className="filter-option" style={{ cursor: "default", opacity: 0.6 }}>
              No options
            </div>
          ) : (
            options.map((opt) => (
              <button
                key={opt}
                type="button"
                role="option"
                aria-selected={opt === value}
                className={`filter-option${opt === value ? " active" : ""}`}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
              >
                {opt}
              </button>
            ))
          )}
        </div>
      </Popover>
    </div>
  );
}

const EMPTY_OPTIONS: string[] = [];

export function ContextBar() {
  const { pathname } = useLocation();
  const { session } = useSession();
  const [category, setCategory] = useState("");
  const [retailer, setRetailer] = useState("");
  const [channel, setChannel] = useState("");

  const section = sectionForPath(pathname);
  const showFilters = Boolean(session) && isSessionWorkspacePath(pathname);

  return (
    <div className="context-bar-stack">
      <div className="context-bar">
        {section ? (
          <div className="ctx-section">
            <div className="ctx-section-crumb">Section {section.num}</div>
            <h1 className="ctx-section-title" dir="auto">
              {section.title}
            </h1>
          </div>
        ) : null}

        <div className="ctx-spacer"></div>

        <ValidationScoreChip />
      </div>

      {showFilters ? (
        <div className="context-bar-filters">
          <FilterDropdown
            label="Category"
            options={EMPTY_OPTIONS}
            value={category}
            onChange={setCategory}
          />
          <FilterDropdown
            label="Retailer"
            options={EMPTY_OPTIONS}
            value={retailer}
            onChange={setRetailer}
          />
          <FilterDropdown
            label="Channel"
            options={EMPTY_OPTIONS}
            value={channel}
            onChange={setChannel}
          />
        </div>
      ) : null}
    </div>
  );
}

