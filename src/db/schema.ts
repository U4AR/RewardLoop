import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const rewardPlans = pgTable("reward_plans", {
  id: uuid("id").primaryKey().defaultRandom(), userId: text("user_id").notNull(),
  productId: text("product_id").notNull(), product: jsonb("product").notNull(),
  offerUrl: text("offer_url").notNull(), merchant: text("merchant").notNull(),
  goalTitle: text("goal_title").notNull(), rubric: text("rubric").notNull(),
  requiredDays: integer("required_days").notNull(), timezone: text("timezone").notNull(),
  startDate: date("start_date").notNull(), deadline: date("deadline").notNull(),
  budgetMinor: integer("budget_minor").notNull(), reviewModel: text("review_model").notNull(),
  status: text("status").notNull().default("active"), retailerCheck: jsonb("retailer_check"),
  checkStartedAt: timestamp("check_started_at", { withTimezone: true }),
  checkoutOpenedAt: timestamp("checkout_opened_at", { withTimezone: true }), createdAt: createdAt(),
}, t => [index("reward_plans_owner").on(t.userId, t.createdAt),
  check("reward_plan_days", sql`${t.requiredDays} BETWEEN 1 AND 60`),
  check("reward_plan_budget", sql`${t.budgetMinor} > 0`),
  check("reward_plan_status", sql`${t.status} IN ('active','archived')`)]);

export const rewardCheckins = pgTable("reward_checkins", {
  id: uuid("id").primaryKey().defaultRandom(), planId: uuid("plan_id").notNull().references(() => rewardPlans.id),
  userId: text("user_id").notNull(), businessDate: date("business_date").notNull(), notes: text("notes").notNull(),
  contentHash: text("content_hash").notNull(), status: text("status").notNull().default("pending"),
  review: jsonb("review"), createdAt: createdAt(),
}, t => [uniqueIndex("reward_checkins_content").on(t.planId, t.contentHash),
  index("reward_checkins_owner_date").on(t.userId, t.createdAt),
  check("reward_checkin_status", sql`${t.status} IN ('pending','accepted','rejected','needs_review','error')`)]);

export const demoProducts = pgTable("demo_products", {
  sku: text("sku").primaryKey(),
  title: text("title").notNull(),
  variant: text("variant").notNull(),
  seller: text("seller").notNull().default("RewardLoop Demo Store"),
  imageUrl: text("image_url"),
  source: text("source").notNull().default("fixture"),
  sourceProductId: text("source_product_id"),
  sourceOfferUrl: text("source_offer_url"),
  observedPriceMinor: integer("observed_price_minor"),
  priceMinor: integer("price_minor").notNull(),
  shippingMinor: integer("shipping_minor").notNull().default(0),
  taxMinor: integer("tax_minor").notNull().default(0),
  available: boolean("available").notNull().default(true),
  inventoryVersion: integer("inventory_version").notNull().default(1),
});

// A synthetic store identity is independent of Better Auth. Its one-time setup
// code and host-only cookie are hashed; the browser never receives app auth.
export const mockStoreSessions = pgTable("mock_store_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: text("owner_user_id").notNull(),
  accountLabel: text("account_label").notNull(),
  setupCodeHash: text("setup_code_hash"),
  setupCodeExpiresAt: timestamp("setup_code_expires_at", { withTimezone: true }),
  sessionTokenHash: text("session_token_hash"),
  sessionExpiresAt: timestamp("session_expires_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("mock_store_session_owner_idx").on(t.ownerUserId),
  uniqueIndex("mock_store_setup_code_uq").on(t.setupCodeHash),
  uniqueIndex("mock_store_session_token_uq").on(t.sessionTokenHash),
]);

export const mockStoreCarts = pgTable("mock_store_carts", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => mockStoreSessions.id),
  sku: text("sku").references(() => demoProducts.sku),
  destinationId: text("destination_id").notNull().default("demo-us-address"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("mock_store_cart_session_uq").on(t.sessionId)]);

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  cycleId: uuid("cycle_id").notNull().defaultRandom(),
  title: text("title").notNull(),
  rubric: text("rubric").notNull(),
  goalVersion: integer("goal_version").notNull().default(1),
  rubricVersion: integer("rubric_version").notNull().default(1),
  timezone: text("timezone").notNull(),
  startDate: date("start_date").notNull(),
  endDateExclusive: date("end_date_exclusive").notNull(),
  requiredDays: integer("required_days").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  ...{ createdAt: createdAt() },
}, (t) => [
  index("goals_user_idx").on(t.userId),
  uniqueIndex("goals_one_active_per_user_uq").on(t.userId).where(sql`${t.status} = 'ACTIVE'`),
]);

export const permissions = pgTable("purchase_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  goalId: uuid("goal_id").notNull().references(() => goals.id),
  goalVersion: integer("goal_version").notNull(),
  rubricVersion: integer("rubric_version").notNull(),
  permissionVersion: integer("permission_version").notNull().default(1),
  primarySku: text("primary_sku").notNull(),
  alternativeSkus: jsonb("alternative_skus").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  approvedVariants: jsonb("approved_variants").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  seller: text("seller").notNull(),
  quantity: integer("quantity").notNull().default(1),
  currency: text("currency").notNull().default("USD"),
  totalCapMinor: integer("total_cap_minor").notNull(),
  syntheticDestinationId: text("synthetic_destination_id").notNull().default("demo-us-address"),
  paymentConnectionId: uuid("payment_connection_id"),
  earliestDate: date("earliest_date").notNull(),
  latestDate: date("latest_date").notNull(),
  unattendedSandboxApproved: boolean("unattended_sandbox_approved").notNull().default(false),
  executionMode: text("execution_mode").notNull().default("fixture"),
  reviewProvider: text("review_provider"),
  reviewModel: text("review_model"),
  payloadHash: text("payload_hash").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [index("permission_goal_idx").on(t.goalId), uniqueIndex("permission_goal_version_uq").on(t.goalId, t.permissionVersion)]);

