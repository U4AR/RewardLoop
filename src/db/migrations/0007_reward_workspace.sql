CREATE TABLE "reward_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"business_date" date NOT NULL,
	"notes" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_checkin_status" CHECK ("reward_checkins"."status" IN ('pending','accepted','rejected','needs_review','error'))
);
--> statement-breakpoint
CREATE TABLE "reward_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product" jsonb NOT NULL,
	"offer_url" text NOT NULL,
	"merchant" text NOT NULL,
	"goal_title" text NOT NULL,
	"rubric" text NOT NULL,
	"required_days" integer NOT NULL,
	"timezone" text NOT NULL,
	"start_date" date NOT NULL,
	"deadline" date NOT NULL,
	"budget_minor" integer NOT NULL,
	"review_model" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"retailer_check" jsonb,
	"check_started_at" timestamp with time zone,
	"checkout_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_plan_days" CHECK ("reward_plans"."required_days" BETWEEN 1 AND 60),
	CONSTRAINT "reward_plan_budget" CHECK ("reward_plans"."budget_minor" > 0),
	CONSTRAINT "reward_plan_status" CHECK ("reward_plans"."status" IN ('active','archived'))
);
--> statement-breakpoint
ALTER TABLE "reward_checkins" ADD CONSTRAINT "reward_checkins_plan_id_reward_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."reward_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reward_checkins_content" ON "reward_checkins" USING btree ("plan_id","content_hash");--> statement-breakpoint
CREATE INDEX "reward_checkins_owner_date" ON "reward_checkins" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "reward_plans_owner" ON "reward_plans" USING btree ("user_id","created_at");