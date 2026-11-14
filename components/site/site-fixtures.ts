const sites = {
  montrose: {
    longitude: -95.3914, latitude: 29.7458, suite: "A", rent: 32,
    position: "Corner storefront", residents: 12400, workers: 8600,
  },
  heights: {
    longitude: -95.3988, latitude: 29.7998, suite: "B", rent: 38,
    position: "Inline storefront", residents: 10900, workers: 6700,
  },
};

export function getSiteFixture(siteId: string) {
  return Object.hasOwn(sites, siteId) ? sites[siteId as keyof typeof sites] : undefined;
}

export const catchmentRadiusMiles = 1;
export const evidenceDate = "2026-11-13";
export const competitors = [
  { longitude: -95.3872, latitude: 29.7501, name: "Example café near Montrose" },
  { longitude: -95.4054, latitude: 29.8023, name: "Example café near The Heights" },
];
