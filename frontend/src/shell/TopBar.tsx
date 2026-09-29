import { useLocation } from "react-router-dom";

import { useSession } from "../stores/sessionStore";

const PAGE_TITLES: Record<string, string> = {
  "/": "Home",
  "/runner": "Simulator",
};

export function TopBar() {
  const { pathname } = useLocation();
  const { session } = useSession();
  const page = PAGE_TITLES[pathname] ?? "";
  return (
    <header className="topbar">
      <span className="topbar-logo">Market Simulator</span>
      <span className="breadcrumb">
        Home
        {session ? <span dir="auto"> / {session.study.studyName}</span> : null}
        {page && page !== "Home" ? ` / ${page}` : ""}
      </span>
    </header>
  );
}
