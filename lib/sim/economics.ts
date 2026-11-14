/**
 * Monthly unit economics from simulated days (HAC-13). Pure TypeScript.
 */
import {
  SiteConfigSchema,
  type DailyMetrics,
  type DayType,
  type MonthlyEconomics,
  type SiteConfig,
} from "./contracts";
import { EngineInputError, type FieldErrors } from "./engine";

/** Per-day outcome for one day type, typically the mean over seeds of DailyMetrics. */
export type DayOutcome = Pick<DailyMetrics, "revenueUsd" | "served">;

/** Mean revenue and served count over several simulated days of the same day type. */
export function averageDayOutcome(days: readonly DayOutcome[]): DayOutcome {
  if (days.length === 0) return { revenueUsd: 0, served: 0 };
  let revenueUsd = 0;
  let served = 0;
  for (const d of days) {
    revenueUsd += d.revenueUsd;
    served += d.served;
  }
  return { revenueUsd: revenueUsd / days.length, served: served / days.length };
}

/**
 * Monthly economics:
 * - revenue = sum over day types of revenue per day x days per month
 * - COGS = cogsPctOfRevenue x revenue
 * - labor = headcount x open hours per day x days per month x wage
 * - base rent = asking $/SF/year x SF / 12; opex = opex $/SF/year x SF / 12 only when triple net
 * - buildout amortization = buildoutUsd / leaseTermMonths
 * - contribution = revenue - all of the above; payback = buildout / (contribution before
 *   buildout amortization), reported separately.
 */
export function computeMonthlyEconomics(
  config: unknown,
  perDayType: Record<DayType, DayOutcome>,
): MonthlyEconomics {
  const parsed = SiteConfigSchema.safeParse(config);
  if (!parsed.success) {
    const errors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      (errors[["config", ...issue.path].join(".")] ??= []).push(issue.message);
    }
    throw new EngineInputError(errors);
  }
  return computeParsedMonthlyEconomics(parsed.data, perDayType);
}

export function computeParsedMonthlyEconomics(
  c: SiteConfig,
  perDayType: Record<DayType, DayOutcome>,
): MonthlyEconomics {
  const days: Record<DayType, number> = {
    weekday: c.calendar.weekdayDaysPerMonth,
    weekend: c.calendar.weekendDaysPerMonth,
  };
  let revenueUsd = 0;
  let servedCustomers = 0;
  let staffHours = 0;
  for (const dayType of ["weekday", "weekend"] as const) {
    const n = days[dayType];
    const outcome = perDayType[dayType];
    const hours = c.hours[dayType];
    revenueUsd += outcome.revenueUsd * n;
    servedCustomers += outcome.served * n;
    staffHours += (c.staff.headcount * (hours.closeMin - hours.openMin) * n) / 60;
  }

  const cogsUsd = c.costs.cogsPctOfRevenue * revenueUsd;
  const laborUsd = staffHours * c.staff.wageUsdPerHour;
  const baseRentUsd = (c.lease.askingRentUsdPerSfYear * c.lease.sf) / 12;
  const opexUsd = c.lease.tripleNet ? (c.lease.opexUsdPerSfYear * c.lease.sf) / 12 : 0;
  const buildoutAmortizationUsd = c.lease.buildoutUsd / c.lease.leaseTermMonths;
  const operatingCosts = cogsUsd + laborUsd + baseRentUsd + opexUsd;
  const totalUsd = operatingCosts + buildoutAmortizationUsd;
  const operatingContributionUsd = revenueUsd - operatingCosts;

  let buildoutPaybackMonths: number | null;
  if (c.lease.buildoutUsd === 0) buildoutPaybackMonths = 0;
  else if (operatingContributionUsd > 0)
    buildoutPaybackMonths = c.lease.buildoutUsd / operatingContributionUsd;
  else buildoutPaybackMonths = null;

  return {
    revenueUsd,
    servedCustomers,
    costs: {
      cogsUsd,
      laborUsd,
      staffHours,
      baseRentUsd,
      opexUsd,
      buildoutAmortizationUsd,
      totalUsd,
    },
    contributionUsd: revenueUsd - totalUsd,
    operatingContributionUsd,
    buildoutPaybackMonths,
  };
}
