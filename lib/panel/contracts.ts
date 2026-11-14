/**
 * Interim Zod contracts for the persona builder and Jev customer panel (HAC-15).
 *
 * Field names follow the shared interim contract (HAC-13 / HAC-15 / HAC-18). When HAC-9
 * lands `lib/contracts/`, move `Persona`, `PersonaSet`, `PersonaBehavior` and
 * `BehaviorTable` there unchanged. The catchment input shapes below are a stand-in until
 * the catchment builder (HAC-17) defines its own output.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const TIME_BLOCKS = ["early_morning", "morning", "midday", "afternoon", "evening"] as const;
export const TimeBlockSchema = z.enum(TIME_BLOCKS);
export type TimeBlock = z.infer<typeof TimeBlockSchema>;

/** Line lengths asked in `stay_at_queue_n`. */
export const ASKED_LINE_LENGTHS = [0, 2, 4, 6, 10] as const;

export const StayPointSchema = z.object({
  lineLength: z.number().int().nonnegative(),
  p: z.number().min(0).max(1),
});
export type StayPoint = z.infer<typeof StayPointSchema>;

const LatLngSchema = z.object({ lat: z.number(), lng: z.number() });

export const CommuteModeSchema = z.enum(["walk", "drive", "transit", "bike"]);
export type CommuteMode = z.infer<typeof CommuteModeSchema>;

export const BusinessTypeSchema = z.enum(["coffee", "quick_food", "salon_barber", "fitness_studio"]);
export type BusinessType = z.infer<typeof BusinessTypeSchema>;

// ---------------------------------------------------------------------------
// Personas (HAC-15 produces; HAC-18 consumes)
// ---------------------------------------------------------------------------

export const PersonaKindSchema = z.enum(["resident", "worker", "passby"]);
export type PersonaKind = z.infer<typeof PersonaKindSchema>;

export const PersonaSchema = z.object({
  id: z.string().min(1),
  segment: z.string().min(1),
  weight: z.number().positive(),
  kind: PersonaKindSchema,
  location: LatLngSchema,
  commuteMode: CommuteModeSchema,
  incomeUsd: z.number().nonnegative(),
  age: z.number().int().min(0),
  hasKids: z.boolean(),
  description: z.string(),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const PersonaSetSchema = z.object({
  catchmentId: z.string().min(1),
  personas: z.array(PersonaSchema),
});
export type PersonaSet = z.infer<typeof PersonaSetSchema>;

// ---------------------------------------------------------------------------
// Behavior table (HAC-15 produces; HAC-18 consumes when demandSource = "jev")
// ---------------------------------------------------------------------------

export const PersonaBehaviorSchema = z.object({
  personaId: z.string(),
  /** Option id (site id, competitor ids, "none") -> share; sums to 1. */
  where: z.record(z.string(), z.number().min(0).max(1)),
  /** Expected visits per month, from `how_often`. */
  visitsPerMonth: z.number().nonnegative(),
  /** Sums to 1. */
  timeBlocks: z.object({
    early_morning: z.number().min(0).max(1),
    morning: z.number().min(0).max(1),
    midday: z.number().min(0).max(1),
    afternoon: z.number().min(0).max(1),
    evening: z.number().min(0).max(1),
  }),
  /** One point per ASKED_LINE_LENGTHS, ascending. */
  stayByLineLength: z.array(StayPointSchema),
  priceAcceptance: z.array(z.object({ price: z.number().nonnegative(), p: z.number().min(0).max(1) })),
  confidence: z.object({
    where: z.number(),
    howOften: z.number(),
    when: z.number(),
    stay: z.number(),
    price: z.number(),
  }),
  /** Max absolute spread of `where` shares across the shuffled option orders. */
  orderSpread: z.number().min(0).max(1),
  cacheKeys: z.array(z.string()),
});
export type PersonaBehavior = z.infer<typeof PersonaBehaviorSchema>;

export const BehaviorTableSchema = z.object({
  siteId: z.string(),
  modelVersion: z.string(),
  personas: z.array(PersonaBehaviorSchema),
  failedPersonaIds: z.array(z.string()),
});
export type BehaviorTable = z.infer<typeof BehaviorTableSchema>;

// ---------------------------------------------------------------------------
// Catchment input (stand-in until HAC-17's catchment builder lands)
// ---------------------------------------------------------------------------

const ModeSharesSchema = z.object({
  walk: z.number().min(0),
  drive: z.number().min(0),
  transit: z.number().min(0),
  bike: z.number().min(0),
});
export type ModeShares = z.infer<typeof ModeSharesSchema>;

/** Census ACS block group around the candidate site. */
export const BlockGroupSchema = z.object({
  geoid: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  population: z.number().int().nonnegative(),
  households: z.number().int().nonnegative(),
  medianHouseholdIncomeUsd: z.number().positive(),
  medianAge: z.number().positive(),
  /** Share of households with children under 18. */
  shareHouseholdsWithKids: z.number().min(0).max(1),
  commuteShares: ModeSharesSchema,
});
export type BlockGroup = z.infer<typeof BlockGroupSchema>;

/** LODES workplace area characteristics (WAC) for one census block. */
export const WorkplaceBlockSchema = z.object({
  geoid: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  jobs: z.number().int().nonnegative(),
  /** LODES earnings bands: <= $1,250/mo, $1,251-3,333/mo, > $3,333/mo. */
  earnings: z.object({ low: z.number().min(0), mid: z.number().min(0), high: z.number().min(0) }),
  /** LODES age bands: <= 29, 30-54, 55+. */
  ages: z.object({ under30: z.number().min(0), age30to54: z.number().min(0), over55: z.number().min(0) }),
});
export type WorkplaceBlock = z.infer<typeof WorkplaceBlockSchema>;

/** A traffic or foot counter near the site. */
export const PassByCounterSchema = z.object({
  id: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  /** People passing per day (vehicles x occupancy, or pedestrians). */
  dailyCount: z.number().int().nonnegative(),
  /** Share of the count that is on foot; the rest drives. */
  walkShare: z.number().min(0).max(1),
});
export type PassByCounter = z.infer<typeof PassByCounterSchema>;

/** Ids shown to Jev as option keys: short machine ids only, so no free text can hide in them. */
export const OptionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,31}$/, "option ids are lowercase snake_case, at most 32 chars")
  .refine((id) => id !== "none", "'none' is reserved");

