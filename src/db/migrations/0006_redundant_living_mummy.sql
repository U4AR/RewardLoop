ALTER TABLE "purchase_permissions" ADD COLUMN "review_provider" text;--> statement-breakpoint
ALTER TABLE "purchase_permissions" ADD COLUMN "review_model" text;--> statement-breakpoint
UPDATE "purchase_permissions" SET "review_provider" = 'fixture', "review_model" = 'deterministic-word-count-v1'
WHERE "execution_mode" = 'fixture';
