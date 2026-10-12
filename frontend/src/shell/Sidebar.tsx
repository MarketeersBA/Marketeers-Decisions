import { NavLink } from "react-router-dom";

import { useSession } from "../stores/sessionStore";
import logo from "../assets/logo.png";
import { SECTIONS } from "./sections";
import "./shell.css";

const NOT_SET = "Not set";
const BASE_DESCRIPTION = "Choice-based conjoint, calibrated to NIQ/Circana";

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.75" y="2.5" width="12.5" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.4" />
      {collapsed ? (
        <path
          d="M9.2 5.5 11.7 8 9.2 10.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M10.8 5.5 8.3 8l2.5 2.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function Sidebar({
  collapsed,
  onToggle,
  onSignOut,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onSignOut?: () => void;
}) {
  const { session } = useSession();

  const clientLine = session
    ? [session.study.companyName, session.study.market || session.study.category]
        .filter(Boolean)
        .join(" · ") || "Pricing Simulator"
    : "Super Bock Group · Beer, Portugal";

  const projectDetails = [
    { label: "Category", value: session?.study.category?.trim() || NOT_SET },
    { label: "Market", value: session?.study.market?.trim() || NOT_SET },
    { label: "Base", value: BASE_DESCRIPTION },
  ];

  return (
    <aside
      className={`icon-rail${collapsed ? " collapsed" : ""}`}
      aria-label="Main navigation"
    >
      <div className="sidebar-top">
        <button
          type="button"
          className="sidebar-toggle-btn"
          onClick={onToggle}
          aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
          title={collapsed ? "Show sidebar" : "Hide sidebar"}
          aria-pressed={!collapsed}
        >
          <SidebarToggleIcon collapsed={collapsed} />
        </button>
      </div>

      <div className="sidebar-body" aria-hidden={collapsed}>
      <div className="sidebar-brand">
        <div className="logo-card">
          <img src={logo} alt="Marketeers" className="sidebar-logo" />
        </div>
        <div className="sidebar-brand-text">
          <div className="sidebar-brand-sub">Pricing Simulator</div>
          <div className="sidebar-brand-client" dir="auto">
            {clientLine}
          </div>
        </div>
      </div>

      <div className="sidebar-nav">
        {SECTIONS.map((item) =>
          item.enabled ? (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `rail-item${isActive ? " active" : ""}`}
              tabIndex={collapsed ? -1 : undefined}
            >
              <span className="rail-icon">{item.num}</span>
              <span className="rail-label">{item.label}</span>
            </NavLink>
          ) : (
            <div key={item.to} className="rail-item disabled" title={item.label}>
              <span className="rail-icon">{item.num}</span>
              <span className="rail-label">{item.label}</span>
            </div>
          ),
        )}
      </div>

      <div className="rail-bottom">
        <div className="sidebar-divider" />
        <div className="sidebar-project-details">
          {projectDetails.map((row) => (
            <div
              key={row.label}
              className={`detail-row${row.label === "Base" ? " detail-row-multiline" : ""}`}
            >
              <span className="detail-label">{row.label}</span>
              <span className="detail-sep" aria-hidden="true">
                ·
              </span>
              <span className="detail-value" title={row.value}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
        {onSignOut ? (
          <button type="button" className="sidebar-signout" onClick={onSignOut}>
            Sign out
          </button>
        ) : null}
      </div>
      </div>
    </aside>
  );
}
