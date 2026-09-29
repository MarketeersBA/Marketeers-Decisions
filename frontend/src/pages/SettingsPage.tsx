import { Navigate } from "react-router-dom";

import { useSession } from "../stores/sessionStore";

/** Settings live in the Simulator grid toolbar popover. */
export function SettingsPage() {
  const { session } = useSession();
  return <Navigate to={session ? "/runner" : "/data-hub"} replace />;
}
