import { useEffect, useState } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation, useParams, useSearchParams } from "react-router-dom";

import { PageLoading } from "./components/PageLoading";
import { PageActiveProvider } from "./hooks/usePageActive";
import { useAuth } from "./auth/AuthProvider";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { DataHubPage } from "./pages/DataHubPage";
import { WizardPage } from "./pages/WizardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ScenariosPage } from "./pages/ScenariosPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AssortmentPage } from "./pages/AssortmentPage";
import { OptimizerPage } from "./pages/OptimizerPage";
import { PricePackArchitecturePage } from "./pages/PricePackArchitecturePage";
import { RunnerPage } from "./pages/RunnerPage";
import { AppShell } from "./shell/AppShell";
import { useSession } from "./stores/sessionStore";

const SESSION_ROUTES = new Set([
  "/optimizer",
  "/runner",
  "/price-pack-architecture",
  "/assortment",
]);

function RequireAuth() {
  const { ready, mode, signedIn } = useAuth();
  if (!ready) return <PageLoading label="Checking sign-in…" />;
  if ((mode === "cognito" || mode === "mock") && !signedIn) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireSession() {
  const { session, restoring } = useSession();
  if (restoring) {
    return <PageLoading label="Restoring session…" />;
  }
  if (!session) return <Navigate to="/data-hub" replace />;
  return <Outlet />;
}

function KeepAliveSlot({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <PageActiveProvider active={active}>
      <div hidden={!active} className="page-keep-alive" aria-hidden={!active}>
        {children}
      </div>
    </PageActiveProvider>
  );
}

/**
 * Keep simulator / optimizer / PPA / assortment mounted after first visit so
 * sidebar navigation preserves state. Hidden pages pause charts and API polling.
 */
function KeepAliveSessionPages() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({
    optimizer: pathname === "/optimizer",
    runner: pathname === "/runner",
    ppa: pathname === "/price-pack-architecture",
    assortment: pathname === "/assortment",
  });

  useEffect(() => {
    setSeen((prev) => {
      const next = { ...prev };
      if (pathname === "/optimizer") next.optimizer = true;
      else if (pathname === "/runner") next.runner = true;
      else if (pathname === "/price-pack-architecture") next.ppa = true;
      else if (pathname === "/assortment") next.assortment = true;
      else return prev;
      if (
        next.optimizer === prev.optimizer &&
        next.runner === prev.runner &&
        next.ppa === prev.ppa &&
        next.assortment === prev.assortment
      ) {
        return prev;
      }
      return next;
    });
  }, [pathname]);

  useEffect(() => {
    if (!SESSION_ROUTES.has(pathname)) return;
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  return (
    <>
      {seen.optimizer && (
        <KeepAliveSlot active={pathname === "/optimizer"}>
          <OptimizerPage />
        </KeepAliveSlot>
      )}
      {seen.runner && (
        <KeepAliveSlot active={pathname === "/runner"}>
          <RunnerPage />
        </KeepAliveSlot>
      )}
      {seen.ppa && (
        <KeepAliveSlot active={pathname === "/price-pack-architecture"}>
          <PricePackArchitecturePage />
        </KeepAliveSlot>
      )}
      {seen.assortment && (
        <KeepAliveSlot active={pathname === "/assortment"}>
          <AssortmentPage />
        </KeepAliveSlot>
      )}
    </>
  );
}

function LegacyCompareRedirect() {
  useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const qs = searchParams.toString();
  return <Navigate to={`/runner${qs ? `?${qs}` : ""}`} replace />;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <SignupPage /> },
  { path: "/confirm", element: <ConfirmPage /> },
  {
    element: <RequireAuth />,
    children: [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "wizard", element: <WizardPage /> },
      { path: "data-hub", element: <DataHubPage /> },
      {
        element: <RequireSession />,
        children: [
          {
            element: <KeepAliveSessionPages />,
            children: [
              { path: "runner", element: null },
              { path: "optimizer", element: null },
              { path: "price-pack-architecture", element: null },
              { path: "assortment", element: null },
            ],
          },
        ],
      },
      { path: "studies/:slug/scenarios", element: <ScenariosPage /> },
      { path: "studies/:slug/compare", element: <LegacyCompareRedirect /> },
      { path: "studies/:slug/analytics", element: <AnalyticsPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
    ],
  },
]);
