import { describe, expect, it } from "vitest";
import { categoryDefaults, CategoryDefaultsSchema } from "./defaults";

describe("category default fixtures", () => {
  it.each(["coffee", "quick_food", "salon_barber", "fitness"])(
    "validates %s provenance and all ten assumption groups",
    (category) => {
      const defaults = categoryDefaults(category)!;
      expect(defaults.category).toBe(category);
      expect(Object.keys(defaults.values)).toHaveLength(8);
      expect(Object.keys(defaults.peakHourProfile)).toHaveLength(5);
      const ids = new Set(defaults.sources.map((source) => source.id));
      for (const entry of [
        ...Object.values(defaults.values),
        ...Object.values(defaults.peakHourProfile),
      ]) {
        expect(entry.origin).toBe("default");
        expect(entry.evidenceIds.every((id) => ids.has(id))).toBe(true);
      }
      expect(
        defaults.sources.some((source) =>
          source.limitations.some((limit) => limit.includes("Uncalibrated")),
        ),
      ).toBe(true);
    },
  );

  it("rejects unresolved evidence, founder-attributed defaults, and invalid peak shares", () => {
    const defaults = categoryDefaults("coffee")!;
    expect(
      CategoryDefaultsSchema.safeParse({ ...defaults, sources: [] }).success,
    ).toBe(false);
    defaults.values.travelMinutes.origin = "founder";
    expect(CategoryDefaultsSchema.safeParse(defaults).success).toBe(false);
    const invalidPeaks = categoryDefaults("coffee")!;
    invalidPeaks.peakHourProfile.morning.value = 1;
    expect(CategoryDefaultsSchema.safeParse(invalidPeaks).success).toBe(false);
    expect(categoryDefaults("clothing store")).toBeNull();
  });
});
