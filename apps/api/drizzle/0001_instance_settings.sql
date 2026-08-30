CREATE TABLE "instance_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"org_mode" text DEFAULT 'multi' NOT NULL,
	"default_org_id" uuid,
	"instance_name" text DEFAULT 'FlowBoard' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_singleton" CHECK ("instance_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_default_org_id_organizations_id_fk" FOREIGN KEY ("default_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- HAND-EDITED (see .agents/docs/database.md § Adding a migration, step 3: a data
-- backfill is one of the three things drizzle-kit cannot express).
--
-- The singleton is CREATED HERE, not left to the first request, so that a
-- deployment which runs `db:migrate` and nothing else already has a coherent
-- configuration row: `SELECT * FROM instance_settings` answers instead of
-- returning zero rows, and an operator reading the database sees the shipped
-- defaults rather than an empty table they have to guess the meaning of.
--
-- `ON CONFLICT DO NOTHING` is what keeps it idempotent, which is the property
-- `db:migrate` is documented to have ("safe to re-run"). It is belt-and-braces
-- against a hand-rolled re-application: Drizzle's journal already stops the file
-- running twice, but a backfill that would DUPLICATE or OVERWRITE an operator's
-- configuration if it ever did is not worth the ceremony saved.
--
-- The row is ALSO ensured lazily by `services/instance-settings.service.ts`,
-- and that is not redundancy for its own sake: the integration-test database is
-- reset with `TRUNCATE` (`src/test/test-db.ts`), which empties this table
-- without re-running migrations. Exactly one of the two paths has to work at
-- any moment; both are idempotent, so both may.
INSERT INTO "instance_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
