-- Rewards for someone else, photo/voice check-ins, and the habit journal (journal text lives in the review JSON).
ALTER TABLE reward_plans ADD COLUMN IF NOT EXISTS recipient_name text;
--> statement-breakpoint
ALTER TABLE reward_checkins ADD COLUMN IF NOT EXISTS evidence_kind text NOT NULL DEFAULT 'text';
--> statement-breakpoint
ALTER TABLE reward_checkins ADD COLUMN IF NOT EXISTS media_mime text;
--> statement-breakpoint
ALTER TABLE reward_checkins ADD COLUMN IF NOT EXISTS media_data bytea;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE reward_checkins ADD CONSTRAINT reward_checkins_evidence_kind_check CHECK (evidence_kind IN ('text', 'photo', 'voice'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE reward_plans ADD CONSTRAINT reward_plans_recipient_name_check CHECK (recipient_name IS NULL OR char_length(recipient_name) BETWEEN 1 AND 60);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
