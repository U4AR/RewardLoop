import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import { getConfig } from "../config";

import { getPool } from "../db/client";

import { localDateAt } from "../domain/clock";

import {

  destinationFingerprint, maskedDestinationLabel, normalizeDestination, validateCheckout,

  type Destination, type PurchaseAuthorization,

} from "../domain/shopping-policy";

import { Channel3Catalog } from "../integrations/channel3";

import {

  GeminiPlanner, KernelDriver, ensureKernelProfile, kernelClient, openProfileBrowser, prepareCheckout,

  type BrowserDriver, type ContactDetails, type Planner, type StepLog,

} from "../integrations/shopping-agent";

import { DomainError } from "./flow";

import { getActiveWalletForUser } from "./paypal-wallet";

import { PayPalSandboxClient, type SandboxOrderAssessment } from "../integrations/paypal-sandbox";

/* ------------------------------------------------------------------ runtime (replaceable in tests) */

export type ShoppingRuntime = {

  paypal?: () => Pick<PayPalSandboxClient, "createOrder" | "getOrder" | "captureOrder">;

  openSession(input: { profileName: string; saveChanges: boolean; startUrl?: string; timeoutSeconds: number }): Promise<{ sessionId: string; liveViewUrl: string | null }>;

  closeSession(sessionId: string): Promise<void>;

  driver(sessionId: string): BrowserDriver;

  planner(): Planner;

  ensureProfile(profileName: string): Promise<void>;

  currentOffer(productId: string, merchant: string): Promise<{ available: boolean; priceMinor: number; url: string } | null>;

};

function defaultRuntime(): ShoppingRuntime {

  const config = getConfig();

  const kernel = () => {

    if (!config.KERNEL_API_KEY) throw new DomainError("BROWSER_UNAVAILABLE", "The shopping browser is not configured yet.", 503);

    return kernelClient(config.KERNEL_API_KEY);

  };

  return {

    openSession: input => openProfileBrowser(kernel(), input),

    closeSession: async id => { await kernel().browsers.deleteByID(id, { timeout: 15000, maxRetries: 1 }); },

    driver: id => new KernelDriver(kernel(), id),

    planner: () => new GeminiPlanner({ ...config }),

    ensureProfile: async name => { await ensureKernelProfile(kernel(), name); },

    currentOffer: async (productId, merchant) => {

      if (!config.CHANNEL3_API_KEY) throw new DomainError("CATALOG_UNAVAILABLE", "Product search is not configured.", 503);

      const product = await new Channel3Catalog({ apiKey: config.CHANNEL3_API_KEY, timeoutMs: 15000 }).getProduct(productId);

      const offer = product?.offers.find(o => o.sourceMerchantDomain === merchant);

      return offer ? { available: offer.availability !== "out_of_stock", priceMinor: offer.observedPriceMinor, url: offer.sourceUrl } : null;

    },

  };

}

let runtime: ShoppingRuntime | null = null;

export function setShoppingRuntime(next: ShoppingRuntime | null) { runtime = next; }

const rt = () => runtime ?? defaultRuntime();

const running = new Map<string, Promise<void>>();

/** Test hook: wait for background agent work started by this process. */

export async function settleShoppingWork() { await Promise.allSettled([...running.values()]); }

/* ------------------------------------------------------------------ private destination */

function key() {

  const raw = Buffer.from(getConfig().DATA_ENCRYPTION_KEY, "base64url");

  if (raw.length !== 32) throw new DomainError("ENCRYPTION_UNAVAILABLE", "Private storage is not configured.", 503);

  return raw;

}

function seal(value: string) {

  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);

  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return `d1:${iv.toString("base64url")}:${data.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}`;

}

function open(sealed: string) {

  const [v, iv, data, tag] = sealed.split(":");

  if (v !== "d1" || !iv || !data || !tag) throw new Error("Invalid ciphertext");

  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));

  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");

}

/** Server-derived and unique per user, so one person's retailer cookies can never load into another person's browser. */

export function profileNameFor(userId: string) {

  return `rl-${createHash("sha256").update(`rewardloop-profile:${userId}`).digest("hex").slice(0, 40)}`;

}

const destinationSchema = z.object({

  fullName: z.string().trim().min(2).max(120), line1: z.string().trim().min(3).max(160), line2: z.string().trim().max(160).optional(),

  city: z.string().trim().min(2).max(80), region: z.string().trim().min(2).max(80), postalCode: z.string().trim().min(3).max(20),

  country: z.string().trim().length(2),

  phone: z.string().trim().max(30).regex(/^[+0-9 ().-]*$/).optional(),

}).strict();

const setupSchema = z.object({ destination: destinationSchema, paymentLabel: z.string().trim().min(3).max(60).default("PayPal Sandbox") }).strict();

const planOnly = z.object({ planId: z.uuid() }).strict();

const authorizeSchema = z.object({ planId: z.uuid(), totalCapMinor: z.number().int().min(100).max(1000000), validUntil: z.iso.date(), mode: z.enum(["dry_run", "live"]), confirm: z.literal(true) }).strict();

const runSchema = z.object({ planId: z.uuid(), idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{16,64}$/) }).strict();

const attemptOnly = z.object({ attemptId: z.uuid() }).strict();

const reconcileSchema = z.object({ attemptId: z.uuid(), outcome: z.enum(["no_order", "order_found"]) }).strict();

