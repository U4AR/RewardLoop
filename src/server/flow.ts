import { createHash } from "node:crypto";
import { z } from "zod";
import { getPool } from "../db/client";
import { pgDate } from "../db/date";
import { assertDateRange, assertIanaTimezone, dateWithin, localDateAt } from "../domain/clock";
import { getConfig, providerMode } from "../config";

export const goalInput = z.object({
  title: z.string().trim().min(4).max(120),
  rubric: z.string().trim().min(15).max(1000),
  timezone: z.string().min(3).max(80),
  startDate: z.iso.date(),
  endDateExclusive: z.iso.date(),
  requiredDays: z.number().int().min(1).max(100),
});

export const permissionInput = z.object({
  goalId: z.uuid(),
  primarySku: z.string().min(1),
  alternativeSkus: z.array(z.string().min(1)).max(3).default([]),
  totalCapMinor: z.number().int().min(1).max(1_000_000),
  earliestDate: z.iso.date(),
  latestDate: z.iso.date(),
});

export const revokePermissionInput = z.object({ permissionId: z.uuid() });

export const evidenceInput = z.object({
  goalId: z.uuid(),
  notes: z.string().trim().min(20).max(5000),
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class DomainError extends Error {
  constructor(public code: string, message: string, public httpStatus = 400) { super(message); }
}

export async function createGoal(userId: string, raw: unknown) {
  const input = goalInput.parse(raw);
  assertIanaTimezone(input.timezone);
  assertDateRange(input.startDate, input.endDateExclusive, input.requiredDays);
  const today = localDateAt(new Date(), input.timezone);
  if (input.startDate > today || input.endDateExclusive <= today) {
    throw new DomainError("INVALID_GOAL_PERIOD", "The goal period must include today for this initial demo");
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT id FROM goals WHERE user_id = $1 AND status = 'ACTIVE' LIMIT 1 FOR UPDATE", [userId]);
    if (existing.rowCount) throw new DomainError("ACTIVE_GOAL_EXISTS", "Finish or pause the current goal before starting another", 409);
    const result = await client.query(
      `INSERT INTO goals (user_id,title,rubric,timezone,start_date,end_date_exclusive,required_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,title,rubric,timezone,start_date,end_date_exclusive,required_days,status,cycle_id`,
      [userId, input.title, input.rubric, input.timezone, input.startDate, input.endDateExclusive, input.requiredDays],
    );
    await client.query("INSERT INTO audit_events (user_id,actor,type,details) VALUES ($1,$1,'GOAL_CREATED',$2)", [userId, JSON.stringify({ goalId: result.rows[0].id })]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new DomainError("ACTIVE_GOAL_EXISTS", "Finish or pause the current goal before starting another", 409);
    }
    throw error;
  }
  finally { client.release(); }
}

export async function createPermission(userId: string, raw: unknown) {
  const input = permissionInput.parse(raw);
  if (input.latestDate <= input.earliestDate) throw new DomainError("INVALID_WINDOW", "Purchase-before date must follow the window start");
  if (new Set([input.primarySku, ...input.alternativeSkus]).size !== 1 + input.alternativeSkus.length) {
    throw new DomainError("DUPLICATE_REWARD", "Each approved item must be distinct");
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const goalResult = await client.query("SELECT * FROM goals WHERE id = $1 AND user_id = $2 FOR UPDATE", [input.goalId, userId]);
    const goal = goalResult.rows[0];
    if (!goal || goal.status !== "ACTIVE") throw new DomainError("GOAL_NOT_FOUND", "Active goal not found", 404);
    const existing = await client.query("SELECT id FROM purchase_permissions WHERE goal_id = $1 LIMIT 1", [goal.id]);
    // A goal has one purchase intent per cycle. Revocation closes that intent;
    // approving a replacement on the same cycle would violate its unique key.
    if (existing.rowCount) throw new DomainError("PERMISSION_EXISTS", "This goal already had a purchase permission. Start a new goal cycle for another approval.", 409);
    const skuList = [input.primarySku, ...input.alternativeSkus];
    const products = await client.query("SELECT * FROM demo_products WHERE sku = ANY($1::text[])", [skuList]);
    if (products.rowCount !== skuList.length) throw new DomainError("UNKNOWN_REWARD", "Choose an available demo reward");
    const primary = products.rows.find((row) => row.sku === input.primarySku);
    if (!primary || !products.rows.every((row) => row.seller === primary.seller)) throw new DomainError("SELLER_MISMATCH", "All approved alternatives must use the same synthetic seller");
    const config = getConfig();
    const sandboxReady = Boolean(config.PAYPAL_SANDBOX_CLIENT_ID && config.PAYPAL_SANDBOX_CLIENT_SECRET && config.PAYPAL_SANDBOX_MERCHANT_ID);
    // A connected Vault token alone does not prove unattended merchant capability.
    // Until a capability probe is persisted, every Sandbox permission needs
    // a fresh buyer approval at checkout.
    const executionMode = sandboxReady ? "paypal_sandbox_fresh" : "fixture";
    if (executionMode === "fixture" && config.ALLOW_FIXTURE_PROVIDERS !== "true") {
      throw new DomainError("PAYPAL_SANDBOX_REQUIRED", "Configure a PayPal Sandbox merchant before approving this purchase", 409);
    }
    const snapshot = {
      goalId: goal.id, goalVersion: goal.goal_version, rubricVersion: goal.rubric_version,
      primarySku: input.primarySku, alternativeSkus: input.alternativeSkus, totalCapMinor: input.totalCapMinor,
      approvedVariants: Object.fromEntries(products.rows.map((row) => [row.sku, row.variant])),
      earliestDate: input.earliestDate, latestDate: input.latestDate, seller: primary.seller,
      quantity: 1, currency: "USD", syntheticDestinationId: "demo-us-address",
      paymentConnectionId: null,
      executionMode,
    };
    const hash = sha256(JSON.stringify(snapshot));
    const permission = await client.query(
      `INSERT INTO purchase_permissions
       (user_id,goal_id,goal_version,rubric_version,primary_sku,alternative_skus,approved_variants,seller,total_cap_minor,
        earliest_date,latest_date,payment_connection_id,unattended_sandbox_approved,execution_mode,payload_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [userId, goal.id, goal.goal_version, goal.rubric_version, input.primarySku, JSON.stringify(input.alternativeSkus), JSON.stringify(snapshot.approvedVariants),
        primary.seller, input.totalCapMinor, input.earliestDate, input.latestDate, snapshot.paymentConnectionId,
        false, executionMode, hash],
    );
    const intent = await client.query(
      "INSERT INTO purchase_intents (user_id,goal_id,cycle_id,permission_id) VALUES ($1,$2,$3,$4) RETURNING *",
      [userId, goal.id, goal.cycle_id, permission.rows[0].id],
    );
    await client.query(
      "INSERT INTO outbox_jobs (kind,dedupe_key,payload) VALUES ('evaluate_goal',$1,$2) ON CONFLICT (dedupe_key) DO NOTHING",
      [`evaluate:${goal.id}:${goal.goal_version}:permission`, JSON.stringify({ goalId: goal.id, userId })],
    );
    await client.query("INSERT INTO audit_events (user_id,actor,type,details) VALUES ($1,$1,'PERMISSION_APPROVED',$2)", [userId, JSON.stringify({ permissionId: permission.rows[0].id, payloadHash: hash })]);
    await client.query("COMMIT");
    return { permission: permission.rows[0], purchase: intent.rows[0] };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function revokePermission(userId: string, raw: unknown) {
  const { permissionId } = revokePermissionInput.parse(raw);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // The PayPal worker takes a share lock on this exact row before claiming a
    // financial operation. Once this update commits, no new claim can pass.
    const changed = await client.query(
      `UPDATE purchase_permissions SET status = 'REVOKED', revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE'
       RETURNING id, status`,
      [permissionId, userId],
    );
    if (!changed.rowCount) {
      const existing = await client.query("SELECT status FROM purchase_permissions WHERE id = $1 AND user_id = $2", [permissionId, userId]);
      if (!existing.rowCount) throw new DomainError("PERMISSION_NOT_FOUND", "Purchase permission not found", 404);
      if (existing.rows[0].status !== "REVOKED") throw new DomainError("PERMISSION_NOT_ACTIVE", "This permission is not active", 409);
    } else {
      await client.query(
        "INSERT INTO audit_events (user_id,actor,type,details) VALUES ($1,$1,'PERMISSION_REVOKED',$2)",
        [userId, JSON.stringify({ permissionId })],
      );
    }
    await client.query("COMMIT");
    return { permissionId, status: "REVOKED" as const };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function submitEvidence(userId: string, raw: unknown) {
  const input = evidenceInput.parse(raw);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM goals WHERE id = $1 AND user_id = $2 FOR UPDATE", [input.goalId, userId]);
    const goal = result.rows[0];
    if (!goal || goal.status !== "ACTIVE") throw new DomainError("GOAL_NOT_FOUND", "Active goal not found", 404);
    const businessDate = localDateAt(new Date(), goal.timezone);
    const start = pgDate(goal.start_date);
    const end = pgDate(goal.end_date_exclusive);
    if (!dateWithin(businessDate, start, end)) throw new DomainError("OUTSIDE_GOAL_PERIOD", "Today is outside the goal period");
    const normalized = input.notes.normalize("NFKC").replace(/\s+/g, " ").trim();
    const hash = sha256(normalized.toLowerCase());
    const duplicate = await client.query("SELECT id FROM evidence_submissions WHERE goal_id = $1 AND content_hash = $2", [goal.id, hash]);
    if (duplicate.rowCount) throw new DomainError("DUPLICATE_EVIDENCE", "This proof was already submitted", 409);
    const inserted = await client.query(
      `INSERT INTO evidence_submissions (user_id,goal_id,goal_version,rubric_version,business_date,notes,content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,business_date,status,created_at`,
      [userId, goal.id, goal.goal_version, goal.rubric_version, businessDate, normalized, hash],
    );
    await client.query(
      "INSERT INTO outbox_jobs (kind,dedupe_key,payload) VALUES ('review_evidence',$1,$2)",
      [`review:${inserted.rows[0].id}`, JSON.stringify({ evidenceId: inserted.rows[0].id, userId })],
    );
    await client.query("INSERT INTO audit_events (user_id,actor,type,details) VALUES ($1,$1,'EVIDENCE_SUBMITTED',$2)", [userId, JSON.stringify({ evidenceId: inserted.rows[0].id })]);
    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function getState(userId: string) {
  const pool = getPool();
  const products = await pool.query("SELECT sku,title,variant,seller,price_minor,shipping_minor,tax_minor,available,source FROM demo_products ORDER BY sku");
  const goal = await pool.query("SELECT * FROM goals WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1", [userId]);
  if (!goal.rows[0]) return { products: mapProducts(products.rows), goal: null, permission: null, evidence: [], purchase: null, providerMode: providerMode(getConfig()) };
  const goalId = goal.rows[0].id;
  const [permission, submissions, intent] = await Promise.all([
    pool.query("SELECT * FROM purchase_permissions WHERE goal_id = $1 ORDER BY permission_version DESC LIMIT 1", [goalId]),
    pool.query("SELECT id,business_date,status,review_provider,review_model,review_result,created_at FROM evidence_submissions WHERE goal_id = $1 AND user_id = $2 ORDER BY created_at DESC", [goalId, userId]),
    pool.query("SELECT * FROM purchase_intents WHERE goal_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1", [goalId, userId]),
  ]);
  const g = goal.rows[0], p = permission.rows[0], i = intent.rows[0];
  const requiredProvider = p && p.execution_mode !== "fixture" ? "anthropic" : null;
  const progress = await pool.query(
    `SELECT COUNT(*)::int AS count FROM daily_qualifications dq
     JOIN evidence_submissions e ON e.id = dq.evidence_id
     WHERE dq.goal_id = $1 AND dq.goal_version = $2 AND dq.rubric_version = $3
       AND dq.local_date >= $4 AND dq.local_date < $5
       AND ($6::text IS NULL OR (e.review_provider = $6 AND e.status = 'ACCEPTED'))`,
    [goalId, g.goal_version, g.rubric_version, g.start_date, g.end_date_exclusive, requiredProvider],
  );
  const storeOrder = i ? await pool.query("SELECT id,total_minor,provider,status FROM mock_store_orders WHERE intent_id = $1", [i.id]) : { rows: [] };
  const kernelProof = i?.store_session_id ? await pool.query(
    `SELECT a.id FROM audit_events a JOIN mock_store_carts c ON c.session_id = $3::uuid
     WHERE a.user_id = $1 AND a.type = 'KERNEL_CART_VERIFIED'
       AND a.details->>'intentId' = $2 AND a.details->>'storeSessionId' = $3
       AND a.details->>'sku' = c.sku LIMIT 1`,
    [userId, i.id, i.store_session_id],
  ) : { rows: [] };
  return {
    products: mapProducts(products.rows),
    goal: { id: g.id, title: g.title, rubric: g.rubric, timezone: g.timezone, startDate: pgDate(g.start_date), endDateExclusive: pgDate(g.end_date_exclusive), requiredDays: g.required_days, acceptedDays: progress.rows[0].count, status: g.status },
    permission: p ? { id: p.id, primarySku: p.primary_sku, alternativeSkus: p.alternative_skus, totalCapMinor: p.total_cap_minor, earliestDate: pgDate(p.earliest_date), latestDate: pgDate(p.latest_date), status: p.status, executionMode: p.execution_mode } : null,
    evidence: submissions.rows.map((row) => ({ id: row.id, businessDate: pgDate(row.business_date), status: row.status, reviewProvider: row.review_provider, reviewModel: row.review_model, reviewResult: row.review_result, createdAt: row.created_at })),
    purchase: i ? { id: i.id, status: i.state, state: i.state, selectedSku: i.selected_sku, storeOrderId: storeOrder.rows[0]?.id ?? null, totalMinor: storeOrder.rows[0]?.total_minor ?? null, orderId: i.order_id, captureId: i.capture_id, receiptProvider: i.receipt_provider, reason: i.reason,
      browserProvider: kernelProof.rows[0] ? "Kernel (two sessions verified)" : i.store_session_id ? "Direct controlled store" : "Not prepared" } : null,
    providerMode: providerMode(getConfig()),
  };
}

function mapProducts(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({ sku: row.sku, title: row.title, variant: row.variant, seller: row.seller, priceMinor: row.price_minor, shippingMinor: row.shipping_minor, taxMinor: row.tax_minor, available: row.available, source: row.source }));
}
