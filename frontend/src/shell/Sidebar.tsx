import { NavLink } from "react-router-dom";

import { useSession } from "../stores/sessionStore";
import logo from "../assets/logo.png";
import { SECTIONS } from "./sections";
import "./shell.css";

const NOT_SET = "Not set";
const BASE_DESCRIPTION = "Choice-based conjoint, calibrated to NIQ/Circana";

function SignOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.5 3.25H4.2A1.2 1.2 0 0 0 3 4.45v7.1a1.2 1.2 0 0 0 1.2 1.2h2.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M7.25 8h6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M11.1 5.6 13.5 8l-2.4 2.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Sidebar({
  collapsed,
  onSignOut,
}: {
  collapsed: boolean;
  onSignOut?: () => void;
}) {
  const { session } = useSession();

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
      <div className="sidebar-body" aria-hidden={collapsed}>
      <div className="sidebar-brand">
        <div className="logo-card">
          <img src={logo} alt="Marketeers" className="sidebar-logo" />
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
            <SignOutIcon />
            Sign out
          </button>
        ) : null}
      </div>
      </div>
    </aside>
  );
}