async function loadProfile(userId: string) {

  const result = await getPool().query("SELECT * FROM shopping_profiles WHERE user_id=$1", [userId]);

  return result.rows[0] as Record<string, any> | undefined;

}

/** The user's saved delivery details and account email, decrypted only for the agent's form filling at the approved merchant. */
async function contactDetails(userId: string): Promise<ContactDetails | undefined> {
  const destination = await destinationFor(userId);
  if (!destination) return undefined;
  const email = (await getPool().query('SELECT email FROM "user" WHERE id=$1', [userId]).catch(() => ({ rows: [] as any[] }))).rows[0]?.email as string | undefined;
  const [first, ...rest] = destination.fullName.trim().split(/\s+/);
  return { email, fullName: destination.fullName, firstName: first, lastName: rest.join(" ") || first, address1: destination.line1, address2: destination.line2,
    city: destination.city, region: destination.region, postalCode: destination.postalCode, country: destination.country, phone: destination.phone };
}

async function destinationFor(userId: string): Promise<Destination | null> {

  const profile = await loadProfile(userId);

  return profile?.destination_ciphertext ? normalizeDestination(JSON.parse(open(profile.destination_ciphertext))) : null;

}

export async function saveShoppingSetup(userId: string, raw: unknown) {

  const input = setupSchema.parse(raw);

  const destination = normalizeDestination(input.destination);

  await getPool().query(`INSERT INTO shopping_profiles (user_id,kernel_profile_name,destination_ciphertext,destination_label,destination_fingerprint,payment_label,updated_at)

    VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (user_id) DO UPDATE SET destination_ciphertext=EXCLUDED.destination_ciphertext,

    destination_label=EXCLUDED.destination_label,destination_fingerprint=EXCLUDED.destination_fingerprint,payment_label=EXCLUDED.payment_label,updated_at=now()`,

  [userId, profileNameFor(userId), seal(JSON.stringify(destination)), maskedDestinationLabel(destination), destinationFingerprint(destination), input.paymentLabel]);

  await audit(userId, "SHOPPING_DESTINATION_SAVED", {});

  return { destinationLabel: maskedDestinationLabel(destination), paymentLabel: input.paymentLabel };

}

async function activePlan(userId: string, planId: string) {

  const result = await getPool().query(`SELECT p.*, (SELECT COUNT(DISTINCT business_date)::int FROM reward_checkins WHERE plan_id=p.id AND status='accepted') AS days

    FROM reward_plans p WHERE p.id=$1 AND p.user_id=$2 AND p.status='active'`, [planId, userId]);

  const plan = result.rows[0];

  if (!plan) throw new DomainError("PLAN_NOT_FOUND", "Reward not found.", 404);

  return plan as Record<string, any>;

}

function variantLabel(product: any) {

  const options = Array.isArray(product?.selectedVariant?.options) ? product.selectedVariant.options : [];

  return options.length ? options.map((o: any) => `${o.name}: ${o.label}`).join(", ").slice(0, 160) : "Default";

}

async function audit(userId: string, type: string, details: Record<string, unknown>) {

  await getPool().query("INSERT INTO audit_events (user_id,actor,type,details) VALUES ($1,$1,$2,$3)", [userId, type, JSON.stringify(details)]);

}

/** Opens the user's isolated retailer profile in Live View so they can sign in and save their address and payment at the retailer. */

export async function startRetailerSetup(userId: string, raw: unknown) {

  const { planId } = planOnly.parse(raw);

  const plan = await activePlan(userId, planId);

  const profile = await loadProfile(userId);

  if (!profile?.destination_fingerprint) throw new DomainError("DESTINATION_REQUIRED", "Save your private delivery details first.", 409);

  if (profile.setup_session_id && profile.setup_started_at && Date.now() - Date.parse(profile.setup_started_at) < 14 * 60_000) {

    throw new DomainError("SETUP_ACTIVE", "A private retailer session is already open. Finish it first.", 409);

  }

  const count = await getPool().query("SELECT COUNT(*)::int AS n FROM audit_events WHERE user_id=$1 AND type IN ('RETAILER_SETUP_STARTED','SHOPPING_RUN_STARTED') AND created_at>now()-interval '24 hours'", [userId]);

  if (count.rows[0].n >= 12) throw new DomainError("BROWSER_LIMIT", "Today's shopping-browser sessions are used. Try again tomorrow.", 429);

  await rt().ensureProfile(profile.kernel_profile_name);

  const session = await rt().openSession({ profileName: profile.kernel_profile_name, saveChanges: true, startUrl: `https://${plan.merchant}/`, timeoutSeconds: 900 });

  await getPool().query("UPDATE shopping_profiles SET setup_session_id=$2,setup_merchant=$3,setup_live_view_url=$4,setup_started_at=now(),updated_at=now() WHERE user_id=$1", [userId, session.sessionId, plan.merchant, session.liveViewUrl]);

  await audit(userId, "RETAILER_SETUP_STARTED", { planId, merchant: plan.merchant });

  return { liveViewUrl: session.liveViewUrl, merchant: plan.merchant };

}

/** Closing the session saves the profile. The user states whether they finished signing in and saving details at the retailer. */

