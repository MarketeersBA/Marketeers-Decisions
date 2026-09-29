/** Numbered workspace sections — the sidebar rail and the context bar read from this. */
export interface SectionMeta {
  to: string;
  /** Two-digit rail number, also shown as "Section NN" in the context bar. */
  num: string;
  /** Short label for the sidebar rail. */
  label: string;
  /** Full heading for the context bar. */
  title: string;
  enabled: boolean;
}

export const SECTIONS: SectionMeta[] = [
  {
    to: "/optimizer",
    num: "01",
    label: "Price Optimization",
    title: "Price Optimization",
    enabled: true,
  },
  {
    to: "/runner",
    num: "02",
    label: "Price Simulation",
    title: 'Price Simulation "What If?"',
    enabled: true,
  },
  {
    to: "/price-pack-architecture",
    num: "03",
    label: "Price-Pack Architecture",
    title: "Price-Pack Architecture",
    enabled: true,
  },
  { to: "/assortment", num: "04", label: "Assortment", title: "Assortment", enabled: true },
  { to: "/data-hub", num: "05", label: "Data Hub & Trust", title: "Data Hub & Trust", enabled: true },
];

const SCENARIO_LIBRARY_SECTION: SectionMeta = {
  to: "/data-hub",
  num: "05",
  label: "Data Hub & Trust",
  title: "Scenario Library",
  enabled: true,
};

export function sectionForPath(pathname: string): SectionMeta | undefined {
  if (/^\/studies\/[^/]+\/scenarios\/?$/.test(pathname)) {
    return SCENARIO_LIBRARY_SECTION;
  }
  return SECTIONS.find((s) => pathname === s.to || pathname.startsWith(`${s.to}/`));
}

/** Routes where the session workspace filter chips apply. */
export const SESSION_WORKSPACE_PATHS = [
  "/optimizer",
  "/runner",
  "/price-pack-architecture",
  "/assortment",
] as const;

export function isSessionWorkspacePath(pathname: string): boolean {
  return SESSION_WORKSPACE_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
