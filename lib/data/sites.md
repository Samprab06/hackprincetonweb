# Site search (HAC-16)

`searchSites(request, inventory)` is a pure, deterministic `search_sites` function
over the normalized HAC-11 rows. It reads no files, database or external service.
`lib/contracts/sites.ts` defines its request, inventory and response boundaries;
the canonical `BusinessProfile` and `Candidate` schemas are unchanged.

## Request and API

`POST /api/sites` accepts a complete canonical `profile` and optional
`minSizeSqFt`, `maxSizeSqFt`, `limit` (1–8, default 8), and
`nnnExpenseUsdPerSfYear` (nonnegative, illustrative default 10). Minimum size
cannot exceed maximum size. Unknown request fields and invalid profiles return
422 with `{code, message, field_errors}`; requests are limited to 64 KiB.

The route reads whitelisted search fields from `costar_properties` and
`costar_spaces` in one read-only, repeatable-read transaction. It requires a
configured `DATABASE_URL` and the HAC-11 import. An empty inventory returns an
empty result; missing/unprepared databases and invalid stored data return a
sanitized 503. There is no fixture fallback, network call, runtime file access,
profile write or automatic database migration. Responses disable caching.

The result contains `candidates`, sequential `filters` with before/removed/after
counts, `mostRestrictiveFilter`, `emptyReason`, `totalMatched`, resolvable
`evidence`, and `modelVersion: "site-prescore-v1"`. Each shortlist entry contains a
canonical `candidate`, normalized property/listing IDs, `position`, `score`,
`scoreComponents`, source references and flags. Candidate IDs retain HAC-11's
`listingId:spaceId` format so the catchment API can resolve them directly.

## Selection and ranking

Filters run in this order: city, active availability, Retail/OfficeRetail space
use, size, monthly base-rent ceiling, then required ground floor, corner-or-endcap,
frontage and parking. OfficeRetail in mixed-use properties is eligible. Unknown
size/rent remains visible and flagged; an unknown mandatory feature cannot
establish a match. `mostRestrictiveFilter` names the stage removing the most rows,
with the first stage winning a tie. Counts describe sequential effects, not
independent counterfactual filter effects.

Known-rent matches sort before unknown rent, then by score descending and stable
site ID. The authored pre-score awards up to 40 for rent fit, 20 for size fit,
15 for Corner/EndCap position and 15 for building frontage. The remaining anchor
component earns zero: the imported schemas do not verify anchors. No anchor is
inferred from tenant names, brands or occupied area. These weights are transparent
heuristics, not calibrated demand or sales predictions.

Building frontage uses `propertyRetail.frontage[].frontageInFeet`; it does not
verify the leased unit's own frontage. Parking uses observed counts or ratios.
Ground-floor status requires explicit `Ground`; ambiguous floor labels remain
unknown. EndCap satisfies the ticket's corner-or-endcap filter but does not become
`Candidate.features.corner: true`. Source payloads, contacts and attachments are
never returned.

## Rent and expense assumptions

Monthly base rent in cents is `USD/SF/year × sizeSqFt × 100 / 12`, rounded to the
nearest cent. The higher known asking-rate endpoint is used; a sole endpoint is
flagged. Both rent and size must be known to calculate base rent. Unknown rent
never earns a cheap-rent bonus. The profile's rent ceiling filters **base rent**;
`Candidate.monthlyRentCents` retains that meaning.

`opexCents` and `totalMonthlyCostCents` are separate modeled lease-cost components,
not total business operating costs. TripleNet adds an explicitly flagged,
uncalibrated assumption of $10/SF/year unless the caller overrides it. Omission
has `origin: "default"`; an explicit override has `origin: "founder"`, including
an explicit value of 10. FullService has no additional modeled building opex;
other service arrangements remain unknown. Taxes, insurance and maintenance
estimates require verification; the API does not claim an observed NNN quote.

Pass the original validated request to `searchSites`, rather than the
default-filled parsed request, to preserve omitted-versus-overridden provenance.
The response includes evidence definitions for every returned assumption and
computed score. Synthetic tests use invented records only. Hosted PostGIS/data
and Vercel preview verification are separate from offline test/build results.