export async function finishRetailerSetup(userId: string, raw: unknown) {

  const input = z.object({ planId: z.uuid(), ready: z.boolean() }).strict().parse(raw);

  const profile = await loadProfile(userId);

  if (!profile?.setup_session_id) throw new DomainError("SETUP_NOT_ACTIVE", "No private retailer session is open.", 409);

  try { await rt().closeSession(profile.setup_session_id); } catch { /* An expired session already saved or discarded its state. */ }

  const merchants = new Set<string>(Array.isArray(profile.retailer_ready_merchants) ? profile.retailer_ready_merchants : []);

  if (input.ready && profile.setup_merchant) merchants.add(profile.setup_merchant); else if (profile.setup_merchant) merchants.delete(profile.setup_merchant);

  await getPool().query("UPDATE shopping_profiles SET setup_session_id=NULL,setup_live_view_url=NULL,setup_started_at=NULL,retailer_ready_merchants=$2,updated_at=now() WHERE user_id=$1", [userId, JSON.stringify([...merchants])]);

  await audit(userId, "RETAILER_SETUP_FINISHED", { planId: input.planId, ready: input.ready });

  return { readyMerchants: [...merchants] };

}

/* ------------------------------------------------------------------ purchase approval */

/** An approval is separate from saving an address. It binds one exact item, merchant, destination, payment label, cap and window. */

export async function authorizePurchase(userId: string, raw: unknown) {

  const input = authorizeSchema.parse(raw);

  if (input.mode === "live") {

    throw new DomainError("LIVE_ORDERS_DISABLED", "Real retailer orders are turned off on this server. Approve a dry run instead.", 409);

  }

  const plan = await activePlan(userId, input.planId);

  const profile = await loadProfile(userId);

  if (!profile?.destination_fingerprint || !profile.payment_label) throw new DomainError("DESTINATION_REQUIRED", "Save your private delivery details first.", 409);

  const wallet = await getActiveWalletForUser(userId);

  if (!wallet) throw new DomainError("PAYPAL_WALLET_REQUIRED", "Connect your PayPal Sandbox wallet before approving this purchase.", 409);

  const walletLabel = "PayPal Sandbox · ••••" + wallet.connectionId.slice(-4);

  const today = localDateAt(new Date(), plan.timezone);

  if (input.validUntil < today || input.validUntil > plan.deadline) throw new DomainError("INVALID_WINDOW", "Choose an end date between today and the goal deadline.");

  const offer = await rt().currentOffer(plan.product_id, plan.merchant);

  if (!offer || !offer.available) throw new DomainError("OFFER_CHANGED", "This retailer offer is unavailable now.", 409);

  if (offer.priceMinor > input.totalCapMinor) throw new DomainError("CAP_TOO_LOW", "The cap must cover at least the current item price, plus shipping and tax.");

  const client = await getPool().connect();
  let approved: Record<string, any>;

  try {

    await client.query("BEGIN");

    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`purchase:${plan.id}`]);

    const open = await client.query(`SELECT 1 FROM purchase_attempts t JOIN purchase_authorizations a ON a.id=t.authorization_id

      WHERE a.plan_id=$1 AND t.state IN ('running','unknown') LIMIT 1`, [plan.id]);

    if (open.rowCount) throw new DomainError("ATTEMPT_OPEN", "A shopping run is in progress or awaiting reconciliation.", 409);

    await client.query("UPDATE purchase_attempts SET state='cancelled',updated_at=now() WHERE state IN ('queued','needs_handoff') AND authorization_id IN (SELECT id FROM purchase_authorizations WHERE plan_id=$1 AND status='active')", [plan.id]);

    await client.query("UPDATE purchase_authorizations SET status='revoked',revoked_at=now() WHERE plan_id=$1 AND status='active'", [plan.id]);

    const result = await client.query(`INSERT INTO purchase_authorizations (plan_id,user_id,product_id,product_title,variant_label,merchant,quantity,destination_fingerprint,destination_label,payment_label,currency,total_cap_minor,valid_until,mode,payment_connection_id)

      VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,'USD',$10,($11::date + interval '1 day' - interval '1 second'),$12,$13) RETURNING *`,

    [plan.id, userId, plan.product_id, String(plan.product?.title ?? "").slice(0, 300), variantLabel(plan.product), plan.merchant,

      profile.destination_fingerprint, profile.destination_label, walletLabel, input.totalCapMinor, input.validUntil, input.mode, wallet.connectionId]);

    await client.query("COMMIT");

    await audit(userId, "PURCHASE_AUTHORIZED", { planId: plan.id, authorizationId: result.rows[0].id, capMinor: input.totalCapMinor, mode: input.mode });

    approved = result.rows[0];

  } catch (error) { await client.query("ROLLBACK"); throw error; }

  finally { client.release(); }
  // The purchase itself starts automatically from the check-in that earns the goal (see startPurchaseIfReady).
  return publicAuthorization(approved);
}

/**
 * Starts the pre-approved purchase once the goal is earned. The idempotency key is derived from the approval, so each approval
 * starts at most one automatic run; every gate in startShoppingRun (goal, window, destination, offer, cap, wallet) still applies.
 */
