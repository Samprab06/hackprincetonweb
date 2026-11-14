import { expect, it } from "vitest";
import { getPreviewProject } from "../../lib/workspace-preview";
import { getSiteFixture } from "./site-fixtures";

it("provides a mappable listing and catchment for every preview candidate", () => {
  const project = getPreviewProject("houston-coffee");
  expect(project?.sites).toHaveLength(2);
  for (const site of project?.sites ?? []) {
    const fixture = getSiteFixture(site.id);
    expect(fixture?.longitude).toBeCloseTo(-95.4, 1);
    expect(fixture?.latitude).toBeCloseTo(29.8, 0);
    expect(fixture?.rent).toBeGreaterThan(0);
    expect(fixture?.residents).toBeGreaterThan(0);
    expect(fixture?.workers).toBeGreaterThan(0);
  }
});

it("returns no fixture for unknown IDs or inherited keys", () => {
  expect(getSiteFixture("missing")).toBeUndefined();
  expect(getSiteFixture("constructor")).toBeUndefined();
});
