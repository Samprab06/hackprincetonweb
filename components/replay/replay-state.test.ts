import { expect, test } from "vitest";
import { getPreviewProject } from "@/lib/workspace-preview";
import { exampleComparison } from "../comparison/example-comparison";
import { replayAt } from "./replay-state";

test("seeking backward reproduces the same frame and closing totals match the selected run", () => {
  const project = getPreviewProject("houston-coffee")!;
  const rows = exampleComparison(project.sites, 0.8);
  expect(
    exampleComparison(project.sites, 0.8).map(({ runId }) => runId),
  ).toEqual(rows.map(({ runId }) => runId));
  for (const { run } of rows) {
    const target = run.metrics.openMin + 120;
    const frame = replayAt(run.events, target);
    expect(frame.arrivals.size).toBeGreaterThan(0);
    const closing = replayAt(run.events, run.metrics.closeMin);
    expect(closing.served).toBe(run.metrics.served);
    expect(closing.left).toBe(run.metrics.abandoned);
    expect(replayAt(run.events, target)).toEqual(frame);
  }
});