export async function startPurchaseIfReady(userId: string, planId: string): Promise<{ started: boolean; state?: string; reason?: string } | null> {
  const pool = getPool();
  const auth = (await pool.query("SELECT id FROM purchase_authorizations WHERE plan_id=$1 AND user_id=$2 AND status='active'", [planId, userId])).rows[0];
  if (!auth) return null;
  const plan = (await pool.query(`SELECT p.required_days, (SELECT COUNT(DISTINCT c.business_date)::int FROM reward_checkins c WHERE c.plan_id=p.id AND c.status='accepted') AS days
    FROM reward_plans p WHERE p.id=$1 AND p.user_id=$2 AND p.status='active'`, [planId, userId])).rows[0];
  if (!plan || plan.days < plan.required_days) return null;
  try {
    const attempt = await startShoppingRun(userId, { planId, idempotencyKey: `auto-${auth.id}` });
    await audit(userId, "PURCHASE_AUTO_STARTED", { planId, authorizationId: auth.id, attemptId: attempt.id });
    return { started: true, state: attempt.state };
  } catch (error) {
    return { started: false, reason: error instanceof DomainError ? error.message : "The automatic purchase could not start. You can start it from the reward." };
  }
}

export async function revokePurchase(userId: string, raw: unknown) {

  const { planId } = planOnly.parse(raw);

  const pool = getPool();

  const result = await pool.query("UPDATE purchase_authorizations SET status='revoked',revoked_at=now() WHERE plan_id=$1 AND user_id=$2 AND status='active' RETURNING id", [planId, userId]);

  if (!result.rowCount) throw new DomainError("NO_APPROVAL", "There is no active purchase approval to cancel.", 404);

  // Runs see the revocation at their next checkpoint. A live run that already submitted payment stays "unknown" for reconciliation.

  const stale = await pool.query(`UPDATE purchase_attempts SET state='cancelled',error='Approval cancelled by you.',updated_at=now()

    WHERE authorization_id=$1 AND state IN ('queued','needs_handoff') RETURNING kernel_session_id`, [result.rows[0].id]);

  for (const row of stale.rows) if (row.kernel_session_id) await rt().closeSession(row.kernel_session_id).catch(() => {});

  await audit(userId, "PURCHASE_REVOKED", { planId, authorizationId: result.rows[0].id });

  return { revoked: true };

}

function publicAuthorization(row: Record<string, any>) {

  return { id: row.id, productTitle: row.product_title, variantLabel: row.variant_label, merchant: row.merchant, quantity: row.quantity,

    destinationLabel: row.destination_label, paymentLabel: row.payment_label, currency: row.currency, totalCapMinor: row.total_cap_minor,

    validFrom: new Date(row.valid_from).toISOString(), validUntil: new Date(row.valid_until).toISOString(), mode: row.mode, status: row.status };

}

function toAuthorization(row: Record<string, any>): PurchaseAuthorization {

  return { id: row.id, productId: row.product_id, productTitle: row.product_title, variantLabel: row.variant_label, merchant: row.merchant, quantity: row.quantity,

    paymentConnectionId: row.payment_connection_id, destinationFingerprint: row.destination_fingerprint, destinationLabel: row.destination_label, paymentLabel: row.payment_label, currency: "USD",

    totalCapMinor: row.total_cap_minor, validFrom: new Date(row.valid_from).toISOString(), validUntil: new Date(row.valid_until).toISOString(), mode: row.mode, status: row.status };

}

/* ------------------------------------------------------------------ shopping runs */

export async function startShoppingRun(userId: string, raw: unknown) {

  const input = runSchema.parse(raw);

  const pool = getPool();

  const existing = await pool.query("SELECT * FROM purchase_attempts WHERE user_id=$1 AND idempotency_key=$2", [userId, input.idempotencyKey]);

  if (existing.rowCount) return publicAttempt(existing.rows[0]);

  const plan = await activePlan(userId, input.planId);

  const auth = (await pool.query("SELECT * FROM purchase_authorizations WHERE plan_id=$1 AND user_id=$2 AND status='active'", [plan.id, userId])).rows[0];

  if (!auth) throw new DomainError("NO_APPROVAL", "Approve this purchase before starting the shopping agent.", 409);

  if (Date.now() > Date.parse(auth.valid_until)) throw new DomainError("APPROVAL_EXPIRED", "This purchase approval has expired. Approve it again.", 409);

  if (plan.days < plan.required_days) throw new DomainError("GOAL_INCOMPLETE", "The shopping agent starts only after the goal is earned.", 409);

  const profile = await loadProfile(userId);

  if (!profile?.destination_fingerprint) throw new DomainError("DESTINATION_REQUIRED", "Save your private delivery details first.", 409);

  if (profile.destination_fingerprint !== auth.destination_fingerprint) throw new DomainError("DESTINATION_CHANGED", "Your delivery details changed after you approved this purchase. Approve it again.", 409);

  const offer = await rt().currentOffer(plan.product_id, plan.merchant);

  if (!offer || !offer.available) throw new DomainError("OFFER_CHANGED", "The approved offer is unavailable now. Nothing was purchased.", 409);

  if (offer.priceMinor > auth.total_cap_minor) throw new DomainError("OVER_CAP", "The current item price is above your approved cap. Nothing was purchased.", 409);

  const count = await pool.query("SELECT COUNT(*)::int AS n FROM audit_events WHERE user_id=$1 AND type IN ('RETAILER_SETUP_STARTED','SHOPPING_RUN_STARTED') AND created_at>now()-interval '24 hours'", [userId]);

  if (count.rows[0].n >= 12) throw new DomainError("BROWSER_LIMIT", "Today's shopping-browser sessions are used. Try again tomorrow.", 429);

  let attempt: Record<string, any>;

  try {

    attempt = (await pool.query(`INSERT INTO purchase_attempts (authorization_id,user_id,idempotency_key,mode,observation) VALUES ($1,$2,$3,$4,$5) RETURNING *`,

      [auth.id, userId, input.idempotencyKey, auth.mode, JSON.stringify({ offerUrl: offer.url, catalogPriceMinor: offer.priceMinor })])).rows[0];

  } catch (error: any) {

    if (error?.code === "23505") {

      const open = await pool.query("SELECT * FROM purchase_attempts WHERE authorization_id=$1 AND state IN ('queued','running','needs_handoff','unknown') LIMIT 1", [auth.id]);

      if (open.rowCount) return publicAttempt(open.rows[0]);

      const dupe = await pool.query("SELECT * FROM purchase_attempts WHERE user_id=$1 AND idempotency_key=$2", [userId, input.idempotencyKey]);

      if (dupe.rowCount) return publicAttempt(dupe.rows[0]);

    }

    throw error;

  }

  await audit(userId, "SHOPPING_RUN_STARTED", { planId: plan.id, attemptId: attempt.id, mode: auth.mode });

  launch(attempt.id, false);

  return publicAttempt(attempt);

}

