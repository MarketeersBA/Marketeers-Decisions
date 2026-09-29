import { Navigate } from "react-router-dom";

import { useSession } from "../stores/sessionStore";

export function HomePage() {
  const { session } = useSession();
  return <Navigate to={session ? "/optimizer" : "/data-hub"} replace />;
}
