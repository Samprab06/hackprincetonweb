export const number = (value: number | null, unit = "cents") => ({
  value,
  unit,
  origin: "founder" as const,
  evidenceIds: ["founder-answer"],
  ...(value === null ? { unknownReason: "Founder does not know yet" } : {}),
});
export const flag = (value: boolean) => ({
  value,
  unit: "boolean" as const,
  origin: "founder" as const,
  evidenceIds: ["founder-answer"],
});

export const founderAnswers = [
  {
    businessName: "Morning Cup",
    concept: "Neighborhood coffee shop",
    category: "coffee",
    objective: "Find an affordable first location",
  },
  { city: "Houston", preferredAreas: ["Montrose"], avoidedAreas: [] },
  {
    economics: {
      monthlyRentCeilingCents: number(400_000),
      buildoutBudgetCents: number(8_000_000),
      startupBudgetCents: number(null),
      monthlyOperatingBudgetCents: number(null),
    },
  },
  {
    economics: {
      averageTicketCents: number(900),
      priceTier: {
        value: "mid",
        unit: "price_tier",
        origin: "founder",
        evidenceIds: ["founder-answer"],
      },
    },
  },
  { targetCustomers: ["Nearby residents", "Commuters"] },
  {
    operatingHours: { openMinute: 420, closeMinute: 1020 },
    capacity: { servers: number(2, "staff") },
  },
  {
    mustHaves: {
      frontage: flag(true),
      corner: flag(false),
      parking: flag(false),
      groundFloor: flag(true),
    },
  },
];
