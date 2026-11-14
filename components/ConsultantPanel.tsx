"use client";

import { useEffect, useState } from "react";
import { z } from "zod";

const investigation = z.object({
  status: z.enum(["queued", "running", "succeeded", "failed", "interrupted"]),
  milestones: z.array(z.object({ id: z.string(), title: z.string() })),
});

export function ConsultantPanel({
  investigationId,
}: {
  investigationId?: string;
}) {
  const [job, setJob] = useState<z.infer<typeof investigation>>();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!investigationId) return;
    const controller = new AbortController();
    const url = `/api/investigations/${encodeURIComponent(investigationId)}`;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Status unavailable");
        const next = investigation.parse(await response.json());
        if (controller.signal.aborted) return;
        setJob(next);
        setError(false);
        if (next.status === "running") {
          const advance = await fetch(`${url}/advance`, {
            method: "POST",
            signal: controller.signal,
          });
          if (!advance.ok) throw new Error("Could not advance investigation");
        } else if (next.status !== "queued") {
          return;
        }
      } catch {
        if (controller.signal.aborted) return;
        setError(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [investigationId]);

  return (
    <section className="rounded-xl border border-line p-4">
      <h3 className="font-semibold">Consultant activity</h3>
      <p role="status" className="mt-2 text-sm text-muted">
        {error
          ? "Investigation update unavailable. Retrying."
          : (job?.status ??
            (investigationId
              ? "Loading investigation..."
              : "No investigation linked to this comparison."))}
      </p>
      {job && (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          {job.milestones.map((milestone) => (
            <li key={milestone.id}>{milestone.title}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
