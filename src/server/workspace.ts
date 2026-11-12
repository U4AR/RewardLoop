import { createHash } from "node:crypto";
import { z } from "zod";
import { getConfig } from "../config";
import { getPool } from "../db/client";
import { localDateAt, assertIanaTimezone } from "../domain/clock";
import { Channel3Catalog, Channel3Error } from "../integrations/channel3";
import { reviewWithVertex, type ReviewMedia } from "../integrations/vertex-review";
import { startPurchaseIfReady } from "./shopping";
import { checkRetailerPage } from "../integrations/retailer-check";
import { DomainError } from "./flow";

const planSchema = z.object({
  productId: z.string().min(1).max(128), merchant: z.string().min(3).max(253),
  goalTitle: z.string().trim().min(4).max(120), rubric: z.string().trim().min(20).max(1200),
  requiredDays: z.number().int().min(1).max(60), timezone: z.string().min(1).max(80),
  deadline: z.iso.date(), budgetMinor: z.number().int().min(100).max(1000000),
  recipientName: z.string().trim().min(1).max(60).optional(),
}).strict();
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VOICE_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"];
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const evidenceSchema = z.object({
  planId: z.uuid(), kind: z.enum(["text", "photo", "voice"]).default("text"), notes: z.string().trim().max(5000).default(""),
  media: z.object({ mimeType: z.string().max(60), base64: z.string().max(11_200_000) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "text" && value.notes.length < 30) ctx.addIssue({ code: "custom", path: ["notes"], message: "Write at least 30 characters about today's progress." });
  if (value.kind !== "text" && !value.media) ctx.addIssue({ code: "custom", path: ["media"], message: "Add a photo or a voice recording." });
  if (value.kind === "text" && value.media) ctx.addIssue({ code: "custom", path: ["media"], message: "Text check-ins do not carry media." });
});

/** Decodes and checks a photo or voice recording. Only known image/audio types up to 8 MB are accepted. */
export function evidenceMedia(input: z.infer<typeof evidenceSchema>): (ReviewMedia & { bytes: Buffer }) | undefined {
  if (input.kind === "text" || !input.media) return undefined;
  const mimeType = input.media.mimeType.split(";")[0].trim().toLowerCase();
  const allowed = input.kind === "photo" ? PHOTO_TYPES : VOICE_TYPES;
  if (!allowed.includes(mimeType)) throw new DomainError("MEDIA_TYPE", input.kind === "photo" ? "Use a JPEG, PNG or WebP photo." : "This recording format is not supported. Try recording again.", 400);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.media.base64)) throw new DomainError("MEDIA_INVALID", "The photo or recording could not be read.", 400);
  const bytes = Buffer.from(input.media.base64, "base64");
  if (bytes.length < 200) throw new DomainError("MEDIA_INVALID", "The photo or recording is empty.", 400);
  if (bytes.length > MAX_MEDIA_BYTES) throw new DomainError("MEDIA_TOO_LARGE", "Keep photos and recordings under 8 MB.", 413);
  return { kind: input.kind, mimeType, base64: input.media.base64, bytes };
}
const idSchema = z.object({ planId: z.uuid() }).strict();

function catalog() {
  const key = getConfig().CHANNEL3_API_KEY;
  if (!key) throw new DomainError("CATALOG_UNAVAILABLE", "Product search is being connected. Please try again later.", 503);
  return new Channel3Catalog({ apiKey: key, timeoutMs: 15000 });
}

export async function workspaceState(userId: string) {
  const pool = getPool();
  const [plans, checkins, stats] = await Promise.all([
    pool.query(`SELECT p.*, (SELECT COUNT(DISTINCT c.business_date)::int FROM reward_checkins c WHERE c.plan_id=p.id AND c.status='accepted') AS accepted_days
      FROM reward_plans p WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 100`, [userId]),
    pool.query(`SELECT c.id,c.plan_id,c.business_date,c.evidence_kind,(c.media_data IS NOT NULL) AS has_media,CASE WHEN c.status='pending' AND c.created_at<now()-interval '2 minutes' THEN 'error' ELSE c.status END AS status,c.review,c.created_at,c.notes FROM reward_checkins c
      WHERE c.user_id=$1 ORDER BY c.created_at DESC LIMIT 100`, [userId]),
    pool.query(`SELECT COUNT(DISTINCT (plan_id,business_date))::int AS total_days FROM reward_checkins WHERE user_id=$1 AND status='accepted'`, [userId]),
  ]);
  const config = getConfig();
  return { plans: plans.rows, checkins: checkins.rows, stats: { totalDays: stats.rows[0].total_days }, services: {
    catalog: Boolean(config.CHANNEL3_API_KEY), reviewer: config.GOOGLE_AI_BACKEND === "gemini_api" ? Boolean(config.GEMINI_API_KEY) : Boolean(config.VERTEX_PROJECT_ID),
    browser: Boolean(config.KERNEL_API_KEY), reviewerName: "RewardLoop AI", currency: "USD",
  } };
}

