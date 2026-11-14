import { describe, expect, it } from "vitest";
import {
  ArrivalScheduleSchema,
  AssumedValueSchema,
  BehaviorTableSchema,
  BusinessProfileSchema,
  CandidateSchema,
  CatchmentSchema,
  EvidenceSchema,
  FixtureBundleSchema,
  PersonaSetSchema,
  SiteRunSchema,
  SiteComparisonSchema,
  LocationPlanSchema,
} from "./index";
import { syntheticHoustonFixture } from "../../fixtures/houston-coffee";

describe("shared synthetic business contracts", () => {
  it("validates the full Houston fixture and every supplied entity", () => {
    const f = syntheticHoustonFixture;
    expect(FixtureBundleSchema.safeParse(f).success).toBe(true);
    expect(BusinessProfileSchema.safeParse(f.profile).success).toBe(true);
    expect(f.candidates).toHaveLength(3);
    for (const candidate of f.candidates)
      expect(CandidateSchema.safeParse(candidate).success).toBe(true);
    for (const catchment of f.catchments)
      expect(CatchmentSchema.safeParse(catchment).success).toBe(true);
    expect(PersonaSetSchema.safeParse(f.personaSet).success).toBe(true);
    expect(BehaviorTableSchema.safeParse(f.behaviorTable).success).toBe(true);
    expect(ArrivalScheduleSchema.safeParse(f.arrivalSchedule).success).toBe(
      true,
    );
    for (const evidence of f.evidence)
      expect(EvidenceSchema.safeParse(evidence).success).toBe(true);
  });

  it("requires a reason for an explicit unknown and preserves a genuine zero", () => {
    const base = {
      unit: "USD/month",
      origin: "default",
      evidenceIds: ["ev-default"],
    };
    expect(AssumedValueSchema.safeParse({ ...base, value: null }).success).toBe(
      false,
    );
    expect(
      AssumedValueSchema.parse({
        ...base,
        value: null,
        unknownReason: "Owner has not provided this cost",
      }).value,
    ).toBeNull();
    expect(AssumedValueSchema.parse({ ...base, value: 0 }).value).toBe(0);
  });

  it("rejects absent provenance and unsupported origins", () => {
    expect(
      AssumedValueSchema.safeParse({ value: 10, unit: "minutes" }).success,
    ).toBe(false);
    expect(
      AssumedValueSchema.safeParse({
        value: 10,
        unit: "minutes",
        origin: "model_guess",
        evidenceIds: ["ev-default"],
      }).success,
    ).toBe(false);
    expect(
      AssumedValueSchema.safeParse({
        value: 10,
        unit: "minutes",
        origin: "default",
        evidenceIds: [],
      }).success,
    ).toBe(false);
  });

  it("rejects invalid probability bounds and distributions", () => {
    const f = structuredClone(syntheticHoustonFixture);
    f.behaviorTable.personas[0].priceAcceptance.value = 1.2;
    expect(BehaviorTableSchema.safeParse(f.behaviorTable).success).toBe(false);
    const g = structuredClone(syntheticHoustonFixture);
    g.behaviorTable.personas[0].where[0].share.value = 0.99;
    expect(BehaviorTableSchema.safeParse(g.behaviorTable).success).toBe(false);
  });

  it("rejects impossible schedule draws", () => {
    const f = structuredClone(syntheticHoustonFixture);
    f.arrivalSchedule.customers[0].arrivalMinute = 1440;
    expect(ArrivalScheduleSchema.safeParse(f.arrivalSchedule).success).toBe(
      false,
    );
    const g = structuredClone(syntheticHoustonFixture);
    g.arrivalSchedule.customers[0].stayDraw = 1.1;
    expect(ArrivalScheduleSchema.safeParse(g.arrivalSchedule).success).toBe(
      false,
    );
  });

  it("rejects unknown persona and site references in a bundle", () => {
    const f = structuredClone(syntheticHoustonFixture);
    f.arrivalSchedule.customers[0].personaId = "missing-persona";
    expect(FixtureBundleSchema.safeParse(f).success).toBe(false);
    const g = structuredClone(syntheticHoustonFixture);
    g.catchments[0].siteId = "missing-site";
    expect(FixtureBundleSchema.safeParse(g).success).toBe(false);
  });

  it.each(["behavior", "stay curve"])(
    "rejects a scheduled persona missing its %s lookup",
    (lookup) => {
      const fixture = structuredClone(syntheticHoustonFixture);
      if (lookup === "behavior") fixture.behaviorTable.personas.pop();
      else fixture.arrivalSchedule.stayProbabilityByPersona.pop();
      expect(FixtureBundleSchema.safeParse(fixture).success).toBe(false);
    },
  );

  it("rejects silently omitted persona-model coverage even before arrivals are emitted", () => {
    const fixture = structuredClone(syntheticHoustonFixture);
    const persona = fixture.personaSet.personas[0];
    fixture.personaSet.personas.push({
      ...persona,
      id: "persona-not-modeled",
      weight: { ...persona.weight, value: 0 },
    });
    expect(FixtureBundleSchema.safeParse(fixture).success).toBe(false);
  });

  it.each(["ghost-site", "site-synthetic-b", "competitor-2"])(
    "rejects destination %s outside the current site's choice set",
    (destinationId) => {
      const fixture = structuredClone(syntheticHoustonFixture);
      fixture.behaviorTable.personas[0].where[0].destinationId = destinationId;
      expect(FixtureBundleSchema.safeParse(fixture).success).toBe(false);
    },
  );

  it("rejects evidence references that are not in the fixture", () => {
    const f = structuredClone(syntheticHoustonFixture);
    f.profile.economics.averageTicketCents.evidenceIds = ["not-a-source"];
    expect(FixtureBundleSchema.safeParse(f).success).toBe(false);
  });

  it("records an unsupported category without pretending it is supported", () => {
    const profile = {
      ...syntheticHoustonFixture.profile,
      category: "unsupported",
      unsupportedCategory: "car wash",
    };
    expect(BusinessProfileSchema.safeParse(profile).success).toBe(true);
    expect(
      BusinessProfileSchema.safeParse({ ...profile, unsupportedCategory: "" })
        .success,
    ).toBe(false);
  });

  it("preserves unknown lease status as sourced unknown, never false", () => {
    const flag = {
      value: null,
      unit: "boolean",
      origin: "default",
      evidenceIds: ["ev-synthetic-default"],
      unknownReason: "Availability has not been verified",
    };
    const candidate = {
      ...syntheticHoustonFixture.candidates[0],
      availableForLease: flag,
    };
    expect(CandidateSchema.safeParse(candidate).success).toBe(true);
    expect(
      CandidateSchema.safeParse({
        ...candidate,
        availableForLease: { ...flag, unknownReason: undefined },
      }).success,
    ).toBe(false);
  });

  it("validates simulated run totals, comparison ranges and a grounded plan", () => {
    const base = {
      projectId: syntheticHoustonFixture.profile.projectId,
      synthetic: true,
    };
    const run = {
      ...base,
      id: "run-a",
      siteId: "site-synthetic-a",
      profileId: "profile-coffee-v1",
      arrivalScheduleId: "arrivals-a-weekday-seed1",
      modelVersion: "test-v1",
      seed: 1,
      dayType: "weekday",
      outputKind: "simulated",
      metrics: {
        completedCustomers: 2,
        unservedCustomers: 0,
        revenueCents: 1300,
        includedCostCents: 400,
        operatingContributionCents: 900,
        averageWaitMinutes: 1,
      },
      events: [],
    };
    expect(SiteRunSchema.safeParse(run).success).toBe(true);
    expect(
      SiteRunSchema.safeParse({
        ...run,
        metrics: { ...run.metrics, operatingContributionCents: 9999 },
      }).success,
    ).toBe(false);
    const comparison = {
      ...base,
      id: "comparison-1",
      profileId: run.profileId,
      modelVersion: "test-v1",
      runIds: ["run-a", "run-b"],
      results: [
        {
          siteId: run.siteId,
          rank: 1,
          runIds: ["run-a", "run-b"],
          operatingContributionCents: { low: 700, median: 900, high: 1100 },
        },
      ],
      sensitivity: [],
      outputKind: "scenario_comparison",
    };
    expect(SiteComparisonSchema.safeParse(comparison).success).toBe(true);
    expect(
      SiteComparisonSchema.safeParse({
        ...comparison,
        results: [
          {
            ...comparison.results[0],
            operatingContributionCents: { low: 1100, median: 900, high: 700 },
          },
        ],
      }).success,
    ).toBe(false);
    const plan = {
      ...base,
      id: "plan-1",
      profileId: run.profileId,
      comparisonId: comparison.id,
      recommendedSiteId: null,
      recommendation: "Collect the missing cost input before choosing a site",
      conditions: ["Operating budget remains unknown"],
      nextSteps: ["Confirm monthly operating costs with the founder"],
      evidenceIds: ["ev-synthetic-default"],
      outputKind: "scenario_recommendation",
      notSalesForecast: true,
    };
    expect(LocationPlanSchema.safeParse(plan).success).toBe(true);
    expect(
      LocationPlanSchema.safeParse({ ...plan, notSalesForecast: false })
        .success,
    ).toBe(false);
  });
});
