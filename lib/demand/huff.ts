/**
 * Huff fallback: choice shares when no Jev behavior table is available.
 *
 *   P(choose j) = A_j^alpha * d_j^-beta / sum_k A_k^alpha * d_k^-beta
 *
 * over the candidate and every competitor within the persona's range. d is straight-line
 * distance times a per-city travel factor. Visit frequency comes from category defaults,
 * scaled by how well the persona's income fits the price tier.
 */
import type { Category, City, LatLng, Persona, PriceTier, Storefront } from "./contracts";
import {
  ATTRACTIVENESS,
  CATEGORY_DEFAULTS,
  CITY_DISTANCE_FACTOR,
  INCOME_FIT,
  MAX_RANGE_KM,
  MIN_DISTANCE_KM,
  PRICE_TIER_TARGET_INCOME,
} from "./defaults";

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle (haversine) distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Travel distance in km: straight line times the city factor, clamped below at MIN_DISTANCE_KM. */
export function travelKm(a: LatLng, b: LatLng, city: City): number {
  return Math.max(MIN_DISTANCE_KM, haversineKm(a, b) * CITY_DISTANCE_FACTOR[city]);
}

/** Attractiveness A from size, position, frontage and anchor co-tenants. */
export function attractiveness(store: Storefront): number {
  const c = ATTRACTIVENESS;
  return (
    (store.sizeSqft / c.sizeRefSqft) ** c.sizeExponent *
    c.position[store.position] *
    (store.frontageFt / c.frontageRefFt) ** c.frontageExponent *
    (1 + c.anchorBonus * store.anchorCoTenants)
  );
}

/** Income fit with the price tier, in [INCOME_FIT.floor, 1]. */
export function incomeFit(incomeUsd: number, tier: PriceTier): number {
  const target = PRICE_TIER_TARGET_INCOME[tier];
  const x = Math.log(Math.max(1, incomeUsd) / target);
  return INCOME_FIT.floor + (1 - INCOME_FIT.floor) * Math.exp(-(x * x) / (2 * INCOME_FIT.width ** 2));
}

/** Category visits per person per month (all stores), scaled by income fit. */
export function huffVisitsPerMonth(persona: Persona, category: Category, tier: PriceTier): number {
  return CATEGORY_DEFAULTS[category].visitsPerMonth[persona.kind] * incomeFit(persona.incomeUsd, tier);
}

export interface HuffShareOptions {
  alpha: number;
  beta: number;
  city: City;
}

/**
 * Share of the persona's category visits that go to `site`. Zero when the site is out of the
 * persona's range. Competitors out of range are ignored.
 */
export function huffShare(
  persona: Persona,
  site: Storefront,
  competitors: readonly Storefront[],
  opts: HuffShareOptions,
): number {
  const range = MAX_RANGE_KM[persona.commuteMode];
  const utility = (s: Storefront): number => {
    const d = travelKm(persona.location, s.location, opts.city);
    if (d > range) return 0;
    return attractiveness(s) ** opts.alpha * d ** -opts.beta;
  };
  const own = utility(site);
  if (own === 0) return 0;
  let total = own;
  for (const c of competitors) {
    if (c.id !== site.id) total += utility(c);
  }
  return own / total;
}
