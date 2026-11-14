"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { workspaceHref } from "@/lib/client/workspace-routes";

const CandidateMap = dynamic(() => import("./candidate-map"), {
  ssr: false,
  loading: () => <p role="status" className="grid h-96 place-items-center rounded-lg bg-paper">Loading map…</p>,
});

export function MapPreview({ project, selectedId }: { project: PreviewProject; selectedId?: string }) {
  const sites = project.sites.map((site) => ({ ...site, href: workspaceHref(project.id, "map", site.id) }));
  const selected = sites.find((site) => site.id === selectedId);

  if (!sites.length) return <p role="status">No candidate sites yet.</p>;
  return (
    <>
      <CandidateMap projectId={project.id} sites={sites} selectedId={selected?.id} />
      <ul aria-label="Candidate sites" className="mt-4 grid gap-3 sm:grid-cols-2">
        {sites.map((site) => (
          <li key={site.id}>
            <Link className="block rounded-lg border border-line p-4 hover:bg-mint aria-[current=true]:border-pine aria-[current=true]:bg-mint" aria-current={selected?.id === site.id || undefined} href={site.href}>
              <strong>{site.address}</strong><span className="block text-sm text-muted">{site.neighborhood}</span>
            </Link>
          </li>
        ))}
      </ul>
      {selected && (
        <Link className="mt-4 inline-block font-semibold text-pine underline" href={workspaceHref(project.id, "site", selected.id)}>
          View details for {selected.address}
        </Link>
      )}
    </>
  );
}
