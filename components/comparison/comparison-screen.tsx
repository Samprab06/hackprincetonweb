import Link from "next/link";
import { workspaceHref } from "@/lib/client/workspace-routes";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { exampleComparison, exampleComparisonId } from "./example-comparison";
import { ConsultantPanel } from "../ConsultantPanel";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const scenarios = [0.8, 1, 1.2];

export function comparisonScenario(value?: string | string[]) {
  return scenarios.find((scenario) => String(scenario) === value) ?? 1;
}

export function comparisonLink(
  projectId: string,
  view: "comparison" | "replay",
  scenario: number,
  siteId?: string,
) {
  const path = workspaceHref(projectId, view, siteId);
  return `${path}${siteId ? "&" : "?"}visits=${scenario}`;
}

export function ComparisonScreen({
  project,
  visits,
  previousId,
  investigationId,
}: {
  project: PreviewProject;
  visits: number;
  previousId?: string;
  investigationId?: string;
}) {
  const rows = exampleComparison(project.sites, visits);
  const id = exampleComparisonId(visits);
  const leader = rows[0];
  const overlaps = rows.slice(1).filter((row) => row.high >= leader.low);
  const checks = scenarios
    .filter((scenario) => scenario !== visits)
    .map((scenario) => ({
      scenario,
      first: exampleComparison(project.sites, scenario)[0].site,
    }));

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted">
          Synthetic Houston scenario · default assumptions
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          Monthly operating scenarios
        </h2>
        <p className="mt-2 text-muted">
          Contribution after included costs across 24 seeded scenarios. The 90%
          interval describes modeled outcomes.
        </p>
      </div>
      {previousId && previousId !== id && (
        <p role="status" className="rounded-lg border border-line bg-paper p-3">
          This comparison is outdated.{" "}
          <Link
            className="font-semibold underline"
            href={comparisonLink(project.id, "comparison", visits)}
          >
            Rerun comparison
          </Link>
        </p>
      )}
      <form className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-medium">
          Visit frequency
          <select
            name="visits"
            defaultValue={visits}
            className="rounded-lg border border-line p-2"
          >
            {scenarios.map((scenario) => (
              <option key={scenario} value={scenario}>
                {Math.round(scenario * 100)}% of baseline
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white">
          Run scenario
        </button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <caption className="pb-3 text-left text-muted">
            Comparison {id}
          </caption>
          <thead>
            <tr>
              <th scope="col">Rank and space</th>
              <th scope="col">Mean</th>
              <th scope="col">90% interval</th>
              <th scope="col">Representative run</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.site.id} className="border-t border-line">
                <th scope="row" className="py-4 pr-4">
                  {index + 1}. {row.site.address}
                  {overlaps.length > 0 &&
                    (index === 0 || overlaps.includes(row)) && (
                      <span className="mt-1 block text-xs font-medium text-muted">
                        Modeled tie · intervals overlap
                      </span>
                    )}
                </th>
                <td className="pr-4">{currency.format(row.mean)}</td>
                <td className="pr-4">
                  {currency.format(row.low)} to {currency.format(row.high)}
                </td>
                <td>
                  <Link
                    className="font-semibold text-pine underline"
                    href={comparisonLink(
                      project.id,
                      "replay",
                      visits,
                      row.site.id,
                    )}
                  >
                    Replay day
                  </Link>
                  <span className="block text-xs text-muted">{row.runId}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-line p-4">
          <h3 className="font-semibold">Visit-frequency sensitivity</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {checks.map(({ scenario, first }) => (
              <li key={scenario}>
                {Math.round(scenario * 100)}% of baseline: {first.address} leads
                by mean contribution
                {first.id !== leader.site.id && " (ranking changes)"}.
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            The displayed order uses synthetic Huff-style demand assumptions. A
            separate Jev comparison is pending.
          </p>
        </section>
        <section className="rounded-xl border border-line p-4">
          <h3 className="font-semibold">Example location plan</h3>
          <p className="mt-2 text-sm">
            {overlaps.length
              ? "Keep both sites on the shortlist while their contribution ranges overlap."
              : `Shortlist ${leader.site.address} for a lease review.`}{" "}
            Confirm rent and customer demand before selecting a location.{" "}
            <a href="#example-evidence" className="underline">
              [1]
            </a>
          </p>
          <p className="mt-2 break-words text-xs text-muted">
            {id} · {leader.runId}
          </p>
          <p id="example-evidence" className="mt-3 text-xs text-muted">
            [1] Synthetic fixture defaults for demand, rent, labor, prices, and
            service time.
          </p>
        </section>
      </div>
      <ConsultantPanel key={investigationId} investigationId={investigationId} />
    </div>
  );
}
