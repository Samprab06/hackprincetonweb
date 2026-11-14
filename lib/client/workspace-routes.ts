export const views = {
  intake: "Intake",
  map: "Map",
  site: "Site detail",
  comparison: "Comparison",
  replay: "Replay",
};

export type View = keyof typeof views;

export function workspaceHref(projectId: string, view: View, siteId?: string) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  if (view === "site") return `${base}/sites/${encodeURIComponent(siteId ?? "unselected")}`;
  return `${base}/${view}${siteId ? `?site=${encodeURIComponent(siteId)}` : ""}`;
}
