import { z } from "zod";
import { AssumedValueSchema, BusinessProfileSchema } from "./index";

const shape = BusinessProfileSchema.shape;
const nonnegative = AssumedValueSchema.refine(
  (entry) => entry.value === null || entry.value >= 0,
  "Must be nonnegative or explicitly unknown",
);
const probability = AssumedValueSchema.refine(
  (entry) => entry.value !== null && entry.value >= 0 && entry.value <= 1,
  "A known share in [0, 1] is required",
);
export const PeakHourProfileSchema = z
  .object({
    earlyMorning: probability,
    morning: probability,
    midday: probability,
    afternoon: probability,
    evening: probability,
  })
  .strict()
  .refine(
    (profile) =>
      Math.abs(
        Object.values(profile).reduce(
          (sum, entry) => sum + (entry.value ?? 0),
          0,
        ) - 1,
      ) < 1e-8,
    "Peak hour shares must sum to one",
  );
export const IntakeAssumptionsSchema = z
  .object({
    visitsPerMonth: nonnegative.optional(),
    squareFeetPerStation: nonnegative.optional(),
    minimumFrontOfHouseSqFt: nonnegative.optional(),
    peakHourProfile: PeakHourProfileSchema.optional(),
  })
  .strict();

// Keep the canonical leaf constraints while allowing an unfinished interview.
// Metadata belongs to the route/session, never to a founder or model patch.
export const IntakeDraftSchema = z
  .object({
    businessName: shape.businessName.optional(),
    concept: shape.concept.optional(),
    category: shape.category.optional(),
    unsupportedCategory: shape.unsupportedCategory,
    city: shape.city.optional(),
    preferredAreas: shape.preferredAreas.optional(),
    avoidedAreas: shape.avoidedAreas.optional(),
    targetCustomers: shape.targetCustomers.optional(),
    mustHaves: shape.mustHaves.partial().strict().optional(),
    objective: shape.objective.optional(),
    operatingHours: z
      .object(shape.operatingHours.shape)
      .partial()
      .strict()
      .refine(
        (hours) =>
          hours.openMinute === undefined ||
          hours.closeMinute === undefined ||
          hours.closeMinute > hours.openMinute,
        "Close must follow open within the modeled day",
      )
      .optional(),
    capacity: shape.capacity.partial().strict().optional(),
    economics: shape.economics.partial().strict().optional(),
    derivedDefaults: shape.derivedDefaults.partial().strict().optional(),
  })
  .strict();
export const IntakePatchSchema = IntakeDraftSchema.extend({
  category: z.string().trim().min(1).max(100).optional(),
  assumptions: IntakeAssumptionsSchema.optional(),
}).strict();
export const IntakeStateSchema = z
  .object({
    draft: IntakeDraftSchema,
    assumptions: IntakeAssumptionsSchema,
  })
  .strict();
export const IntakeRequestSchema = z
  .object({
    state: IntakeStateSchema.optional(),
    patch: IntakePatchSchema.optional(),
    message: z.string().trim().min(1).max(8000).optional(),
  })
  .strict();
export type IntakeDraft = z.infer<typeof IntakeDraftSchema>;
export type IntakeAssumptions = z.infer<typeof IntakeAssumptionsSchema>;
export type IntakeState = z.infer<typeof IntakeStateSchema>;
