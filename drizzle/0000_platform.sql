CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TYPE "public"."investigation_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "behavior_tables" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"persona_set_id" text NOT NULL,
	"site_id" text NOT NULL,
	"model_version" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "behavior_tables_project_id_id_unique" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "comparisons" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comparisons_project_id_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "comparisons_project_id_profile_unique" UNIQUE("project_id","id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"status" "investigation_status" DEFAULT 'queued' NOT NULL,
	"question" text NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jev_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"cache_key" text NOT NULL,
	"model_version" text NOT NULL,
	"response" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jev_cache_project_key_unique" UNIQUE("project_id","cache_key")
);
--> statement-breakpoint
CREATE TABLE "persona_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persona_sets_project_id_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "persona_sets_profile_version_unique" UNIQUE("project_id","profile_id","version"),
	CONSTRAINT "persona_sets_version_positive" CHECK ("persona_sets"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"comparison_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_project_id_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "profiles_project_version_unique" UNIQUE("project_id","version"),
	CONSTRAINT "profiles_version_positive" CHECK ("profiles"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"comparison_id" text,
	"site_id" text NOT NULL,
	"seed" integer NOT NULL,
	"model_version" text NOT NULL,
	"data" jsonb NOT NULL,
	"events" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_runs_seed_nonnegative" CHECK ("site_runs"."seed" >= 0)
);
--> statement-breakpoint
ALTER TABLE "behavior_tables" ADD CONSTRAINT "behavior_tables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavior_tables" ADD CONSTRAINT "behavior_tables_scoped_persona_set_fk" FOREIGN KEY ("project_id","persona_set_id") REFERENCES "public"."persona_sets"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_scoped_profile_fk" FOREIGN KEY ("project_id","profile_id") REFERENCES "public"."profiles"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_scoped_profile_fk" FOREIGN KEY ("project_id","profile_id") REFERENCES "public"."profiles"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jev_cache" ADD CONSTRAINT "jev_cache_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_sets" ADD CONSTRAINT "persona_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_sets" ADD CONSTRAINT "persona_sets_scoped_profile_fk" FOREIGN KEY ("project_id","profile_id") REFERENCES "public"."profiles"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_scoped_comparison_fk" FOREIGN KEY ("project_id","comparison_id","profile_id") REFERENCES "public"."comparisons"("project_id","id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_runs" ADD CONSTRAINT "site_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_runs" ADD CONSTRAINT "site_runs_scoped_profile_fk" FOREIGN KEY ("project_id","profile_id") REFERENCES "public"."profiles"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_runs" ADD CONSTRAINT "site_runs_scoped_comparison_fk" FOREIGN KEY ("project_id","comparison_id","profile_id") REFERENCES "public"."comparisons"("project_id","id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "behavior_tables_persona_set_idx" ON "behavior_tables" USING btree ("project_id","persona_set_id");--> statement-breakpoint
CREATE INDEX "behavior_tables_site_idx" ON "behavior_tables" USING btree ("project_id","site_id");--> statement-breakpoint
CREATE INDEX "comparisons_profile_idx" ON "comparisons" USING btree ("project_id","profile_id");--> statement-breakpoint
CREATE INDEX "evidence_project_idx" ON "evidence" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "investigations_profile_idx" ON "investigations" USING btree ("project_id","profile_id");--> statement-breakpoint
CREATE INDEX "investigations_queue_idx" ON "investigations" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "jev_cache_expiry_idx" ON "jev_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "persona_sets_profile_idx" ON "persona_sets" USING btree ("project_id","profile_id");--> statement-breakpoint
CREATE INDEX "plans_comparison_idx" ON "plans" USING btree ("project_id","comparison_id","profile_id");--> statement-breakpoint
CREATE INDEX "site_runs_profile_idx" ON "site_runs" USING btree ("project_id","profile_id");--> statement-breakpoint
CREATE INDEX "site_runs_comparison_idx" ON "site_runs" USING btree ("project_id","comparison_id","profile_id");--> statement-breakpoint
CREATE INDEX "site_runs_site_idx" ON "site_runs" USING btree ("project_id","site_id");
