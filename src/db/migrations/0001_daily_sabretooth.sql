CREATE TABLE "mock_store_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"variant" text NOT NULL,
	"seller" text NOT NULL,
	"quantity" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"provider_capture_id" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"merchant_id" text NOT NULL,
	"paypal_customer_id" text NOT NULL,
	"encrypted_vault_id" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_setup_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"setup_token_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mock_store_orders" ADD CONSTRAINT "mock_store_orders_intent_id_purchase_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."purchase_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_store_orders" ADD CONSTRAINT "mock_store_orders_quote_id_mock_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."mock_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mock_order_intent_uq" ON "mock_store_orders" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_connection_user_uq" ON "payment_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallet_setup_user_idx" ON "wallet_setup_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_setup_token_uq" ON "wallet_setup_sessions" USING btree ("setup_token_id");