export async function createRewardPlan(userId: string, raw: unknown) {
  const input = planSchema.parse(raw);
  assertIanaTimezone(input.timezone);
  const today = localDateAt(new Date(), input.timezone);
  const availableDays = (Date.parse(`${input.deadline}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000 + 1;
  if (availableDays < input.requiredDays || availableDays > 366) throw new DomainError("INVALID_DEADLINE", "Choose a deadline with enough days to complete your goal.");
  const config = getConfig();
  if (config.GOOGLE_AI_BACKEND === "gemini_api" ? !config.GEMINI_API_KEY : !config.VERTEX_PROJECT_ID) throw new DomainError("REVIEWER_UNAVAILABLE", "The hosted progress reviewer is not configured yet.", 503);
  const product = await catalog().getProduct(input.productId);
  if (!product) throw new DomainError("PRODUCT_UNAVAILABLE", "This product is no longer available. Search for another reward.", 409);
  const offer = product.offers.find(item => item.sourceMerchantDomain === input.merchant);
  if (!offer || offer.availability === "out_of_stock") throw new DomainError("OFFER_CHANGED", "This offer changed. Search again to see the current retailer options.", 409);
  if (offer.observedPriceMinor > input.budgetMinor) throw new DomainError("OVER_BUDGET", "Your budget needs to cover the current item price. Shipping and tax are confirmed at the retailer.");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`workspace:${userId}`]);
    const count = await client.query("SELECT COUNT(*)::int AS n FROM reward_plans WHERE user_id=$1 AND status='active'", [userId]);
    if (count.rows[0].n >= 12) throw new DomainError("PLAN_LIMIT", "Archive a reward before adding another. You can have 12 active rewards.", 409);
    const result = await client.query(`INSERT INTO reward_plans (user_id,product_id,product,offer_url,merchant,goal_title,rubric,required_days,timezone,start_date,deadline,budget_minor,review_model,recipient_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [userId, input.productId, JSON.stringify(product), offer.sourceUrl, offer.sourceMerchantDomain, input.goalTitle, input.rubric,
      input.requiredDays, input.timezone, today, input.deadline, input.budgetMinor, config.VERTEX_MODEL, input.recipientName ?? null]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function submitCheckin(userId: string, raw: unknown) {
  const input = evidenceSchema.parse(raw);
  const media = evidenceMedia(input);
  const config = getConfig();
  const pool = getPool();
  const client = await pool.connect();
  let checkinId: string;
  let plan: Record<string, any>;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`workspace:${userId}`]);
    const result = await client.query("SELECT * FROM reward_plans WHERE id=$1 AND user_id=$2 AND status='active' FOR UPDATE", [input.planId, userId]);
    plan = result.rows[0];
    if (!plan) throw new DomainError("PLAN_NOT_FOUND", "This reward is no longer active.", 404);
    const today = localDateAt(new Date(), plan.timezone);
    if (today > plan.deadline || today < plan.start_date) throw new DomainError("GOAL_ENDED", "This goal is outside its check-in period.", 409);
    const counts = await client.query(`SELECT (SELECT COUNT(*)::int FROM audit_events WHERE user_id=$1 AND type='CLOUD_REVIEW_REQUESTED' AND created_at>now()-interval '24 hours') AS n,
      COUNT(*) FILTER (WHERE status='pending' AND created_at>now()-interval '2 minutes')::int AS pending
      FROM reward_checkins WHERE user_id=$1 AND created_at>now()-interval '24 hours'`, [userId]);
    if (counts.rows[0].n >= 20 || counts.rows[0].pending > 0) throw new DomainError("REVIEW_LIMIT", "Give the current review a moment, or return tomorrow if you have used today's 20 reviews.", 429);
    const accepted = await client.query("SELECT id FROM reward_checkins WHERE plan_id=$1 AND business_date=$2 AND status='accepted' LIMIT 1", [plan.id, today]);
    if (accepted.rowCount) throw new DomainError("DAY_COMPLETE", "Today's progress already counts toward this reward. Come back tomorrow.", 409);
    const digest = createHash("sha256").update(input.notes.normalize("NFKC").replace(/\s+/g, " ").toLowerCase());
    if (media) digest.update(`|${input.kind}|`).update(media.bytes);
    const hash = digest.digest("hex");
    const added = await client.query(`INSERT INTO reward_checkins (plan_id,user_id,business_date,notes,content_hash,evidence_kind,media_mime,media_data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (plan_id,content_hash) DO UPDATE SET status='pending',review=NULL,business_date=EXCLUDED.business_date,created_at=now()
      WHERE reward_checkins.status='error' OR (reward_checkins.status='pending' AND reward_checkins.created_at<now()-interval '2 minutes')
      RETURNING id`, [plan.id, userId, today, input.notes, hash, input.kind, media?.mimeType ?? null, media?.bytes ?? null]);
    if (!added.rowCount) throw new DomainError("DUPLICATE_CHECKIN", "You already submitted these notes. Add new evidence of your progress.", 409);
    checkinId = added.rows[0].id;
    await client.query("INSERT INTO audit_events (user_id,actor,type,details) VALUES ($1,$1,'CLOUD_REVIEW_REQUESTED',$2)", [userId, JSON.stringify({ planId: plan.id, checkinId })]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  try {
    const review = await reviewWithVertex({ rubric: plan.rubric, notes: input.notes, media: media && { kind: media.kind, mimeType: media.mimeType, base64: media.base64 } },
      { ...config, VERTEX_MODEL: plan.review_model });
    await pool.query("UPDATE reward_checkins SET status=$2,review=$3 WHERE id=$1", [checkinId, review.decision, JSON.stringify(review)]);
    // An accepted check-in that completes the goal starts the pre-approved purchase automatically (if one was approved).
    const autoPurchase = review.decision === "accepted" ? await startPurchaseIfReady(userId, plan.id).catch(() => null) : null;
    return { id: checkinId, ...review, autoPurchase };
  } catch (error) {
    await pool.query("UPDATE reward_checkins SET status='error' WHERE id=$1", [checkinId]);
    const cause = reviewFailureCause(error);
    console.warn("Cloud review failed:", cause);
    throw new DomainError("REVIEW_UNAVAILABLE", "Your notes are saved, but RewardLoop AI could not finish the review. You can retry these same notes shortly.", 503);
  }
}

export async function inspectReward(userId: string, raw: unknown) {
  const { planId } = idSchema.parse(raw);
  const pool = getPool();
  const config = getConfig();
  if (!config.KERNEL_API_KEY) throw new DomainError("BROWSER_UNAVAILABLE", "The retailer check is not configured yet.", 503);
  const result = await pool.query(`UPDATE reward_plans SET check_started_at=now() WHERE id=$1 AND user_id=$2 AND status='active'
    AND (check_started_at IS NULL OR check_started_at<now()-interval '2 minutes') RETURNING *`, [planId, userId]);
  const plan = result.rows[0];
  if (!plan) throw new DomainError("CHECK_BUSY", "This reward is unavailable or was checked recently. Wait two minutes and try again.", 409);
  // Cross-plan checks are bounded using the same daily credit limit.
  const count = await pool.query("SELECT COUNT(*)::int AS n FROM audit_events WHERE user_id=$1 AND type='RETAILER_CHECK_REQUESTED' AND created_at>now()-interval '24 hours'", [userId]);
  if (count.rows[0].n >= 12) throw new DomainError("CHECK_LIMIT", "Today's retailer checks are used. You can check again tomorrow.", 429);
  await pool.query("INSERT INTO audit_events (user_id,actor,type,details) VALUES ($1,$1,'RETAILER_CHECK_REQUESTED',$2)", [userId, JSON.stringify({ planId })]);
  try {
    const check = await checkRetailerPage(plan.offer_url, config.KERNEL_API_KEY, plan.merchant);
    await pool.query("UPDATE reward_plans SET retailer_check=$3 WHERE id=$1 AND user_id=$2", [planId, userId, JSON.stringify(check)]);
    return check;
  } catch {
    throw new DomainError("RETAILER_CHECK_FAILED", "The retailer could not be checked. It may block automated browsers. No account or cart was changed.", 502);
  }
}

export async function checkoutReward(userId: string, raw: unknown) {
  const { planId } = idSchema.parse(raw);
  const pool = getPool();
  const result = await pool.query(`SELECT p.*, (SELECT COUNT(DISTINCT business_date)::int FROM reward_checkins WHERE plan_id=p.id AND status='accepted') AS days
    FROM reward_plans p WHERE p.id=$1 AND p.user_id=$2 AND p.status='active'`, [planId, userId]);
  const plan = result.rows[0];
  if (!plan) throw new DomainError("PLAN_NOT_FOUND", "Reward not found.", 404);
  if (plan.days < plan.required_days) throw new DomainError("GOAL_INCOMPLETE", "Complete your goal before opening this reward's checkout.", 409);
  if (localDateAt(new Date(), plan.timezone) > plan.deadline) throw new DomainError("GOAL_ENDED", "This reward's deadline has passed.", 409);
  const product = await catalog().getProduct(plan.product_id);
  const offer = product?.offers.find(item => item.sourceMerchantDomain === plan.merchant);
  if (!offer || offer.availability === "out_of_stock") throw new DomainError("OFFER_CHANGED", "The saved retailer offer is unavailable. Check the retailer directly before buying.", 409);
  if (offer.observedPriceMinor > plan.budget_minor) throw new DomainError("OVER_BUDGET", "The current item price exceeds your budget. Checkout remains locked.", 409);
  const check = plan.retailer_check;
  if (check && Date.now() - Date.parse(check.checkedAt) < 15 * 60_000 &&
      (check.availability === "out_of_stock" || (check.priceMinor !== null && check.priceMinor > plan.budget_minor))) {
    throw new DomainError("RETAILER_OFFER_CHANGED", "The recent retailer check found an unavailable or over-budget item.", 409);
  }
  await pool.query("UPDATE reward_plans SET checkout_opened_at=now() WHERE id=$1 AND user_id=$2", [planId, userId]);
  return { url: offer.sourceUrl, merchant: plan.merchant, priceMinor: offer.observedPriceMinor,
    message: "Complete checkout at the retailer. Confirm the variant, tax, shipping, and final total. RewardLoop has not placed an order or charged you." };
}

export async function archiveReward(userId: string, raw: unknown) {
  const { planId } = idSchema.parse(raw);
  const result = await getPool().query("UPDATE reward_plans SET status='archived' WHERE id=$1 AND user_id=$2 RETURNING id", [planId, userId]);
  if (!result.rowCount) throw new DomainError("PLAN_NOT_FOUND", "Reward not found.", 404);
  return { archived: true };
}

export function workspaceError(error: unknown): Response {
  if (error instanceof Channel3Error) return Response.json({ message: "The product catalog is temporarily unavailable. Please try again." }, { status: 502 });
  if (error instanceof z.ZodError) return Response.json({ message: "Please check the form fields and try again.", fields: error.issues.map(i => i.path.join(".")) }, { status: 400 });
  if (error instanceof DomainError) return Response.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  console.error("Workspace request failed", error instanceof Error ? error.name : "Unknown");
  return Response.json({ message: "We could not complete that action. Please try again." }, { status: 500 });
}

/** A short, secret-free reason for a failed hosted review: the HTTP status Google returned, or which local step failed. */
export function reviewFailureCause(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const http = /HTTP (\d{3}) \(([A-Z_]+)\)/.exec(message);
  if (http) return `Google returned HTTP ${http[1]} ${http[2]}`;
  if (/gcloud|print-access-token|ENOENT|explicit local development account/i.test(message)) return "the local Google Cloud sign-in did not return a token";
  if (/timeout|aborted/i.test(message)) return "the request timed out";
  if (/not configured/i.test(message)) return "Google Cloud is not configured";
  return "unexpected reviewer error";
}
