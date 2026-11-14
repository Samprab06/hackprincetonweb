import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  geometry,
  index,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

// Sponsor observations stay in Postgres. JSONB retains source attributes,
// normalized values and field-level source references. Routes must select only
// authorized product fields rather than exposing these source payloads wholesale.
export const costarProperties = pgTable(
  "costar_properties",
  {
    id: text("id").primaryKey(),
    city: text("city"),
    propertyType: text("property_type"),
    propertySubtype: text("property_subtype"),
    retail: boolean("retail").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    point: geometry("point", { type: "point", mode: "tuple", srid: 4326 }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    source: jsonb("source").notNull(),
  },
  (t) => [
    index("costar_properties_point_idx").using("gist", t.point),
    index("costar_properties_geog_idx").using(
      "gist",
      sql`(${t.point}::geography)`,
    ),
    index("costar_properties_city_idx").on(t.city),
  ],
);

export const costarSpaces = pgTable(
  "costar_spaces",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id").notNull(),
    // Group listings may name buildings outside the kit's property dataset.
    propertyId: text("property_id").notNull(),
    active: boolean("active").notNull(),
    retail: boolean("retail").notNull(),
    sizeSqFt: doublePrecision("size_sq_ft"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    source: jsonb("source").notNull(),
  },
  (t) => [index("costar_spaces_property_idx").on(t.propertyId)],
);

export const costarTenancies = pgTable(
  "costar_tenancies",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id")
      .notNull()
      .references(() => costarProperties.id),
    tenantLocationId: text("tenant_location_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    source: jsonb("source").notNull(),
  },
  (t) => [index("costar_tenancies_property_idx").on(t.propertyId)],
);

export const costarAttachments = pgTable(
  "costar_attachments",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    source: jsonb("source").notNull(),
  },
  (t) => [index("costar_attachments_property_idx").on(t.propertyId)],
);
