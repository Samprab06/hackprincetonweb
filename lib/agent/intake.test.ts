import { describe, expect, it } from "vitest";
import { BusinessProfileSchema } from "@/lib/contracts";
import { createIntakeSession, INTAKE_QUESTIONS } from "./intake";

import { number, founderAnswers } from "./__fixtures__/founder";

describe("founder intake", () => {
  it("asks all seven question groups without fabricating a complete profile", () => {
    const state = createIntakeSession("project-1").snapshot();
    expect(INTAKE_QUESTIONS).toHaveLength(7);
    expect(state.profile).toBeNull();
    expect(state.missingRequiredFields).toContain("businessName");
    expect(state.persisted).toBe(false);
  });

  it.each(["coffee", "quick_food", "salon_barber", "fitness"])(
    "fills a canonical %s profile through a scripted seven-group conversation",
    (category) => {
      const session = createIntakeSession("project-1");
      for (const answer of founderAnswers)
        session.saveProfile(
          "category" in answer ? { ...answer, category } : answer,
        );
      const result = session.snapshot();
      expect(BusinessProfileSchema.parse(result.profile).projectId).toBe(
        "project-1",
      );
      expect(result.profile?.category).toBe(category);
      expect(result.missingRequiredFields).toEqual([]);
      expect(result.nextQuestion).toBeNull();
      expect(result.profile?.capacity.serviceMinutes.origin).toBe("default");
      expect(
        result.findings.some((finding) =>
          finding.includes("startupBudgetCents"),
        ),
      ).toBe(true);
    },
  );

  it("allows founder overrides of every default, including supplemental assumptions", () => {
    const session = createIntakeSession("project-1");
    session.saveProfile({ category: "coffee" });
    const peaks = Object.fromEntries(
      ["earlyMorning", "morning", "midday", "afternoon", "evening"].map(
        (key) => [key, number(0.2, "share")],
      ),
    );
    session.saveProfile({
      capacity: { serviceMinutes: number(6, "minutes") },
      derivedDefaults: {
        travelMinutes: number(15, "minutes"),
        patienceMinutes: number(12, "minutes"),
        wageRateCentsPerHour: number(1800, "cents/hour"),
        cogsFraction: number(0.25, "fraction"),
      },
      assumptions: {
        visitsPerMonth: number(8, "visits/month"),
        squareFeetPerStation: number(70, "sqft/station"),
        minimumFrontOfHouseSqFt: number(600, "sqft"),
        peakHourProfile: peaks,
      },
    });
    const result = session.snapshot();
    expect(result.draft.capacity?.serviceMinutes?.origin).toBe("founder");
    expect(result.assumptions.visitsPerMonth?.origin).toBe("founder");
    expect(
      Object.values(result.assumptions.peakHourProfile ?? {}).every(
        (value) => value.origin === "founder",
      ),
    ).toBe(true);
    session.saveProfile({ category: "fitness" });
    expect(session.snapshot().draft.capacity?.serviceMinutes?.value).toBe(6);
    expect(session.snapshot().assumptions.visitsPerMonth?.value).toBe(8);
  });

  it("records unsupported categories without pretending they are calibrated", () => {
    const session = createIntakeSession("project-1");
    for (const answer of founderAnswers) session.saveProfile(answer);
    session.saveProfile({
      category: "clothing store",
      capacity: { serviceMinutes: number(null, "minutes") },
      derivedDefaults: {
        travelMinutes: number(null, "minutes"),
        patienceMinutes: number(null, "minutes"),
        wageRateCentsPerHour: number(null, "cents/hour"),
        cogsFraction: number(null, "fraction"),
      },
    });
    expect(session.snapshot().profile?.category).toBe("unsupported");
    expect(session.snapshot().profile?.unsupportedCategory).toBe(
      "clothing store",
    );
    expect(session.snapshot().findings.join(" ")).toContain("unsupported");
    expect(session.snapshot().assumptions).toEqual({});
  });

  it("validates patches atomically and does not hide invalid nested data", () => {
    const session = createIntakeSession("project-1");
    session.saveProfile({ businessName: "Before" });
    expect(() =>
      session.saveProfile({ businessName: "After", economics: { bogus: 4 } }),
    ).toThrow();
    expect(() => session.saveProfile({ city: "Boston" })).toThrow();
    expect(() => session.saveProfile({ projectId: "another" })).toThrow();
    expect(() =>
      session.saveProfile({
        operatingHours: { openMinute: 1000, closeMinute: 500 },
      }),
    ).toThrow();
    expect(session.snapshot().draft.businessName).toBe("Before");
    session.saveProfile({ operatingHours: { openMinute: 1000 } });
    expect(() =>
      session.saveProfile({ operatingHours: { closeMinute: 500 } }),
    ).toThrow();
    expect(session.snapshot().draft.operatingHours).toEqual({
      openMinute: 1000,
    });
  });

  it("round trips partial state without memory or cross-project identity", () => {
    const initial = createIntakeSession("project-1");
    initial.saveProfile({ category: "coffee", businessName: "Draft" });
    const { draft, assumptions } = initial.snapshot();
    const restored = createIntakeSession("project-2", {
      draft,
      assumptions,
    }).snapshot();
    expect(restored.draft.businessName).toBe("Draft");
    expect(restored.profile).toBeNull();
  });
});
