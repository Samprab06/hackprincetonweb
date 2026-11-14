import Link from "next/link";
import { comparisonLink } from "../comparison/comparison-screen";
import {
  exampleComparison,
  exampleComparisonId,
  examplePersonas,
} from "../comparison/example-comparison";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { ReplayPlayer } from "./replay-player";

export function ReplayScreen({
  project,
  visits,
  siteId,
}: {
  project: PreviewProject;
  visits: number;
  siteId?: string;
}) {
  const rows = exampleComparison(project.sites, visits);
  const row = siteId ? rows.find(({ site }) => site.id === siteId) : rows[0];
  if (!row)
    return (
      <p>
        That site has no example run.{" "}
        <Link
          className="underline"
          href={comparisonLink(project.id, "comparison", visits)}
        >
          Open comparison
        </Link>
      </p>
    );

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted">
          Modeled layout · synthetic weekday · default assumptions
        </p>
        <h2 className="mt-2 text-2xl font-semibold">{row.site.address}</h2>
        <p className="mt-2 break-words text-xs text-muted">
          {exampleComparisonId(visits)} · {row.runId}
        </p>
      </div>
      <nav aria-label="Replay sites" className="flex flex-wrap gap-4 text-sm">
        {rows.map(({ site }) => (
          <Link
            key={site.id}
            className="underline aria-[current=page]:font-semibold"
            aria-current={row.site.id === site.id ? "page" : undefined}
            href={comparisonLink(project.id, "replay", visits, site.id)}
          >
            {site.address}
          </Link>
        ))}
        <Link
          className="underline"
          href={comparisonLink(project.id, "comparison", visits)}
        >
          Back to comparison
        </Link>
      </nav>
      <ReplayPlayer key={row.runId} run={row.run} personas={examplePersonas} />
    </div>
  );
}