export async function resumeShoppingRun(userId: string, raw: unknown) {

  const { attemptId } = attemptOnly.parse(raw);

  const row = (await getPool().query("SELECT * FROM purchase_attempts WHERE id=$1 AND user_id=$2", [attemptId, userId])).rows[0];

  if (!row) throw new DomainError("ATTEMPT_NOT_FOUND", "Shopping run not found.", 404);

  if (row.state !== "needs_handoff") throw new DomainError("NOT_WAITING", "This run is not waiting for you.", 409);

  launch(attemptId, true);

  return publicAttempt(row);

}

export async function cancelShoppingRun(userId: string, raw: unknown) {

  const { attemptId } = attemptOnly.parse(raw);

  const result = await getPool().query(`UPDATE purchase_attempts SET state='cancelled',error='Cancelled by you.',updated_at=now()

    WHERE id=$1 AND user_id=$2 AND payment_submitted_at IS NULL AND state IN ('queued','running','needs_handoff') RETURNING *`, [attemptId, userId]);

  if (!result.rowCount) throw new DomainError("CANNOT_CANCEL", "This run cannot be cancelled now. If payment may have been submitted, check with the retailer.", 409);

  if (result.rows[0].kernel_session_id) await rt().closeSession(result.rows[0].kernel_session_id).catch(() => {});

  return publicAttempt(result.rows[0]);

}

/** Unknown outcomes are resolved by the user after checking their retailer account. RewardLoop never retries payment by itself. */

export async function reconcileShoppingRun(userId: string, raw: unknown) {

  const input = reconcileSchema.parse(raw);

  const pool = getPool();

  const payment = (await pool.query("SELECT p.* FROM shopping_paypal_payments p JOIN purchase_attempts t ON t.id=p.attempt_id WHERE t.id=$1 AND t.user_id=$2 AND t.state='unknown'", [input.attemptId, userId])).rows[0];

  if (payment) {

    if (!payment.order_id) throw new DomainError("PAYPAL_ORDER_UNKNOWN", "PayPal may have received the payment but returned no order ID. Check the Sandbox merchant dashboard using this run ID; payment will not be retried.", 409);

    const result = await paypalClient().getOrder({ orderId: payment.order_id, expectedTotalCents: payment.total_minor, referenceId: input.attemptId });

    await recordPayPalResult(payment, result);

    return publicAttempt((await pool.query("SELECT * FROM purchase_attempts WHERE id=$1", [input.attemptId])).rows[0]);

  }

  const result = await pool.query(`UPDATE purchase_attempts SET state=$3,updated_at=now() WHERE id=$1 AND user_id=$2 AND state='unknown' RETURNING *`,

    [input.attemptId, userId, input.outcome === "no_order" ? "reconciled_no_order" : "reported_purchased"]);

  if (!result.rowCount) throw new DomainError("NOT_UNKNOWN", "Only runs with an unknown result need reconciliation.", 409);

  if (input.outcome === "order_found") await pool.query("UPDATE purchase_authorizations SET status='consumed' WHERE id=$1", [result.rows[0].authorization_id]);

  await audit(userId, "SHOPPING_RUN_RECONCILED", { attemptId: input.attemptId, outcome: input.outcome });

  return publicAttempt(result.rows[0]);

}

function launch(attemptId: string, resume: boolean) {

  if (running.has(attemptId)) return;

  const work = executeAttempt(attemptId, resume).catch(error => console.error("Shopping run failed", error instanceof Error ? error.name : "unknown"))

    .finally(() => running.delete(attemptId));

  running.set(attemptId, work);

}

class Cancelled extends Error {}

