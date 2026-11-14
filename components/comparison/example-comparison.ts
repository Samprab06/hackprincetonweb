import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { computeMonthlyEconomics } from "@/lib/sim/economics";
import { percentile, simulateDay } from "@/lib/sim/engine";
import { createRng } from "@/lib/sim/random";
import type { SiteConfigInput } from "@/lib/sim/contracts";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";

export const comparisonId = "houston-coffee-example-v1";
const fixture = syntheticHoustonFixture;
const hours = { openMin: 420, closeMin: 900 };

export function exampleComparison(sites: PreviewProject["sites"], visits = 1) {
  const rows = sites.map((site, index) => {
    const config: SiteConfigInput = {
      hours: { weekday: hours, weekend: hours },
      stations: { planned: 2, usableSf: site.squareFeet, sfPerStation: 250 },
      prices: { avgTicketUsd: 6.5 },
      staff: { headcount: 2, wageUsdPerHour: 16 },
      costs: { cogsPctOfRevenue: 0.27 },
      lease: {
        sf: site.squareFeet,
        askingRentUsdPerSfYear: index === 0 ? 31 : 24,
        tripleNet: false,
        buildoutUsd: 24000,
        leaseTermMonths: 36,
      },
      calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
    };
    const simulate = (seed: number, dayType: "weekday" | "weekend") => {
      const random = createRng(seed).next;
      const customerCount = Math.round(
        (index === 0 ? 125 : 114) * visits * (dayType === "weekday" ? 1 : 0.85),
      );
      return simulateDay(
        {
          siteId: site.id,
          seed,
          dayType,
          ...hours,
          demandSource: "huff",
          params: {},
          stayCurves: fixture.arrivalSchedule.stayProbabilityByPersona.map(
            ({ personaId, curve }) => ({
              personaId,
              points: Object.entries(curve).map(([length, point]) => ({
                lineLength: Number(length),
                p: point.value,
              })),
            }),
          ),
          customers: Array.from({ length: customerCount }, (_, customer) => ({
            id: `customer-${customer + 1}`,
            personaId:
              fixture.personaSet.personas[
                customer % fixture.personaSet.personas.length
              ].id,
            arrivalMin:
              hours.openMin +
              (hours.closeMin - hours.openMin) * random() ** 1.6,
            stayDraw: random(),
            serviceMin: 2 + 5 * random(),
          })),
        },
        config,
      );
    };
    const scenarios = Array.from({ length: 24 }, (_, index) => {
      const seed = index + 1;
      const run = simulate(seed, "weekday");
      const monthly = computeMonthlyEconomics(config, {
        weekday: run.metrics,
        weekend: simulate(seed + 24, "weekend").metrics,
      });
      return { run, contribution: monthly.contributionUsd };
    }).sort((a, b) => a.contribution - b.contribution);
    const contributions = scenarios.map(({ contribution }) => contribution);
    const mean =
      contributions.reduce((sum, contribution) => sum + contribution, 0) /
      contributions.length;
    const run = scenarios[Math.floor(scenarios.length / 2)].run;
    return {
      site,
      mean,
      low: percentile(contributions, 0.05) ?? mean,
      high: percentile(contributions, 0.95) ?? mean,
      run,
      runId: `${exampleComparisonId(visits)}-${site.id}-${run.seed}`,
    };
  });
  return rows.sort((a, b) => b.mean - a.mean);
}

export function exampleComparisonId(visits: number) {
  return `${comparisonId}-${visits}`;
}

export const examplePersonas = fixture.personaSet.personas.map(
  ({ id, label }) => ({
    id,
    label,
    monthlyVisits: fixture.behaviorTable.personas.find(
      (persona) => persona.personaId === id,
    )?.expectedMonthlyVisits.value,
    destinations:
      fixture.behaviorTable.personas
        .find((persona) => persona.personaId === id)
        ?.where.map(({ destinationId, share }) => ({
          label:
            destinationId === "none"
              ? "No visit"
              : destinationId === fixture.behaviorTable.siteId
                ? "Example site"
                : "Example competitor",
          share: share.value,
        })) ?? [],
  }),
);
