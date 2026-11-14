import { z } from "zod";
import {
  AssumedValueSchema,
  BusinessProfileSchema,
  CandidateSchema,
  OriginSchema,
} from "./index";

export const CoStarSourceSchema = z
  .object({
    origin: z.literal("costar"),
    dataset: z.string().min(1),
    recordId: z.string().min(1),
    field: z.string().min(1),
  })
  .strict();
const data = z.record(z.string(), z.unknown());
const id = z.string().min(1);
const property = z.object({
  id,
  city: z.string().nullable(),
  latitude: z.number().finite().min(-90).max(90).nullable(),
  longitude: z.number().finite().min(-180).max(180).nullable(),
  data,
  source: CoStarSourceSchema,
});
const space = z.object({
  id,
  listingId: id,
  propertyId: id,
  active: z.boolean(),
  retail: z.boolean(),
  sizeSqFt: z.number().finite().positive().nullable(),
  data,
  source: CoStarSourceSchema,
});
const tenancy = z.object({
  id,
  propertyId: id,
  data,
  source: CoStarSourceSchema,
});
/** Runtime boundary for HAC-11 normalized rows, including JSONB source values. */
export const SiteInventorySchema = z
  .object({
    properties: z.array(property),
    spaces: z.array(space),
    tenancies: z.array(tenancy),
    synthetic: z.boolean().default(false),
  })
  .strict()
  .superRefine((inventory, ctx) => {
    for (const key of ["properties", "spaces", "tenancies"] as const) {
      if (
        new Set(inventory[key].map((row) => row.id)).size !==
        inventory[key].length
      )
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Inventory IDs must be unique",
        });
    }
  });
export type SiteInventory = z.input<typeof SiteInventorySchema>;
export const SiteSearchRequestSchema = z
  .object({
    profile: BusinessProfileSchema,
    minSizeSqFt: z.number().finite().positive().optional(),
    maxSizeSqFt: z.number().finite().positive().optional(),
    limit: z.number().int().min(1).max(8).default(8),
    // Authored illustrative assumption, never an observed or calibrated CoStar value.
    nnnExpenseUsdPerSfYear: z.number().finite().nonnegative().default(10),
  })
  .strict()
  .refine(
    (v) =>
      v.minSizeSqFt === undefined ||
      v.maxSizeSqFt === undefined ||
      v.minSizeSqFt <= v.maxSizeSqFt,
    {
      path: ["maxSizeSqFt"],
      message: "Maximum size must be at least minimum size",
    },
  );
export type SiteSearchRequest = z.input<typeof SiteSearchRequestSchema>;
export const SiteSearchEvidenceSchema = z
  .object({
    id,
    origin: OriginSchema,
    description: z.string().min(1),
    sources: z.array(CoStarSourceSchema),
    limitations: z.array(z.string().min(1)),
  })
  .strict();
export const SiteSearchResultSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            candidate: CandidateSchema,
            propertyId: id,
            listingId: id,
            position: z.string().nullable(),
            score: z.number().finite().nonnegative().max(100),
            scoreComponents: z
              .object({
                rentFit: z.number().min(0).max(40),
                sizeFit: z.number().min(0).max(20),
                position: z.number().min(0).max(15),
                frontage: z.number().min(0).max(15),
                anchorCotenants: z.number().min(0).max(10),
              })
              .strict(),
            scoreEvidenceId: id,
            baseRentCents: AssumedValueSchema,
            opexCents: AssumedValueSchema,
            totalMonthlyCostCents: AssumedValueSchema,
            flags: z.array(id),
            evidenceIds: z.array(id).min(1),
            sources: z.array(CoStarSourceSchema),
          })
          .strict(),
      )
      .max(8),
    filters: z.array(
      z
        .object({
          name: id,
          before: z.number().int().nonnegative(),
          removed: z.number().int().nonnegative(),
          after: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    mostRestrictiveFilter: id.nullable(),
    emptyReason: z.string().nullable(),
    totalMatched: z.number().int().nonnegative(),
    evidence: z.array(SiteSearchEvidenceSchema),
    modelVersion: z.literal("site-prescore-v1"),
  })
  .strict();
export type SiteSearchResult = z.infer<typeof SiteSearchResultSchema>;
