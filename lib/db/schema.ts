export * from "./costar-schema";
import { sql } from "drizzle-orm";
export * from "./public-schema";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type {
  BehaviorTable,
  BusinessProfile,
  Evidence,
  LocationPlan,
  PersonaSet,
  SiteComparison,
  SiteRun,
} from "../contracts";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const investigationStatus = pgEnum("investigation_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const profiles = pgTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<BusinessProfile>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("profiles_project_id_id_unique").on(t.projectId, t.id),
    unique("profiles_project_version_unique").on(t.projectId, t.version),
    check("profiles_version_positive", sql`${t.version} > 0`),
  ],
);

export const personaSets = pgTable(
  "persona_sets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    version: integer("version").notNull(),
    data: jsonb("data").$type<PersonaSet>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("persona_sets_project_id_id_unique").on(t.projectId, t.id),
    unique("persona_sets_profile_version_unique").on(
      t.projectId,
      t.profileId,
      t.version,
    ),
    foreignKey({
      name: "persona_sets_scoped_profile_fk",
      columns: [t.projectId, t.profileId],
      foreignColumns: [profiles.projectId, profiles.id],
    }).onDelete("cascade"),
    index("persona_sets_profile_idx").on(t.projectId, t.profileId),
    check("persona_sets_version_positive", sql`${t.version} > 0`),
  ],
);

export const behaviorTables = pgTable(
  "behavior_tables",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    personaSetId: text("persona_set_id").notNull(),
    siteId: text("site_id").notNull(),
    modelVersion: text("model_version").notNull(),
    data: jsonb("data").$type<BehaviorTable>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("behavior_tables_project_id_id_unique").on(t.projectId, t.id),
    foreignKey({
      name: "behavior_tables_scoped_persona_set_fk",
      columns: [t.projectId, t.personaSetId],
      foreignColumns: [personaSets.projectId, personaSets.id],
    }).onDelete("cascade"),
    index("behavior_tables_persona_set_idx").on(t.projectId, t.personaSetId),
    index("behavior_tables_site_idx").on(t.projectId, t.siteId),
  ],
);

export const jevCache = pgTable(
  "jev_cache",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    cacheKey: text("cache_key").notNull(),
    modelVersion: text("model_version").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("jev_cache_project_key_unique").on(t.projectId, t.cacheKey),
    index("jev_cache_expiry_idx").on(t.expiresAt),
  ],
);

export const comparisons = pgTable(
  "comparisons",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    data: jsonb("data").$type<SiteComparison>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("comparisons_project_id_id_unique").on(t.projectId, t.id),
    unique("comparisons_project_id_profile_unique").on(
      t.projectId,
      t.id,
      t.profileId,
    ),
    foreignKey({
      name: "comparisons_scoped_profile_fk",
      columns: [t.projectId, t.profileId],
      foreignColumns: [profiles.projectId, profiles.id],
    }).onDelete("cascade"),
    index("comparisons_profile_idx").on(t.projectId, t.profileId),
  ],
);

export const siteRuns = pgTable(
  "site_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    comparisonId: text("comparison_id"),
    siteId: text("site_id").notNull(),
    seed: integer("seed").notNull(),
    modelVersion: text("model_version").notNull(),
    data: jsonb("data").$type<Omit<SiteRun, "events">>().notNull(),
    events: jsonb("events").$type<SiteRun["events"]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "site_runs_scoped_profile_fk",
      columns: [t.projectId, t.profileId],
      foreignColumns: [profiles.projectId, profiles.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "site_runs_scoped_comparison_fk",
      columns: [t.projectId, t.comparisonId, t.profileId],
      foreignColumns: [
        comparisons.projectId,
        comparisons.id,
        comparisons.profileId,
      ],
    }).onDelete("cascade"),
    index("site_runs_profile_idx").on(t.projectId, t.profileId),
    index("site_runs_comparison_idx").on(
      t.projectId,
      t.comparisonId,
      t.profileId,
    ),
    index("site_runs_site_idx").on(t.projectId, t.siteId),
    check("site_runs_seed_nonnegative", sql`${t.seed} >= 0`),
  ],
);

export const investigations = pgTable(
  "investigations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    status: investigationStatus("status").notNull().default("queued"),
    question: text("question").notNull(),
    checkpoint: jsonb("checkpoint")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "investigations_scoped_profile_fk",
      columns: [t.projectId, t.profileId],
      foreignColumns: [profiles.projectId, profiles.id],
    }).onDelete("cascade"),
    index("investigations_profile_idx").on(t.projectId, t.profileId),
    index("investigations_queue_idx").on(t.projectId, t.status, t.createdAt),
  ],
);

export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    comparisonId: text("comparison_id").notNull(),
    data: jsonb("data").$type<LocationPlan>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "plans_scoped_comparison_fk",
      columns: [t.projectId, t.comparisonId, t.profileId],
      foreignColumns: [
        comparisons.projectId,
        comparisons.id,
        comparisons.profileId,
      ],
    }).onDelete("cascade"),
    index("plans_comparison_idx").on(t.projectId, t.comparisonId, t.profileId),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    data: jsonb("data").$type<Evidence>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("evidence_project_idx").on(t.projectId)],
);
