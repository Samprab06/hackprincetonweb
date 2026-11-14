/**
 * Interim Zod contracts for the queue engine (HAC-13).
 *
 * The ArrivalSchedule shapes mirror the shared interim contract (HAC-18 produces them) and
 * keep its field names exactly, so they can move into `lib/contracts/` when HAC-9 lands.
 * Times are minutes since local midnight, money is USD, probabilities are in [0, 1].
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const OriginSchema = z.enum(["costar", "public", "founder", "default"]);
export type Origin = z.infer<typeof OriginSchema>;

export const SourcedNumberSchema = z.object({ value: z.number(), origin: OriginSchema });
export type SourcedNumber = z.infer<typeof SourcedNumberSchema>;

export const DayTypeSchema = z.enum(["weekday", "weekend"]);
export type DayType = z.infer<typeof DayTypeSchema>;

export const ASKED_LINE_LENGTHS = [0, 2, 4, 6, 10] as const;

const minuteOfDay = z.number().finite().min(0).max(1440);
const probability = z.number().finite().min(0).max(1);
const nonNegative = z.number().finite().nonnegative();

export const StayPointSchema = z.object({
  lineLength: nonNegative,
  p: probability,
});
export type StayPoint = z.infer<typeof StayPointSchema>;

// ---------------------------------------------------------------------------
// Arrival schedule (HAC-18 produces, HAC-13 consumes)
// ---------------------------------------------------------------------------

export const CustomerSchema = z.object({
  id: z.string().min(1),
  personaId: z.string().min(1),
  arrivalMin: minuteOfDay,
  stayDraw: z.number().finite().min(0).lt(1),
  serviceMin: nonNegative,
});
export type Customer = z.infer<typeof CustomerSchema>;

export const StayCurveSchema = z.object({
  personaId: z.string().min(1),
  points: z
    .array(StayPointSchema)
    .min(1)
    .superRefine((points, ctx) => {
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const cur = points[i];
        if (prev && cur && cur.lineLength <= prev.lineLength) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, "lineLength"],
            message: "stay points must be strictly ascending by lineLength",
          });
        }
      }
    }),
});
export type StayCurve = z.infer<typeof StayCurveSchema>;

export const ArrivalScheduleSchema = z
  .object({
    siteId: z.string().min(1),
    seed: z.number().int(),
    dayType: DayTypeSchema,
    openMin: minuteOfDay,
    closeMin: minuteOfDay,
    demandSource: z.enum(["jev", "huff"]),
    stayCurves: z.array(StayCurveSchema),
    customers: z.array(CustomerSchema),
    params: z.record(z.string(), SourcedNumberSchema),
  })
  .superRefine((s, ctx) => {
    if (s.closeMin <= s.openMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["closeMin"],
        message: "closeMin must be after openMin",
      });
    }
    const curves = new Set<string>();
    s.stayCurves.forEach((c, i) => {
      if (curves.has(c.personaId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stayCurves", i, "personaId"],
          message: `duplicate stay curve for persona ${c.personaId}`,
        });
      }
      curves.add(c.personaId);
    });
    const ids = new Set<string>();
    s.customers.forEach((c, i) => {
      if (ids.has(c.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customers", i, "id"],
          message: `duplicate customer id ${c.id}`,
        });
      }
      ids.add(c.id);
      if (!curves.has(c.personaId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customers", i, "personaId"],
          message: `no stay curve for persona ${c.personaId}`,
        });
      }
    });
  });
export type ArrivalSchedule = z.infer<typeof ArrivalScheduleSchema>;

// ---------------------------------------------------------------------------
// Site configuration (stations, staff, hours, prices, costs)
// ---------------------------------------------------------------------------

export const HoursSchema = z
  .object({ openMin: minuteOfDay, closeMin: minuteOfDay })
  .refine((h) => h.closeMin > h.openMin, {
    path: ["closeMin"],
    message: "closeMin must be after openMin",
  });
export type Hours = z.infer<typeof HoursSchema>;

export const SiteConfigSchema = z
  .object({
    /** Opening hours per day type. Both are required. */
    hours: z.object({ weekday: HoursSchema, weekend: HoursSchema }),
    stations: z.object({
      /** Founder's planned station count (chairs, registers, espresso machines...). */
      planned: z.number().int().positive(),
      usableSf: z.number().finite().positive(),
      sfPerStation: z.number().finite().positive(),
    }),
    service: z
      .object({
        /**
         * Mean service minutes used to turn a line length into a wait time for abandonment.
         * Defaults to the mean serviceMin of the schedule's customers.
         */
        meanServiceMin: z.number().finite().positive().optional(),
      })
      .default({}),
    prices: z.object({ avgTicketUsd: nonNegative }),
    staff: z.object({
      /** People on the clock for every open hour. */
      headcount: z.number().int().nonnegative(),
      wageUsdPerHour: nonNegative,
    }),
    costs: z.object({ cogsPctOfRevenue: probability }),
    lease: z.object({
      sf: z.number().finite().positive(),
      askingRentUsdPerSfYear: nonNegative,
      tripleNet: z.boolean(),
      /** Operating expenses (NNN charges), only added when tripleNet. */
      opexUsdPerSfYear: nonNegative.default(0),
      buildoutUsd: nonNegative,
      leaseTermMonths: z.number().int().positive(),
    }),
    calendar: z.object({
      weekdayDaysPerMonth: nonNegative,
      weekendDaysPerMonth: nonNegative,
    }),
  })
  .superRefine((c, ctx) => {
    if (Math.floor(c.stations.usableSf / c.stations.sfPerStation) < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stations", "usableSf"],
        message: "usable SF does not fit a single station",
      });
    }
  });
