import { createContext, useContext, type ReactNode } from "react";

/** True when this keep-alive page is the visible sidebar section. */
const PageActiveContext = createContext(true);

export function PageActiveProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return <PageActiveContext.Provider value={active}>{children}</PageActiveContext.Provider>;
}

export function usePageActive(): boolean {
  return useContext(PageActiveContext);
}
