CREATE TABLE "mock_store_carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"sku" text,
	"destination_id" text DEFAULT 'demo-us-address' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_store_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"account_label" text NOT NULL,
	"setup_code_hash" text,
	"setup_code_expires_at" timestamp with time zone,
	"session_token_hash" text,
	"session_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mock_store_carts" ADD CONSTRAINT "mock_store_carts_session_id_mock_store_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."mock_store_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_store_carts" ADD CONSTRAINT "mock_store_carts_sku_demo_products_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."demo_products"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mock_store_cart_session_uq" ON "mock_store_carts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "mock_store_session_owner_idx" ON "mock_store_sessions" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mock_store_setup_code_uq" ON "mock_store_sessions" USING btree ("setup_code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mock_store_session_token_uq" ON "mock_store_sessions" USING btree ("session_token_hash");