async function executeAttempt(attemptId: string, resume: boolean) {

  const pool = getPool();

  const owner = randomUUID();

  const leased = await pool.query(`UPDATE purchase_attempts SET state='running',lease_owner=$2,lease_expires_at=now()+interval '4 minutes',updated_at=now()

    WHERE id=$1 AND state=$3 AND (lease_expires_at IS NULL OR lease_expires_at<now() OR $3='needs_handoff') RETURNING *`, [attemptId, owner, resume ? "needs_handoff" : "queued"]);

  const attempt = leased.rows[0];

  if (!attempt) return; // Another worker owns it, or it was cancelled.

  const auth = (await pool.query("SELECT * FROM purchase_authorizations WHERE id=$1", [attempt.authorization_id])).rows[0];

  const plan = (await pool.query(`SELECT p.*, (SELECT COUNT(DISTINCT business_date)::int FROM reward_checkins WHERE plan_id=p.id AND status='accepted') AS days FROM reward_plans p WHERE p.id=$1`, [auth.plan_id])).rows[0];

  const profile = await loadProfile(attempt.user_id);

  const steps: StepLog[] = Array.isArray(attempt.steps) ? attempt.steps : [];

  let sessionId: string | null = attempt.kernel_session_id;

  let keepSession = false;

  const log = async (step: StepLog) => {

    steps.push(step);

    await pool.query("UPDATE purchase_attempts SET steps=$2,lease_expires_at=now()+interval '4 minutes',updated_at=now() WHERE id=$1 AND lease_owner=$3", [attemptId, JSON.stringify(steps.slice(-40)), owner]);

  };

  const checkpoint = async () => {

    const now = (await pool.query(`SELECT t.state, a.status FROM purchase_attempts t JOIN purchase_authorizations a ON a.id=t.authorization_id WHERE t.id=$1`, [attemptId])).rows[0];

    if (!now || now.state !== "running" || now.status !== "active") throw new Cancelled();

  };

  const finish = async (state: string, extra: Record<string, unknown> = {}) => {

    await pool.query(`UPDATE purchase_attempts SET state=$2,observation=COALESCE($3,observation),validation=COALESCE($4,validation),receipt=COALESCE($5,receipt),error=$6,

      lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND lease_owner=$7`,

    [attemptId, state, extra.observation ? JSON.stringify(extra.observation) : null, extra.validation ? JSON.stringify(extra.validation) : null,

      extra.receipt ? JSON.stringify(extra.receipt) : null, (extra.error as string | undefined) ?? null, owner]);

  };

  try {

    if (!sessionId) {

      const session = await rt().openSession({ profileName: profile!.kernel_profile_name, saveChanges: false, timeoutSeconds: 600 });

      sessionId = session.sessionId;

      await pool.query("UPDATE purchase_attempts SET kernel_session_id=$2,live_view_url=$3 WHERE id=$1", [attemptId, sessionId, session.liveViewUrl]);

    }

    const driver = rt().driver(sessionId), planner = rt().planner();

    const approved = { title: auth.product_title, variant: auth.variant_label, merchant: auth.merchant };

    const outcome = await prepareCheckout({ driver, planner, approved, offerUrl: resume ? null : attempt.observation?.offerUrl ?? plan.offer_url,

      maxSteps: 18, log, checkpoint, contact: await contactDetails(attempt.user_id) });

    if (outcome.kind === "handoff") { keepSession = true; return await finish("needs_handoff", { error: outcome.reason }); }

    if (outcome.kind === "blocked") return await finish("blocked", { error: outcome.reason });

    const validation = validateCheckout({ authorization: toAuthorization(auth), destination: await destinationFor(attempt.user_id),

      goalEarned: plan.days >= plan.required_days, observation: outcome.observation });

    if (!validation.ok) return await finish("blocked", { observation: outcome.observation, validation, error: validation.reasons[0] });

    // Retailer order submission is deliberately unreachable: payment is Sandbox-only.

    await payValidatedCheckout(attemptId, owner, outcome.observation);

  } catch (error) {

    if (error instanceof Cancelled) { await finish("cancelled", { error: "Stopped because the approval or run was cancelled." }); return; }

    const paid = (await pool.query("SELECT payment_submitted_at FROM purchase_attempts WHERE id=$1", [attemptId])).rows[0]?.payment_submitted_at;

    await finish(paid ? "unknown" : "blocked", { error: paid ? "The connection failed after payment may have been submitted. Check your retailer account." : "The shopping browser stopped before any payment step. Nothing was purchased." });

  } finally {

    if (sessionId && !keepSession) await rt().closeSession(sessionId).catch(() => {});

  }

}

/** Interrupted runs: no payment submitted means safe to stop; payment submitted means unknown, never a silent retry. */

async function sweepStaleRuns(userId: string) {

  await getPool().query(`UPDATE purchase_attempts SET state=CASE WHEN payment_submitted_at IS NULL AND NOT EXISTS (SELECT 1 FROM shopping_paypal_payments p WHERE p.attempt_id=purchase_attempts.id) THEN 'blocked' ELSE 'unknown' END,

    error=CASE WHEN payment_submitted_at IS NULL AND NOT EXISTS (SELECT 1 FROM shopping_paypal_payments p WHERE p.attempt_id=purchase_attempts.id) THEN 'The run was interrupted before any payment step. Nothing was purchased.' ELSE 'The run was interrupted after payment may have been submitted. Check your retailer account.' END,

    lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE user_id=$1 AND state='running' AND lease_expires_at<now()`, [userId]);

}

