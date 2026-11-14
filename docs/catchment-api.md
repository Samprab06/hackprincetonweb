# Catchment builder (HAC-17)

```http
GET /api/sites/123/catchment?projectId=my-project&category=coffee&radiusMeters=1000
```

`siteId` is a CoStar property ID or the imported `listingId:spaceId`. The project
must exist. Unknown projects/sites return 404; malformed IDs/queries return 400.
An unprepared database, missing coordinates or missing local public-data coverage
returns sanitized 503, never a fabricated fixture or a zero-population fallback.
Responses are private and uncached. No request reads local files or calls Census,
LODES, Overture or CoStar over the network.

`projectId` and `category` are required. Categories are `coffee`, `quick_food`,
`salon_barber`, `fitness`. Radius defaults to **1,000 metres**, tagged `default`;
an explicitly supplied radius is `founder` input and must be 100–20,000 metres.
This is a circular geographic range, **not a walking/driving isochrone**. Optional
`roadType` is `local`, `collector`, `arterial` or `unknown`; caller classification
is tagged `founder`, not an observed road attribute.

## Response contract

`lib/contracts/catchment.ts` exports `CatchmentQuerySchema` and
`CatchmentResponseSchema`. The response wraps the unchanged canonical contract:

- `catchment`: canonical `Catchment`, including radius, resident estimate,
  workplace jobs and stable competitor IDs/distances.
- `residents`: original ACS block-group population, households, median income and
  age bands, intersection fractions, allocated values and aggregate estimates.
- `workers`: LODES block job observations and aggregate jobs.
- `passBy`: `vehiclesPerDay`, a sourced `missingTrafficCount` flag, road type and
  the selection/fallback explanation.
- `competitors`: deduplicated identities with retained source IDs and evidence.
- `coTenants`: current tenants in the site's property, with occupied area and
  explicit heuristic role (`anchor`, `complement`, `other`).
- `evidence`, `limitations`: resolvable source references and model boundaries.

All numeric values use the established `value/unit/origin/evidenceIds` envelope.
Absent/suppressed values stay null with a reason; partial known values are not
presented as a complete total. Real zeros remain zero. Evidence retains public
URLs, vintages, retrieval times, upstream Overture notices and CoStar record/field
references. Broker/contact payloads are never returned.

## Method and limitations

All five parts are read in one repeatable-read, read-only transaction.
`ST_DWithin` uses geography/metres. ACS polygons intersect a geographic-radius
buffer; allocating population, households and age counts by area assumes uniform
distribution. Allocated outputs are explicitly `default`-origin approximations
with both source and allocation evidence. Original block-group medians are
returned without inventing a catchment median. CoStar apartment observations are
not used as resident or worker totals.

LODES counts jobs at public internal points, not unique people or measured
daytime visitors. An empty selection remains unknown rather than proving zero.
Road traffic counts are vehicles/day, **not pedestrians, people, arrivals or
customers**. Choose a primary frontage count (then maximum), never sum repeated
road observations. Missing frontage counts use an authored, uncalibrated default:
local 3,000; collector 10,000; arterial 25,000; unknown 10,000 vehicles/day.

CoStar industry groups are broad potential-competitor proxies; their evidence
warns they do not verify a direct coffee, salon or fitness competitor. Overture
uses the imported service category. Competitors merge only when normalized names
match and locations are within 75 metres; far-apart branches remain distinct.
Both source references survive merging. CoStar property points are approximate
tenant locations. Co-tenant complement labels and the 20,000-SF anchor threshold
are transparent default heuristics, not verified commercial performance.

The existing persona builder also expects median age, household-with-kids and
commute shares not present in HAC-12. This API does **not** silently invent them,
nor convert road vehicles into pass-by people. A caller must supply a separately
evidenced adapter/default policy before feeding the interim panel input schema.

## Database setup and verification

The source loaders now create matching geography expression indexes, recorded in
the Drizzle source schemas. For an existing prepared database, apply only the new
indexes once, after confirming the target is approved:

```sh
pnpm exec tsx scripts/create-catchment-indexes.ts
```

This executes `scripts/catchment-indexes.sql`; API requests never run DDL.
The orchestrator entry point is `getCatchment(siteId, query, radiusOrigin)` in
`lib/data/catchment-repository.ts`; pure aggregation is `buildCatchment` in
`lib/data/catchments.ts`.

Synthetic Houston and Los Angeles HTTP/repository tests cover all five parts,
deduplication, missing-traffic defaults, query validation, SQL geography/radius
parameterization, unknown propagation, privacy and evidence references. They are
not claims of a live sponsor-data/PostGIS result. Hosted data, PostGIS execution
plans and Vercel verification are owned by HAC-44 per the lead's decision.
