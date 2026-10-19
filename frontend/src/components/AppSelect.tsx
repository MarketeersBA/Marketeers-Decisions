import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface AppSelectItem {
  value: string;
  label: string;
}

export interface AppSelectGroup {
  label: string;
  items: AppSelectItem[];
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  items?: AppSelectItem[];
  groups?: AppSelectGroup[];
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
  /** Replaces the selected label inside the button, for icon triggers. */
  trigger?: ReactNode;
}

export function AppSelect({
  value,
  onChange,
  items = [],
  groups = [],
  disabled = false,
  ariaLabel,
  className,
  placeholder = "Select",
  trigger,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const selectedLabel = useMemo(() => {
    const flat = [...items, ...groups.flatMap((group) => group.items)];
    return flat.find((item) => item.value === value)?.label ?? placeholder;
  }, [groups, items, placeholder, value]);

  const placeMenu = () => {
    const button = triggerRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.max(rect.width, 180);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 220 && rect.top > spaceBelow;
    setMenuStyle({
      position: "fixed",
      left,
      width,
      zIndex: 80,
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open]);

  const choose = (next: string) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };

  const option = (item: AppSelectItem) => (
    <button
      key={item.value || item.label}
      type="button"
      role="option"
      aria-selected={item.value === value}
      className={`app-select-option${item.value === value ? " is-selected" : ""}`}
      onClick={() => choose(item.value)}
    >
      {item.label}
    </button>
  );

  return (
    <div
      ref={rootRef}
      className={`app-select${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className="app-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger ?? <span className="app-select-value">{selectedLabel}</span>}
        {trigger ? null : (
          <svg className="app-select-chevron" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 6.5 8 10.5 12 6.5"
            />
          </svg>
        )}
      </button>
      {open
        ? createPortal(
            <div ref={menuRef} className="app-select-menu" role="listbox" style={menuStyle}>
              {items.map(option)}
              {groups.map((group) => (
                <div key={group.label} className="app-select-group">
                  <div className="app-select-group-label">{group.label}</div>
                  {group.items.map(option)}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