function publicAttempt(row: Record<string, any>) {

  return { id: row.id, mode: row.mode, state: row.state, steps: Array.isArray(row.steps) ? row.steps : [], observation: row.observation ?? null,

    validation: row.validation ?? null, receipt: row.receipt ?? null, error: row.error ?? null,

    liveViewUrl: ["running", "needs_handoff"].includes(row.state) ? row.live_view_url ?? null : null,

    paymentSubmitted: Boolean(row.payment_submitted_at), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };

}

export async function shoppingState(userId: string, raw: unknown) {

  const { planId } = planOnly.parse(raw);

  await sweepStaleRuns(userId);

  const plan = await activePlan(userId, planId);

  const pool = getPool();

  const profile = await loadProfile(userId);

  const auth = (await pool.query("SELECT * FROM purchase_authorizations WHERE plan_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1", [plan.id, userId])).rows[0];

  const attempts = auth ? (await pool.query(`SELECT t.* FROM purchase_attempts t JOIN purchase_authorizations a ON a.id=t.authorization_id

    WHERE a.plan_id=$1 AND t.user_id=$2 ORDER BY t.created_at DESC LIMIT 5`, [plan.id, userId])).rows : [];

  const setupOpen = Boolean(profile?.setup_session_id && profile.setup_started_at && Date.now() - Date.parse(profile.setup_started_at) < 15 * 60_000);

  return {

    profile: profile ? { destinationLabel: profile.destination_label, paymentLabel: profile.payment_label,

      retailerReady: (profile.retailer_ready_merchants ?? []).includes(plan.merchant), setupOpen, setupMerchant: setupOpen ? profile.setup_merchant : null,

      setupLiveViewUrl: setupOpen ? profile.setup_live_view_url ?? null : null,

      destinationChanged: Boolean(auth && auth.status === "active" && auth.destination_fingerprint !== profile.destination_fingerprint) } : null,

    authorization: auth ? publicAuthorization(auth) : null,

    attempts: attempts.map(publicAttempt),

    liveOrdersEnabled: false,

    walletConnected: Boolean(await getActiveWalletForUser(userId)),

    goalEarned: plan.days >= plan.required_days, variantLabel: variantLabel(plan.product), budgetMinor: plan.budget_minor, deadline: plan.deadline,

  };

}

/* ------------------------------------------------------------------ schema (development convenience) */

let schemaReady: Promise<void> | null = null;

/**

 * Applies the idempotent 0008 migration if its tables are missing, so a running development server picks up the shopping

 * tables without a manual step. Production releases still run `npm run db:migrate`; the SQL is safe to apply twice.

 */

export function ensureShoppingSchema() {

  schemaReady ??= (async () => {

    const pool = getPool();

    const exists = await pool.query("SELECT to_regclass('public.purchase_attempts') AS t, to_regclass('public.shopping_profiles') AS p");

    if (!(exists.rows[0].t && exists.rows[0].p)) {

    const { readFile } = await import("node:fs/promises");

    const path = await import("node:path");

    const sql = await readFile(path.join(process.cwd(), "src/db/migrations/0008_shopping_agent.sql"), "utf8");

    for (const statement of sql.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean)) await pool.query(statement);

    }

    const { readFile: readPaymentSql } = await import("node:fs/promises");

    const { join } = await import("node:path");

    const paymentSql = await readPaymentSql(join(process.cwd(), "src/db/migrations/0009_shopping_paypal.sql"), "utf8");

    for (const statement of paymentSql.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean)) await pool.query(statement);
    const journalSql = await readPaymentSql(join(process.cwd(), "src/db/migrations/0010_journal_media_gift.sql"), "utf8");
    for (const statement of journalSql.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean)) await pool.query(statement);
  })().catch(error => { schemaReady = null; throw error; });

  return schemaReady;

}

/* Sandbox payment: one durable reservation per approval, never a second CREATE on retry. */

function paypalClient() {

  if (rt().paypal) return rt().paypal!();

  const c = getConfig();

  return new PayPalSandboxClient({ apiBaseUrl: c.PAYPAL_API_BASE_URL, clientId: c.PAYPAL_SANDBOX_CLIENT_ID ?? "",

    clientSecret: c.PAYPAL_SANDBOX_CLIENT_SECRET ?? "", merchantId: c.PAYPAL_SANDBOX_MERCHANT_ID });

}