export type SiteConfig = z.infer<typeof SiteConfigSchema>;
export type SiteConfigInput = z.input<typeof SiteConfigSchema>;

// ---------------------------------------------------------------------------
// Engine outputs
// ---------------------------------------------------------------------------

export type SimEvent =
  | {
      type: "arrival";
      timeMin: number;
      customerId: string;
      personaId: string;
      lineLength: number;
      stayProbability: number;
      decision: "join" | "leave";
    }
  | { type: "queue_entry"; timeMin: number; customerId: string; patienceMin: number }
  | {
      type: "service_start";
      timeMin: number;
      customerId: string;
      stationIndex: number;
      waitMin: number;
    }
  | {
      type: "completion";
      timeMin: number;
      customerId: string;
      stationIndex: number;
      revenueUsd: number;
    }
  | { type: "abandonment"; timeMin: number; customerId: string; waitMin: number };

export type SimEventType = SimEvent["type"];

export type DailyMetrics = {
  dayType: DayType;
  openMin: number;
  closeMin: number;
  stations: number;
  /** Customers arriving inside opening hours. */
  arrivals: number;
  /** Customers in the schedule arriving before open or at/after close; not simulated. */
  arrivalsOutsideHours: number;
  joined: number;
  served: number;
  /** Looked at the line and left (stayDraw >= stay probability). */
  balked: number;
  /** Joined, then left when their wait passed their patience. */
  reneged: number;
  /** balked + reneged. */
  abandoned: number;
  /** In service when the doors closed; not counted as served, no revenue. */
  inServiceAtClose: number;
  /** Still in line when the doors closed; not counted as served or abandoned. */
  waitingAtClose: number;
  /** Mean wait of served customers, null when nobody was served. */
  meanWaitMin: number | null;
  /** Nearest-rank p90 wait of served customers, null when nobody was served. */
  p90WaitMin: number | null;
  /** Busy station-minutes / (stations x open minutes), in [0, 1]. */
  stationUtilization: number;
  /** Revenue from completed services only. */
  revenueUsd: number;
};

export type DayResult = {
  siteId: string;
  seed: number;
  events: SimEvent[];
  metrics: DailyMetrics;
};

export type MonthlyEconomics = {
  revenueUsd: number;
  servedCustomers: number;
  costs: {
    cogsUsd: number;
    laborUsd: number;
    staffHours: number;
    baseRentUsd: number;
    opexUsd: number;
    buildoutAmortizationUsd: number;
    totalUsd: number;
  };
  /** Revenue minus every cost above, including buildout amortization. */
  contributionUsd: number;
  /** Revenue minus operating costs (excludes buildout amortization). */
  operatingContributionUsd: number;
  /** buildoutUsd / operatingContributionUsd; 0 with no buildout, null if it never pays back. */
  buildoutPaybackMonths: number | null;
};
