import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";

import { Sidebar } from "./Sidebar";
import { ContextBar } from "./ContextBar";
import "./shell.css";

const SIDEBAR_KEY = "ms.sidebarCollapsed";

// Persistent frame — UX_UI_SPEC.md section 4.
export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const toggleSidebar = () => setCollapsed((v) => !v);

  return (
    <div className={`shell${collapsed ? " sidebar-collapsed" : ""}`}>
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      <div className="workspace">
        <ContextBar />
        <main className="page-outlet">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