export const evidence = pgTable("evidence_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  goalId: uuid("goal_id").notNull().references(() => goals.id),
  goalVersion: integer("goal_version").notNull(),
  rubricVersion: integer("rubric_version").notNull(),
  businessDate: date("business_date").notNull(),
  notes: text("notes").notNull(),
  contentHash: text("content_hash").notNull(),
  status: text("status").notNull().default("PENDING"),
  reviewProvider: text("review_provider"),
  reviewModel: text("review_model"),
  reviewResult: jsonb("review_result").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (t) => [index("evidence_goal_idx").on(t.goalId), uniqueIndex("evidence_goal_hash_uq").on(t.goalId, t.contentHash)]);

export const dailyQualifications = pgTable("daily_qualifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id").notNull().references(() => goals.id),
  goalVersion: integer("goal_version").notNull(),
  rubricVersion: integer("rubric_version").notNull(),
  localDate: date("local_date").notNull(),
  evidenceId: uuid("evidence_id").notNull().references(() => evidence.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("qualification_day_uq").on(t.goalId, t.goalVersion, t.rubricVersion, t.localDate)]);

export const purchaseIntents = pgTable("purchase_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  goalId: uuid("goal_id").notNull().references(() => goals.id),
  cycleId: uuid("cycle_id").notNull(),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id),
  storeSessionId: uuid("store_session_id").references(() => mockStoreSessions.id),
  state: text("state").notNull().default("ARMED"),
  selectedSku: text("selected_sku"),
  quoteId: uuid("quote_id"),
  orderId: text("order_id"),
  captureId: text("capture_id"),
  receiptProvider: text("receipt_provider"),
  reason: text("reason"),
  leaseOwner: text("lease_owner"),
  leaseFence: integer("lease_fence").notNull().default(0),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("intent_cycle_uq").on(t.goalId, t.cycleId)]);

export const mockQuotes = pgTable("mock_quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  intentId: uuid("intent_id").notNull().references(() => purchaseIntents.id),
  sku: text("sku").notNull(),
  variant: text("variant").notNull(),
  seller: text("seller").notNull(),
  quantity: integer("quantity").notNull(),
  currency: text("currency").notNull().default("USD"),
  itemMinor: integer("item_minor").notNull(),
  shippingMinor: integer("shipping_minor").notNull(),
  taxMinor: integer("tax_minor").notNull(),
  totalMinor: integer("total_minor").notNull(),
  inventoryVersion: integer("inventory_version").notNull(),
  destinationId: text("destination_id").notNull(),
  status: text("status").notNull().default("FRESH"),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const paymentOperations = pgTable("payment_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  intentId: uuid("intent_id").notNull().references(() => purchaseIntents.id),
  kind: text("kind").notNull(),
  generation: integer("generation").notNull().default(1),
  provider: text("provider").notNull(),
  requestId: uuid("request_id").notNull().defaultRandom(),
  payloadHash: text("payload_hash").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  state: text("state").notNull().default("PREPARED"),
  orderId: text("order_id"),
  captureId: text("capture_id"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("payment_logical_op_uq").on(t.intentId, t.kind, t.generation), uniqueIndex("payment_request_id_uq").on(t.requestId)]);

export const paymentConnections = pgTable("payment_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  environment: text("environment").notNull().default("sandbox"),
  merchantId: text("merchant_id").notNull(),
  paypalCustomerId: text("paypal_customer_id").notNull(),
  encryptedVaultId: text("encrypted_vault_id").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("payment_connection_user_uq").on(t.userId)]);

export const walletSetupSessions = pgTable("wallet_setup_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  setupTokenId: text("setup_token_id").notNull(),
  stateHash: text("state_hash").notNull(),
  status: text("status").notNull().default("PENDING"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("wallet_setup_user_idx").on(t.userId), uniqueIndex("wallet_setup_token_uq").on(t.setupTokenId)]);

export const mockOrders = pgTable("mock_store_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  intentId: uuid("intent_id").notNull().references(() => purchaseIntents.id),
  quoteId: uuid("quote_id").notNull().references(() => mockQuotes.id),
  sku: text("sku").notNull(),
  variant: text("variant").notNull(),
  seller: text("seller").notNull(),
  quantity: integer("quantity").notNull(),
  totalMinor: integer("total_minor").notNull(),
  currency: text("currency").notNull().default("USD"),
  provider: text("provider").notNull(),
  providerOrderId: text("provider_order_id"),
  providerCaptureId: text("provider_capture_id"),
  status: text("status").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("mock_order_intent_uq").on(t.intentId)]);

export const outbox = pgTable("outbox_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("outbox_dedupe_uq").on(t.dedupeKey), index("outbox_ready_idx").on(t.status, t.availableAt)]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  actor: text("actor").notNull(),
  type: text("type").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
});
