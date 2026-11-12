ALTER TABLE purchase_authorizations ADD COLUMN IF NOT EXISTS payment_connection_id uuid;
--> statement-breakpoint
ALTER TABLE purchase_attempts DROP CONSTRAINT IF EXISTS purchase_attempt_state;
--> statement-breakpoint
ALTER TABLE purchase_attempts ADD CONSTRAINT purchase_attempt_state CHECK (state IN ('queued','running','needs_handoff','dry_run_passed','blocked','unknown','purchased','cancelled','reconciled_no_order','reported_purchased','sandbox_paid'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS shopping_paypal_payments (
 attempt_id uuid PRIMARY KEY REFERENCES purchase_attempts(id),
 authorization_id uuid NOT NULL UNIQUE REFERENCES purchase_authorizations(id),
 total_minor integer NOT NULL CHECK (total_minor > 0),
 currency text NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
 status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown','paid')),
 order_id text UNIQUE,
 capture_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
