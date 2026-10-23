CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"actor" text NOT NULL,
	"type" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"goal_version" integer NOT NULL,
	"rubric_version" integer NOT NULL,
	"local_date" date NOT NULL,
	"evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_products" (
	"sku" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"variant" text NOT NULL,
	"seller" text DEFAULT 'RewardLoop Demo Store' NOT NULL,
	"image_url" text,
	"source" text DEFAULT 'fixture' NOT NULL,
	"source_product_id" text,
	"source_offer_url" text,
	"observed_price_minor" integer,
	"price_minor" integer NOT NULL,
	"shipping_minor" integer DEFAULT 0 NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"inventory_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"goal_version" integer NOT NULL,
	"rubric_version" integer NOT NULL,
	"business_date" date NOT NULL,
	"notes" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"review_provider" text,
	"review_model" text,
	"review_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"cycle_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"rubric" text NOT NULL,
	"goal_version" integer DEFAULT 1 NOT NULL,
	"rubric_version" integer DEFAULT 1 NOT NULL,
	"timezone" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date_exclusive" date NOT NULL,
	"required_days" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"variant" text NOT NULL,
	"seller" text NOT NULL,
	"quantity" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"item_minor" integer NOT NULL,
	"shipping_minor" integer NOT NULL,
	"tax_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"inventory_version" integer NOT NULL,
	"destination_id" text NOT NULL,
	"status" text DEFAULT 'FRESH' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"provider" text NOT NULL,
	"request_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'PREPARED' NOT NULL,
	"order_id" text,
	"capture_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"goal_version" integer NOT NULL,
	"rubric_version" integer NOT NULL,
	"permission_version" integer DEFAULT 1 NOT NULL,
	"primary_sku" text NOT NULL,
	"alternative_skus" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seller" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"total_cap_minor" integer NOT NULL,
	"synthetic_destination_id" text DEFAULT 'demo-us-address' NOT NULL,
	"payment_connection_id" uuid,
	"earliest_date" date NOT NULL,
	"latest_date" date NOT NULL,
	"unattended_sandbox_approved" boolean DEFAULT false NOT NULL,
	"execution_mode" text DEFAULT 'fixture' NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "purchase_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"state" text DEFAULT 'ARMED' NOT NULL,
	"selected_sku" text,
	"quote_id" uuid,
	"order_id" text,
	"capture_id" text,
	"receipt_provider" text,
	"reason" text,
	"lease_owner" text,
	"lease_fence" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_qualifications" ADD CONSTRAINT "daily_qualifications_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_qualifications" ADD CONSTRAINT "daily_qualifications_evidence_id_evidence_submissions_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_submissions" ADD CONSTRAINT "evidence_submissions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_quotes" ADD CONSTRAINT "mock_quotes_intent_id_purchase_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."purchase_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_operations" ADD CONSTRAINT "payment_operations_intent_id_purchase_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."purchase_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_permissions" ADD CONSTRAINT "purchase_permissions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_permission_id_purchase_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."purchase_permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_day_uq" ON "daily_qualifications" USING btree ("goal_id","goal_version","rubric_version","local_date");--> statement-breakpoint
CREATE INDEX "evidence_goal_idx" ON "evidence_submissions" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_goal_hash_uq" ON "evidence_submissions" USING btree ("goal_id","content_hash");--> statement-breakpoint
CREATE INDEX "goals_user_idx" ON "goals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_dedupe_uq" ON "outbox_jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "outbox_ready_idx" ON "outbox_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_logical_op_uq" ON "payment_operations" USING btree ("intent_id","kind","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_request_id_uq" ON "payment_operations" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "permission_goal_idx" ON "purchase_permissions" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_goal_version_uq" ON "purchase_permissions" USING btree ("goal_id","permission_version");--> statement-breakpoint
CREATE UNIQUE INDEX "intent_cycle_uq" ON "purchase_intents" USING btree ("goal_id","cycle_id");