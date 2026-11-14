import type { ReactNode } from "react";
import Link from "next/link";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { workspaceHref } from "@/lib/client/workspace-routes";
import { catchmentRadiusMiles, evidenceDate, getSiteFixture } from "./site-fixtures";

export function SiteDetail({ project, site }: { project: PreviewProject; site: PreviewProject["sites"][number] }) {
  const fixture = getSiteFixture(site.id);
  if (!fixture) return (
    <div>
      <p role="status">No listing details are available for this candidate yet.</p>
      <Link className="mt-3 inline-block font-semibold text-pine underline" href={workspaceHref(project.id, "map", site.id)}>Back to map</Link>
    </div>
  );

  const facts = [
    ["Suite", fixture.suite],
    ["Size", <Evidence key="size" source="listing">{format(site.squareFeet)} sq ft</Evidence>],
    ["Asking rent", <Evidence key="rent" source="listing">${format(fixture.rent)}/SF/year</Evidence>],
    ["Service type", project.business],
    ["Position", fixture.position],
    ["Catchment radius", <Evidence key="radius" source="catchment">{catchmentRadiusMiles} mile</Evidence>],
    ["Residents", <Evidence key="residents" source="catchment">{format(fixture.residents)}</Evidence>],
    ["Workers", <Evidence key="workers" source="catchment">{format(fixture.workers)}</Evidence>],
  ] as const;

  return (
    <>
      <Link href={workspaceHref(project.id, "map", site.id)} className="text-sm font-semibold text-pine underline">Back to map</Link>
      <h2 className="mt-4 text-2xl font-semibold">{site.address}</h2>
      <p className="mt-1 text-muted">{site.neighborhood}</p>
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <dl className="grid grid-cols-2 gap-4">
          {facts.map(([label, value]) => <div key={label}><dt className="text-sm text-muted">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}
        </dl>
        <figure>
          <div aria-label="Illustrative floor plan" className="grid min-h-44 grid-cols-3 grid-rows-2 gap-1 rounded-lg border border-line bg-line p-1 text-center text-sm">
            <div className="col-span-2 row-span-2 grid place-items-center bg-mint p-3">Customer area</div>
            <div className="grid place-items-center bg-paper p-2">Counter</div>
            <div className="grid place-items-center bg-paper p-2">Prep</div>
          </div>
          <figcaption className="mt-2 text-sm text-muted">Illustrative floor plan</figcaption>
        </figure>
      </div>
      <aside aria-label="Evidence" className="mt-8 grid gap-4 border-t border-line pt-5 text-sm">
        <p id="listing-source" tabIndex={-1}><strong>Listing source</strong> · Synthetic listing fixture · <time dateTime={evidenceDate}>{evidenceDate}</time></p>
        <p id="catchment-source" tabIndex={-1}><strong>Catchment source</strong> · Synthetic resident and worker estimates · <time dateTime={evidenceDate}>{evidenceDate}</time></p>
      </aside>
    </>
  );
}

function Evidence({ source, children }: { source: "listing" | "catchment"; children: ReactNode }) {
  return <a href={`#${source}-source`} className="text-pine underline decoration-dotted underline-offset-4">{children} <span className="text-xs text-muted">default</span></a>;
}

function format(value: number) {
  return value.toLocaleString("en-US");
}