export const FrontageSchema = z.enum(["corner", "inline", "endcap", "pad", "in_line_mall"]);

/**
 * A candidate site. Only structured fields are read when building state. Any free text
 * that rides along (listing descriptions, broker notes) is stripped by this schema and
 * never reaches Jev.
 */
export const CandidateSiteSchema = z.object({
  id: OptionIdSchema,
  lat: z.number(),
  lng: z.number(),
  frontage: FrontageSchema,
  opensMin: z.number().int().min(0).max(24 * 60),
  hasParking: z.boolean(),
});
export type CandidateSite = z.infer<typeof CandidateSiteSchema>;

/** A competitor. Its brand name is not used in state text, only its class. */
export const CompetitorSchema = z.object({
  id: OptionIdSchema,
  lat: z.number(),
  lng: z.number(),
  brandClass: z.enum(["chain", "independent"]),
  businessType: BusinessTypeSchema,
  priceUsd: z.number().positive(),
});
export type Competitor = z.infer<typeof CompetitorSchema>;

/** What the founder sells, reduced to structured fields from intake. */
export const NeedSpecSchema = z.object({
  businessType: BusinessTypeSchema,
  /** Typical ticket at the candidate business. */
  priceUsd: z.number().positive(),
  /** Mean service minutes per customer, used to turn line length into an estimated wait. */
  serviceMinPerCustomer: z.number().positive(),
});
export type NeedSpec = z.infer<typeof NeedSpecSchema>;

export const CatchmentInputSchema = z.object({
  catchmentId: z.string().min(1),
  site: CandidateSiteSchema,
  blockGroups: z.array(BlockGroupSchema),
  workplaces: z.array(WorkplaceBlockSchema),
  passBy: z.array(PassByCounterSchema),
  competitors: z.array(CompetitorSchema),
});
export type CatchmentInput = z.infer<typeof CatchmentInputSchema>;
