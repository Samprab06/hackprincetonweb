import { z } from "zod";

const Id = z.string().min(1);
export const OriginSchema = z.enum(["costar", "public", "founder", "default"]);
export const AssumedValueSchema = z
  .object({
    value: z.number().finite().nullable(),
    unit: z.string().min(1),
    origin: OriginSchema,
    evidenceIds: z.array(Id).min(1),
    unknownReason: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.value === null && !v.unknownReason)
      ctx.addIssue({
        code: "custom",
        path: ["unknownReason"],
        message: "Explain the explicit unknown",
      });
  });
export type AssumedValue = z.infer<typeof AssumedValueSchema>;

export const AssumedFlagSchema = z
  .object({
    value: z.boolean().nullable(),
    unit: z.literal("boolean"),
    origin: OriginSchema,
    evidenceIds: z.array(Id).min(1),
    unknownReason: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (v) => v.value !== null || !!v.unknownReason,
    "Explain the explicit unknown",
  );
export type AssumedFlag = z.infer<typeof AssumedFlagSchema>;
const PriceTier = z
  .object({
    value: z.enum(["budget", "mid", "premium"]).nullable(),
    unit: z.literal("price_tier"),
    origin: OriginSchema,
    evidenceIds: z.array(Id).min(1),
    unknownReason: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (v) => v.value !== null || !!v.unknownReason,
    "Explain the explicit unknown",
  );
const Features = z
  .object({
    frontage: AssumedFlagSchema,
    corner: AssumedFlagSchema,
    parking: AssumedFlagSchema,
    groundFloor: AssumedFlagSchema,
  })
  .strict();

const Nonnegative = AssumedValueSchema.refine(
  (v) => v.value === null || v.value >= 0,
  "Must be nonnegative or explicitly unknown",
);
const Probability = AssumedValueSchema.refine(
  (v) => v.value !== null && v.value >= 0 && v.value <= 1,
  "A known probability in [0, 1] is required",
);
const KnownNonnegative = Nonnegative.refine(
  (v) => v.value !== null,
  "A known value is required",
);
const Minute = z.number().int().min(0).max(1439);
const DayType = z.enum(["weekday", "weekend"]);
const base = { id: Id, projectId: Id, synthetic: z.boolean() };
const sumIsOne = (values: AssumedValue[]) =>
  Math.abs(values.reduce((sum, v) => sum + (v.value ?? 0), 0) - 1) < 1e-8;
const unique = (values: string[]) => new Set(values).size === values.length;

export const EvidenceSchema = z
  .object({
    ...base,
    origin: OriginSchema,
    sourceLabel: z.string().min(1),
    sourceUrl: z.url().nullable(),
    description: z.string().min(1),
    observedAt: z.iso.datetime().nullable(),
    retrievedAt: z.iso.datetime(),
    limitations: z.array(z.string().min(1)),
  })
  .strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const BusinessProfileSchema = z
  .object({
    ...base,
    version: z.number().int().positive(),
    businessName: z.string().min(1),
    concept: z.string().min(1),
    category: z.enum([
      "coffee",
      "quick_food",
      "salon_barber",
      "fitness",
      "unsupported",
    ]),
    unsupportedCategory: z.string().min(1).optional(),
    city: z.enum(["Houston", "Los Angeles"]),
    preferredAreas: z.array(z.string().min(1)),
    avoidedAreas: z.array(z.string().min(1)),
    targetCustomers: z.array(z.string().min(1)).nullable(),
    mustHaves: Features,
    objective: z.string().min(1),
    operatingHours: z
      .object({
        openMinute: Minute,
        closeMinute: z.number().int().min(1).max(1440),
      })
      .refine(
        (v) => v.closeMinute > v.openMinute,
        "Close must follow open within the modeled day",
      ),
    capacity: z.object({ servers: Nonnegative, serviceMinutes: Nonnegative }),
    economics: z.object({
      averageTicketCents: Nonnegative,
      startupBudgetCents: Nonnegative,
      monthlyOperatingBudgetCents: Nonnegative,
      monthlyRentCeilingCents: Nonnegative,
      buildoutBudgetCents: Nonnegative,
      priceTier: PriceTier,
    }),
    derivedDefaults: z.object({
      wageRateCentsPerHour: Nonnegative,
      cogsFraction: AssumedValueSchema.refine(
        (v) => v.value === null || (v.value >= 0 && v.value <= 1),
        "COGS fraction must be in [0, 1] or explicitly unknown",
      ),
      travelMinutes: Nonnegative,
      patienceMinutes: Nonnegative,
    }),
  })
  .strict()
  .refine(
    (v) => v.category !== "unsupported" || !!v.unsupportedCategory,
    "Describe the unsupported category",
  );
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

export const CandidateSchema = z
  .object({
    ...base,
    name: z.string().min(1),
    address: z.string().min(1),
    city: z.enum(["Houston", "Los Angeles"]),
    latitude: AssumedValueSchema.refine(
      (v) => v.value === null || Math.abs(v.value) <= 90,
      "Invalid latitude",
    ),
    longitude: AssumedValueSchema.refine(
      (v) => v.value === null || Math.abs(v.value) <= 180,
      "Invalid longitude",
    ),
    floorAreaSqFt: Nonnegative,
    monthlyRentCents: Nonnegative,
    availableForLease: AssumedFlagSchema,
    features: Features,
  })
  .strict();
export type Candidate = z.infer<typeof CandidateSchema>;

export const CatchmentSchema = z
  .object({
    ...base,
    siteId: Id,
    radiusMeters: Nonnegative,
    residentPopulation: Nonnegative,
    daytimeWorkers: Nonnegative,
    competitors: z.array(
      z.object({
        id: Id,
        name: z.string().min(1),
        category: z.string().min(1),
        distanceMeters: Nonnegative,
      }),
    ),
  })
  .strict();
export type Catchment = z.infer<typeof CatchmentSchema>;

export const PersonaSetSchema = z
  .object({
    ...base,
    profileId: Id,
    version: z.number().int().positive(),
    personas: z
      .array(
        z.object({
          id: Id,
          label: z.string().min(1),
          weight: Probability,
          budgetCents: Nonnegative,
          timePreference: z.enum([
            "early_morning",
            "morning",
            "midday",
            "afternoon",
            "evening",
          ]),
        }),
      )
      .min(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!unique(v.personas.map((p) => p.id)))
      ctx.addIssue({
        code: "custom",
        path: ["personas"],
        message: "Persona IDs must be unique",
      });
    if (!sumIsOne(v.personas.map((p) => p.weight)))
      ctx.addIssue({
        code: "custom",
        path: ["personas"],
        message: "Persona weights must sum to one",
      });
  });
export type PersonaSet = z.infer<typeof PersonaSetSchema>;

export const StayCurveSchema = z
  .object({
    "0": Probability,
    "2": Probability,
    "4": Probability,
    "6": Probability,
    "10": Probability,
  })
  .strict();
const TimeDistribution = z
  .object({
    earlyMorning: Probability,
    morning: Probability,
    midday: Probability,
    afternoon: Probability,
    evening: Probability,
  })
  .strict()
  .refine(
    (v) => sumIsOne(Object.values(v)),
    "Time-block probabilities must sum to one",
  );
export const BehaviorTableSchema = z
  .object({
    ...base,
    siteId: Id,
    personaSetId: Id,
    demandSource: z.enum(["jev", "huff"]),
    modelVersion: z.string().min(1),
    personas: z
      .array(
        z.object({
          personaId: Id,
          where: z
            .array(z.object({ destinationId: Id, share: Probability }))
            .min(1)
            .refine(
              (v) =>
                sumIsOne(v.map((d) => d.share)) &&
                unique(v.map((d) => d.destinationId)),
              "Destination shares must be unique and sum to one",
            ),
          expectedMonthlyVisits: KnownNonnegative,
          timeBlockDistribution: TimeDistribution,
          stayProbabilityByLineLength: StayCurveSchema,
          priceAcceptance: Probability,
          confidence: Probability,
          jevModelVersion: z.string().min(1).nullable(),
          cacheKey: z.string().min(1).nullable(),
        }),
      )
      .min(1),
  })
  .strict()
  .refine(
    (v) => unique(v.personas.map((p) => p.personaId)),
    "Behavior personas must be unique",
  );
export type BehaviorTable = z.infer<typeof BehaviorTableSchema>;

export const ArrivalScheduleSchema = z
  .object({
    ...base,
    siteId: Id,
    behaviorTableId: Id,
    dayType: DayType,
    seed: z.number().int().nonnegative(),
    modelVersion: z.string().min(1),
    demandSource: z.enum(["jev", "huff"]),
    parameters: z
      .object({
        arrivalRatePerHour: KnownNonnegative,
        serviceMinutes: KnownNonnegative,
        ticketCents: KnownNonnegative,
      })
      .strict(),
    customers: z.array(
      z.object({
        customerId: Id,
        personaId: Id,
        arrivalMinute: z.number().min(0).lt(1440),
        stayDraw: z.number().min(0).max(1),
        serviceMinutes: z.number().positive().finite(),
        ticketCents: z.number().int().nonnegative(),
      }),
    ),
    stayProbabilityByPersona: z
      .array(z.object({ personaId: Id, curve: StayCurveSchema }))
      .min(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!unique(v.customers.map((c) => c.customerId)))
      ctx.addIssue({
        code: "custom",
        path: ["customers"],
        message: "Customer IDs must be unique",
      });
    if (!unique(v.stayProbabilityByPersona.map((p) => p.personaId)))
      ctx.addIssue({
        code: "custom",
        path: ["stayProbabilityByPersona"],
        message: "Stay curves must have unique personas",
      });
    if (
      v.customers.some(
        (c, i) => i > 0 && c.arrivalMinute < v.customers[i - 1].arrivalMinute,
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["customers"],
        message: "Customers must be ordered by arrival time",
      });
  });
export type ArrivalSchedule = z.infer<typeof ArrivalScheduleSchema>;

export const SiteRunSchema = z
  .object({
    ...base,
    siteId: Id,
    profileId: Id,
    arrivalScheduleId: Id,
    modelVersion: z.string().min(1),
    seed: z.number().int().nonnegative(),
    dayType: DayType,
    outputKind: z.literal("simulated"),
    metrics: z
      .object({
        completedCustomers: z.number().int().nonnegative(),
        unservedCustomers: z.number().int().nonnegative(),
        revenueCents: z.number().int().nonnegative(),
        includedCostCents: z.number().int().nonnegative(),
        operatingContributionCents: z.number().int(),
        averageWaitMinutes: z.number().nonnegative().finite(),
      })
      .refine(
        (v) =>
          v.operatingContributionCents === v.revenueCents - v.includedCostCents,
        "Contribution must equal revenue minus included costs",
      ),
    events: z.array(
      z.object({
        customerId: Id,
        minute: z.number().nonnegative().finite(),
        type: z.enum(["arrived", "joined", "served", "departed", "abandoned"]),
      }),
    ),
  })
  .strict();
export type SiteRun = z.infer<typeof SiteRunSchema>;

const ContributionRange = z
  .object({
    low: z.number().finite(),
    median: z.number().finite(),
    high: z.number().finite(),
  })
  .refine(
    (v) => v.low <= v.median && v.median <= v.high,
    "Range must be ordered",
  );
export const SiteComparisonSchema = z
  .object({
    ...base,
    profileId: Id,
    modelVersion: z.string().min(1),
    runIds: z.array(Id).min(2).refine(unique, "Run IDs must be unique"),
    results: z
      .array(
        z.object({
          siteId: Id,
          rank: z.number().int().positive(),
          runIds: z.array(Id).min(1),
          operatingContributionCents: ContributionRange,
        }),
      )
      .min(1),
    sensitivity: z.array(
      z.object({
        parameter: z.string().min(1),
        values: z.array(AssumedValueSchema).min(1),
        conclusion: z.string().min(1),
      }),
    ),
    outputKind: z.literal("scenario_comparison"),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      !unique(v.results.map((r) => r.siteId)) ||
      !unique(v.results.map((r) => String(r.rank)))
    )
      ctx.addIssue({
        code: "custom",
        path: ["results"],
        message: "Sites and ranks must be unique",
      });
    if (v.results.some((r) => r.runIds.some((id) => !v.runIds.includes(id))))
      ctx.addIssue({
        code: "custom",
        path: ["results"],
        message: "Results must reference a comparison run",
      });
  });
export type SiteComparison = z.infer<typeof SiteComparisonSchema>;

export const LocationPlanSchema = z
  .object({
    ...base,
    profileId: Id,
    comparisonId: Id,
    recommendedSiteId: Id.nullable(),
    recommendation: z.string().min(1),
    conditions: z.array(z.string().min(1)),
    nextSteps: z.array(z.string().min(1)).min(1),
    evidenceIds: z.array(Id).min(1),
    outputKind: z.literal("scenario_recommendation"),
    notSalesForecast: z.literal(true),
  })
  .strict();
export type LocationPlan = z.infer<typeof LocationPlanSchema>;

export const FixtureBundleSchema = z
  .object({
    label: z.string().min(1),
    synthetic: z.literal(true),
    profile: BusinessProfileSchema,
    candidates: z.array(CandidateSchema).min(1),
    catchments: z.array(CatchmentSchema).min(1),
    personaSet: PersonaSetSchema,
    behaviorTable: BehaviorTableSchema,
    arrivalSchedule: ArrivalScheduleSchema,
    evidence: z.array(EvidenceSchema).min(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const sites = new Set(v.candidates.map((c) => c.id));
    const personas = new Set(v.personaSet.personas.map((p) => p.id));
    const evidence = new Set(v.evidence.map((e) => e.id));
    const entities = [
      v.profile,
      ...v.candidates,
      ...v.catchments,
      v.personaSet,
      v.behaviorTable,
      v.arrivalSchedule,
      ...v.evidence,
    ];
    if (!unique(entities.map((e) => e.id)))
      fail("Fixture entity IDs must be unique");
    if (
      entities.some((e) => e.projectId !== v.profile.projectId || !e.synthetic)
    )
      fail("All fixture entities must belong to one synthetic project");
    if (v.personaSet.profileId !== v.profile.id)
      fail("Persona set must reference the fixture profile");
    if (
      v.catchments.some((c) => !sites.has(c.siteId)) ||
      !unique(v.catchments.map((c) => c.siteId)) ||
      v.catchments.length !== sites.size
    )
      fail("Each fixture site needs exactly one matching catchment");
    if (
      !sites.has(v.behaviorTable.siteId) ||
      !sites.has(v.arrivalSchedule.siteId) ||
      v.arrivalSchedule.siteId !== v.behaviorTable.siteId
    )
      fail("Behavior and schedule must reference the same fixture site");
    if (
      v.behaviorTable.personaSetId !== v.personaSet.id ||
      v.arrivalSchedule.behaviorTableId !== v.behaviorTable.id
    )
      fail("Behavior and schedule references must resolve");
    if (v.arrivalSchedule.demandSource !== v.behaviorTable.demandSource)
      fail("Schedule and behavior demand sources must match");
    if (
      v.behaviorTable.personas.some((p) => !personas.has(p.personaId)) ||
      v.arrivalSchedule.customers.some((c) => !personas.has(c.personaId)) ||
      v.arrivalSchedule.stayProbabilityByPersona.some(
        (p) => !personas.has(p.personaId),
      )
    )
      fail("All persona references must resolve");
    const behaviorPersonas = new Set(
      v.behaviorTable.personas.map((p) => p.personaId),
    );
    const stayPersonas = new Set(
      v.arrivalSchedule.stayProbabilityByPersona.map((p) => p.personaId),
    );
    if (
      [...personas].some(
        (id) => !behaviorPersonas.has(id) || !stayPersonas.has(id),
      )
    )
      fail("Every persona needs a behavior row and a schedule stay curve");
    const currentCatchment = v.catchments.find(
      (c) => c.siteId === v.behaviorTable.siteId,
    );
    const destinations = new Set([
      v.behaviorTable.siteId,
      "none",
      ...(currentCatchment?.competitors.map((c) => c.id) ?? []),
    ]);
    if (
      v.behaviorTable.personas.some((p) =>
        p.where.some((choice) => !destinations.has(choice.destinationId)),
      )
    )
      fail("Destinations must be the current site, its competitors, or none");
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const record = node as Record<string, unknown>;
      if (
        Array.isArray(record.evidenceIds) &&
        record.evidenceIds.some(
          (id) => typeof id !== "string" || !evidence.has(id),
        )
      )
        fail("All evidence references must resolve");
      Object.values(record).forEach(walk);
    };
    walk(v);
  });
export type FixtureBundle = z.infer<typeof FixtureBundleSchema>;
