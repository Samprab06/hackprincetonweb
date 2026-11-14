import { z } from "zod";
import {
  AssumedFlagSchema,
  AssumedValueSchema,
  CatchmentSchema,
  EvidenceSchema,
} from "./index";

export const CatchmentCategorySchema = z.enum([
  "coffee",
  "quick_food",
  "salon_barber",
  "fitness",
]);
export const RoadTypeSchema = z.enum([
  "local",
  "collector",
  "arterial",
  "unknown",
]);
export const CatchmentRequestSchema = z
  .object({
    projectId: z.string().trim().min(1),
    category: CatchmentCategorySchema,
    radiusMeters: z.coerce.number().finite().min(100).max(20000).default(1000),
    roadType: RoadTypeSchema.optional(),
  })
  .strict();
export type CatchmentRequest = z.infer<typeof CatchmentRequestSchema>;
export const CatchmentQuerySchema = CatchmentRequestSchema;
export type CatchmentQuery = CatchmentRequest;

const metric = AssumedValueSchema.refine(
  (v) => v.value === null || v.value >= 0,
);
const bands = z.record(z.string(), metric);
const ids = z.array(z.string().min(1)).min(1);
export const CatchmentResponseSchema = z
  .object({
    catchment: CatchmentSchema,
    residents: z
      .object({
        population: metric,
        households: metric,
        ageBands: bands,
        blockGroups: z.array(
          z
            .object({
              geoid: z.string(),
              areaFraction: metric,
              population: metric,
              households: metric,
              medianHouseholdIncome: metric,
              ageBands: bands,
              allocatedPopulation: metric,
              allocatedHouseholds: metric,
              allocatedAgeBands: bands,
            })
            .strict(),
        ),
      })
      .strict(),
    workers: z
      .object({
        jobs: metric,
        blocks: z.array(z.object({ geoid: z.string(), jobs: metric }).strict()),
      })
      .strict(),
    passBy: z
      .object({
        vehiclesPerDay: metric,
        missingTrafficCount: AssumedFlagSchema,
        roadType: RoadTypeSchema,
        roadTypeOrigin: z.enum(["founder", "default"]),
        selection: z.string(),
      })
      .strict(),
    competitors: z.array(
      z
        .object({
          id: z.string(),
          name: z.string().nullable(),
          category: CatchmentCategorySchema,
          distanceMeters: metric,
          evidenceIds: ids,
          sourceIds: z.array(z.string()),
        })
        .strict(),
    ),
    coTenants: z.array(
      z
        .object({
          id: z.string(),
          name: z.string().nullable(),
          industry: z.string().nullable(),
          occupiedSqFt: metric,
          role: z.enum(["complement", "anchor", "other"]),
          roleOrigin: z.literal("default"),
          evidenceIds: ids,
        })
        .strict(),
    ),
    evidence: z.array(EvidenceSchema),
    limitations: z.array(z.string()),
  })
  .strict()
  .superRefine((response, ctx) => {
    const ids = new Set(response.evidence.map((e) => e.id));
    function visit(value: unknown): void {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      for (const [key, entry] of Object.entries(value)) {
        if (key === "evidenceIds" && Array.isArray(entry)) {
          for (const id of entry)
            if (!ids.has(id))
              ctx.addIssue({
                code: "custom",
                message: `Unresolved evidence: ${id}`,
              });
        } else visit(entry);
      }
    }
    visit(response);
  });
export type CatchmentResponse = z.infer<typeof CatchmentResponseSchema>;
