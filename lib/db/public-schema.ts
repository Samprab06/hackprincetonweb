import { sql } from "drizzle-orm";
import {
  customType,
  doublePrecision,
  geometry,
  index,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

const polygon = customType<{ data: string }>({
  dataType: () => "geometry(MultiPolygon,4326)",
});

export const publicBlockGroups = pgTable(
  "public_block_groups",
  {
    geoid: text("geoid").primaryKey(),
    countyFips: text("county_fips").notNull(),
    population: doublePrecision("population"),
    households: doublePrecision("households"),
    medianHouseholdIncome: doublePrecision("median_household_income"),
    geom: polygon("geom").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    source: jsonb("source").notNull(),
  },
  (t) => [
    index("public_block_groups_geom_idx").using("gist", t.geom),
    index("public_block_groups_geog_idx").using(
      "gist",
      sql`(${t.geom}::geography)`,
    ),
    index("public_block_groups_county_idx").on(t.countyFips),
  ],
);

export const publicJobs = pgTable(
  "public_jobs",
  {
    geoid: text("geoid").primaryKey(),
    countyFips: text("county_fips").notNull(),
    jobs: doublePrecision("jobs"),
    point: geometry("point", {
      type: "point",
      mode: "tuple",
      srid: 4326,
    }).notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    source: jsonb("source").notNull(),
  },
  (t) => [
    index("public_jobs_point_idx").using("gist", t.point),
    index("public_jobs_geog_idx").using("gist", sql`(${t.point}::geography)`),
    index("public_jobs_county_idx").on(t.countyFips),
  ],
);

export const publicPlaces = pgTable(
  "public_places",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    category: text("category"),
    countyFips: text("county_fips").notNull(),
    point: geometry("point", {
      type: "point",
      mode: "tuple",
      srid: 4326,
    }).notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    source: jsonb("source").notNull(),
  },
  (t) => [
    index("public_places_point_idx").using("gist", t.point),
    index("public_places_geog_idx").using("gist", sql`(${t.point}::geography)`),
    index("public_places_category_idx").on(t.category),
  ],
);
