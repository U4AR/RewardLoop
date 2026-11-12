CREATE TABLE IF NOT EXISTS "shopping_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"kernel_profile_name" text NOT NULL,
	"destination_ciphertext" text,
	"destination_label" text,
	"destination_fingerprint" text,
	"payment_label" text,
	"setup_session_id" text,
	"setup_live_view_url" text,
	"setup_merchant" text,
	"setup_started_at" timestamp with time zone,
	"retailer_ready_merchants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_profile_name_unique" UNIQUE ("kernel_profile_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product_title" text NOT NULL,
	"variant_label" text NOT NULL,
	"merchant" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"destination_fingerprint" text NOT NULL,
	"destination_label" text NOT NULL,
	"payment_label" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"total_cap_minor" integer NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"mode" text DEFAULT 'dry_run' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "purchase_auth_quantity" CHECK ("purchase_authorizations"."quantity" = 1),
	CONSTRAINT "purchase_auth_currency" CHECK ("purchase_authorizations"."currency" = 'USD'),
	CONSTRAINT "purchase_auth_cap" CHECK ("purchase_authorizations"."total_cap_minor" > 0),
	CONSTRAINT "purchase_auth_mode" CHECK ("purchase_authorizations"."mode" IN ('dry_run','live')),
	CONSTRAINT "purchase_auth_status" CHECK ("purchase_authorizations"."status" IN ('active','revoked','consumed'))
);
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='purchase_authorizations_plan_fk') THEN ALTER TABLE "purchase_authorizations" ADD CONSTRAINT "purchase_authorizations_plan_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."reward_plans"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_auth_one_active" ON "purchase_authorizations" USING btree ("plan_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_auth_owner" ON "purchase_authorizations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authorization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"mode" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"kernel_session_id" text,
	"live_view_url" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observation" jsonb,
	"validation" jsonb,
	"receipt" jsonb,
	"payment_submitted_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_attempt_mode" CHECK ("purchase_attempts"."mode" IN ('dry_run','live')),
	CONSTRAINT "purchase_attempt_state" CHECK ("purchase_attempts"."state" IN ('queued','running','needs_handoff','dry_run_passed','blocked','unknown','purchased','cancelled','reconciled_no_order','reported_purchased'))
);
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='purchase_attempts_auth_fk') THEN ALTER TABLE "purchase_attempts" ADD CONSTRAINT "purchase_attempts_auth_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."purchase_authorizations"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_attempt_idempotency" ON "purchase_attempts" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_attempt_one_open" ON "purchase_attempts" USING btree ("authorization_id") WHERE "state" IN ('queued','running','needs_handoff','unknown');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_attempt_one_purchase" ON "purchase_attempts" USING btree ("authorization_id") WHERE "state" IN ('purchased','reported_purchased');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_attempt_owner" ON "purchase_attempts" USING btree ("user_id","created_at");