async function recordPayPalResult(payment: Record<string, any>, result: SandboxOrderAssessment) {

  const pool = getPool();

  // Client assessments already verify capture amount, currency, reference and Sandbox payee.

  const paid = result.state === "CONFIRMED" && result.captureStatus === "COMPLETED" && !!result.captureId;

  const db = await pool.connect();

  try {

    await db.query("BEGIN");

    const current = (await db.query("SELECT status FROM shopping_paypal_payments WHERE attempt_id=$1 FOR UPDATE", [payment.attempt_id])).rows[0];

    if (current?.status === "paid") { await db.query("COMMIT"); return; }

    await db.query("UPDATE shopping_paypal_payments SET order_id=$2,capture_id=$3,status=$4,updated_at=now() WHERE attempt_id=$1", [payment.attempt_id, result.orderId, result.captureId ?? null, paid ? "paid" : "unknown"]);

    await db.query(`UPDATE purchase_attempts SET state=$2,receipt=$3,error=$4,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,

      [payment.attempt_id, paid ? "sandbox_paid" : "unknown", JSON.stringify({ environment: "sandbox", orderId: result.orderId, captureId: paid ? result.captureId : null,

        totalMinor: payment.total_minor, currency: "USD", retailerOrderPlaced: false }), paid ? null : "PayPal Sandbox payment is not verified. Reconcile the existing order; never start another payment."]);

    if (paid) await db.query("UPDATE purchase_authorizations SET status='consumed' WHERE id=$1", [payment.authorization_id]);

    await db.query("COMMIT");

  } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }

}

async function payValidatedCheckout(attemptId: string, owner: string, observation: import("../domain/shopping-policy").CheckoutObservation) {

  const pool = getPool();

  // This reservation survives process death even if the response and order ID are lost.

  const reserved = await pool.query(`INSERT INTO shopping_paypal_payments (attempt_id,authorization_id,total_minor)

    SELECT id,authorization_id,$2 FROM purchase_attempts WHERE id=$1 AND lease_owner=$3

    ON CONFLICT (authorization_id) DO NOTHING RETURNING *`, [attemptId, observation.totalMinor, owner]);

  if (!reserved.rowCount) throw new Error("Payment already reserved; reconcile instead");

  const payment = reserved.rows[0];
  await pool.query("UPDATE purchase_attempts SET observation=$2,validation=$3 WHERE id=$1 AND lease_owner=$4", [attemptId, JSON.stringify(observation), JSON.stringify({ ok: true, reasons: [], checkedAt: new Date().toISOString() }), owner]);

  const db = await pool.connect();

  let result: SandboxOrderAssessment | null = null;

  try {

    await db.query("BEGIN");

    // Keep locks through dispatch: revoke/disconnect/address edits serialize against the charge.

    const auth = (await db.query("SELECT a.* FROM purchase_authorizations a WHERE id=$1 FOR UPDATE", [payment.authorization_id])).rows[0];

    const profile = (await db.query("SELECT * FROM shopping_profiles WHERE user_id=$1 FOR UPDATE", [auth.user_id])).rows[0];

    const plan = (await db.query("SELECT * FROM reward_plans WHERE id=$1 FOR UPDATE", [auth.plan_id])).rows[0];

    const connection = (await db.query("SELECT * FROM payment_connections WHERE id=$1 AND user_id=$2 FOR UPDATE", [auth.payment_connection_id, auth.user_id])).rows[0];

    const attempt = (await db.query("SELECT * FROM purchase_attempts WHERE id=$1 FOR UPDATE", [attemptId])).rows[0];

    const beforeFinancialPost = async () => {

      if (!attempt || attempt.state !== "running" || attempt.lease_owner !== owner || new Date(attempt.lease_expires_at).getTime() < Date.now() || plan.status !== "active") throw new Cancelled();

      if (!connection || connection.status !== "ACTIVE" || connection.environment !== "sandbox" || connection.merchant_id !== getConfig().PAYPAL_SANDBOX_MERCHANT_ID) throw new Cancelled();

      const days = (await db.query("SELECT COUNT(DISTINCT business_date)::int AS n FROM reward_checkins WHERE plan_id=$1 AND status='accepted'", [plan.id])).rows[0].n;

      const destination = profile?.destination_ciphertext ? normalizeDestination(JSON.parse(open(profile.destination_ciphertext))) : null;

      const validation = validateCheckout({ authorization: toAuthorization(auth), destination, goalEarned: days >= plan.required_days, observation });

      if (!validation.ok) throw new Cancelled();

    };

    await beforeFinancialPost();

    const wallet = await getActiveWalletForUser(auth.user_id);

    if (!wallet || wallet.connectionId !== auth.payment_connection_id) throw new Cancelled();

    await db.query("UPDATE purchase_attempts SET payment_submitted_at=now(),observation=$2,validation=$3 WHERE id=$1", [attemptId, JSON.stringify(observation), JSON.stringify({ ok: true, reasons: [], checkedAt: new Date().toISOString() })]);

    // The Sandbox adapter disallows live API origins. It never retries financial POSTs.

    result = await paypalClient().createOrder({ totalCents: payment.total_minor, vaultId: wallet.vaultId, referenceId: attemptId, requestId: attemptId, beforeFinancialPost });

    // Persist the returned order ID before a separate capture, so recovery uses GET only.

    await pool.query("UPDATE shopping_paypal_payments SET order_id=$2,updated_at=now() WHERE attempt_id=$1", [attemptId, result.orderId]);

    if (result.state === "READY_TO_CAPTURE" && !result.reason) result = await paypalClient().captureOrder({ orderId: result.orderId, expectedTotalCents: payment.total_minor, referenceId: attemptId, requestId: `${attemptId}-capture`, beforeFinancialPost });

    await db.query("COMMIT");

  } catch (error) {

    await db.query("ROLLBACK");

    if (error instanceof Cancelled) throw error;

    await pool.query("UPDATE purchase_attempts SET payment_submitted_at=COALESCE(payment_submitted_at,now()),state='unknown',error='PayPal Sandbox outcome unknown. Reconcile this run; no payment will be retried.',lease_owner=NULL,lease_expires_at=NULL WHERE id=$1", [attemptId]);

    return;

  } finally { db.release(); }

  if (result) await recordPayPalResult(payment, result);

}
