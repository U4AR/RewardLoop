import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "../db/client";
import { pgDate } from "../db/date";
import { getConfig } from "../config";
import { localDateAt } from "../domain/clock";
import { evaluatePurchaseGate } from "../domain/purchase-gate";
import { reviewEvidence } from "../integrations/evidence-review";
import { commitPayPal, capturePayPal, reconcilePayPal } from "./paypal-jobs";
import { prepareKernelCart } from "../server/kernel-cart";
import { KernelCartError } from "../integrations/kernel-cart";

type Job = { id: string; kind: string; payload: Record<string, unknown>; attempts: number };

async function claimJob(): Promise<Job | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id,kind,payload,attempts FROM outbox_jobs
       WHERE ((status = 'PENDING' AND available_at <= now()) OR (status = 'RUNNING' AND locked_until < now()))
       ORDER BY available_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!result.rows[0]) { await client.query("COMMIT"); return null; }
    const job = result.rows[0] as Job;
    await client.query(
      `UPDATE outbox_jobs SET status = 'RUNNING', attempts = attempts + 1,
       locked_until = now() + CASE WHEN kind = 'prepare_kernel_cart' THEN interval '8 minutes' ELSE interval '2 minutes' END
       WHERE id = $1`, [job.id],
    );
    await client.query("COMMIT");
    return job;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function completeJob(id: string) {
  await getPool().query("UPDATE outbox_jobs SET status = 'DONE', locked_until = NULL WHERE id = $1", [id]);
}

async function failJob(job: Job, error: unknown) {
  const attempts = job.attempts + 1;
  const message = error instanceof Error ? error.message : "Unknown error";
  const retry = job.kind === "prepare_kernel_cart"
    ? error instanceof KernelCartError && error.code === "KERNEL_PROVIDER_UNAVAILABLE" && attempts < 2
    : attempts < 3;
  await getPool().query(
    `UPDATE outbox_jobs SET status = $2, locked_until = NULL,
     available_at = CASE WHEN $3 THEN now() + ($4::int * interval '10 seconds') ELSE available_at END,
     last_error = $5 WHERE id = $1`,
    [job.id, retry ? "PENDING" : "FAILED", retry, attempts, message.slice(0, 300)],
  );
  console.error(`Job ${job.kind} failed: ${message}`);
}

export async function runOneJob(): Promise<boolean> {
  const job = await claimJob();
  if (!job) return false;
  try {
    if (job.kind === "review_evidence") await processReview(String(job.payload.evidenceId), String(job.payload.userId));
    else if (job.kind === "evaluate_goal") await processEvaluate(String(job.payload.goalId), String(job.payload.userId));
    else if (job.kind === "execute_purchase") await processPurchase(String(job.payload.intentId), String(job.payload.userId));
    else if (job.kind === "commit_paypal") await commitPayPal(String(job.payload.operationId), String(job.payload.userId));
    else if (job.kind === "capture_paypal") await capturePayPal(String(job.payload.operationId), String(job.payload.userId));
    else if (job.kind === "reconcile_paypal") await reconcilePayPal(String(job.payload.operationId), String(job.payload.userId));
    else if (job.kind === "prepare_kernel_cart") await prepareKernelCart(String(job.payload.intentId), String(job.payload.userId));
    else throw new Error(`Unknown job kind: ${job.kind}`);
    await completeJob(job.id);
  } catch (error) { await failJob(job, error); }
  return true;
}

async function processReview(evidenceId: string, userId: string) {
  const record = await getPool().query(
    `SELECT e.*,g.rubric,g.goal_version AS current_goal_version,g.rubric_version AS current_rubric_version,g.status AS goal_status
     FROM evidence_submissions e JOIN goals g ON g.id = e.goal_id
     WHERE e.id = $1 AND e.user_id = $2 AND g.user_id = $2`, [evidenceId, userId],
  );
  const evidence = record.rows[0];
  if (!evidence || evidence.status !== "PENDING") return;
  if (evidence.goal_version !== evidence.current_goal_version || evidence.rubric_version !== evidence.current_rubric_version || evidence.goal_status !== "ACTIVE") {
    await getPool().query("UPDATE evidence_submissions SET status = 'STALE', reviewed_at = now() WHERE id = $1 AND status = 'PENDING'", [evidenceId]);
    return;
  }
  let review;
  try { review = await reviewEvidence({ rubric: evidence.rubric, notes: evidence.notes }); }
  catch (error) {
    review = { decision: "needs_review" as const, observations: [], missingRequirements: ["Review provider was unavailable"], reason: "Review could not be completed.", confidence: 0, provider: "unavailable" as const, model: "none" };
    console.error("Evidence review provider failed", error instanceof Error ? error.message : "unknown");
  }
  const status = review.decision === "accepted" ? "ACCEPTED" : review.decision === "rejected" ? "REJECTED" : "NEEDS_REVIEW";
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT goal_version,rubric_version,status FROM goals WHERE id = $1 AND user_id = $2 FOR UPDATE", [evidence.goal_id, userId]);
    const goal = current.rows[0];
    if (!goal || goal.status !== "ACTIVE" || goal.goal_version !== evidence.goal_version || goal.rubric_version !== evidence.rubric_version) {
      await client.query("UPDATE evidence_submissions SET status = 'STALE', reviewed_at = now() WHERE id = $1 AND status = 'PENDING'", [evidenceId]);
      await client.query("COMMIT");
      return;
    }
    const updated = await client.query(
      `UPDATE evidence_submissions SET status = $2, review_provider = $3, review_model = $4, review_result = $5, reviewed_at = now()
       WHERE id = $1 AND status = 'PENDING' RETURNING id`,
      [evidenceId, status, review.provider, review.model, JSON.stringify({ decision: review.decision, observations: review.observations, missingRequirements: review.missingRequirements, reason: review.reason, confidence: review.confidence })],
    );
    if (updated.rowCount && status === "ACCEPTED") {
      await client.query(
        `INSERT INTO daily_qualifications (goal_id,goal_version,rubric_version,local_date,evidence_id)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (goal_id,goal_version,rubric_version,local_date) DO NOTHING`,
        [evidence.goal_id, evidence.goal_version, evidence.rubric_version, evidence.business_date, evidenceId],
      );
      await client.query(
        "INSERT INTO outbox_jobs (kind,dedupe_key,payload) VALUES ('evaluate_goal',$1,$2) ON CONFLICT (dedupe_key) DO NOTHING",
        [`evaluate:${evidence.goal_id}:${evidence.goal_version}:${evidenceId}`, JSON.stringify({ goalId: evidence.goal_id, userId })],
      );
    }
    await client.query("INSERT INTO audit_events (user_id,actor,type,details) VALUES ($1,'worker','EVIDENCE_REVIEWED',$2)", [userId, JSON.stringify({ evidenceId, status, provider: review.provider })]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function processEvaluate(goalId: string, userId: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const g = await client.query("SELECT * FROM goals WHERE id = $1 AND user_id = $2 FOR UPDATE", [goalId, userId]);
    const goal = g.rows[0];
    if (!goal || goal.status !== "ACTIVE") { await client.query("COMMIT"); return; }
    const p = await client.query("SELECT * FROM purchase_permissions WHERE goal_id = $1 AND user_id = $2 AND status = 'ACTIVE' ORDER BY permission_version DESC LIMIT 1", [goalId, userId]);
    const permission = p.rows[0];
    if (!permission || permission.goal_version !== goal.goal_version || permission.rubric_version !== goal.rubric_version) { await client.query("COMMIT"); return; }
    const i = await client.query("SELECT * FROM purchase_intents WHERE goal_id = $1 AND permission_id = $2 FOR UPDATE", [goalId, permission.id]);
    const intent = i.rows[0];
    if (!intent || !["ARMED", "QUALIFIED_WAITING_WINDOW"].includes(intent.state)) { await client.query("COMMIT"); return; }
    const count = await client.query(
      `SELECT COUNT(*)::int AS n FROM daily_qualifications dq
       JOIN evidence_submissions e ON e.id = dq.evidence_id
       WHERE dq.goal_id = $1 AND dq.goal_version = $2 AND dq.rubric_version = $3
         AND dq.local_date >= $4 AND dq.local_date < $5
         AND ($6::text IS NULL OR (e.review_provider = $6 AND e.status = 'ACCEPTED'))`,
      [goalId, goal.goal_version, goal.rubric_version, goal.start_date, goal.end_date_exclusive,
        permission.execution_mode === "fixture" ? null : "anthropic"],
    );
    if (count.rows[0].n < goal.required_days) { await client.query("COMMIT"); return; }
    const today = localDateAt(new Date(), goal.timezone);
    const earliest = pgDate(permission.earliest_date), latest = pgDate(permission.latest_date);
    const state = today < earliest ? "QUALIFIED_WAITING_WINDOW" : today >= latest ? "EXPIRED" :
      permission.execution_mode === "paypal_sandbox_fresh" ? "BUYER_APPROVAL_REQUIRED" : "QUEUED";
    await client.query("UPDATE purchase_intents SET state = $2, updated_at = now(), reason = NULL WHERE id = $1", [intent.id, state]);
    if (state === "QUEUED") {
      await client.query("INSERT INTO outbox_jobs (kind,dedupe_key,payload) VALUES ('execute_purchase',$1,$2) ON CONFLICT (dedupe_key) DO NOTHING", [`purchase:${intent.id}`, JSON.stringify({ intentId: intent.id, userId })]);
    }
    await client.query("INSERT INTO audit_events (user_id,actor,type,details) VALUES ($1,'worker','GOAL_EVALUATED',$2)", [userId, JSON.stringify({ goalId, count: count.rows[0].n, state })]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function processPurchase(intentId: string, userId: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const i = await client.query("SELECT * FROM purchase_intents WHERE id = $1 AND user_id = $2 FOR UPDATE", [intentId, userId]);
    const intent = i.rows[0];
    if (!intent || intent.state !== "QUEUED") { await client.query("COMMIT"); return; }
    const g = await client.query("SELECT * FROM goals WHERE id = $1 AND user_id = $2 FOR UPDATE", [intent.goal_id, userId]);
    const p = await client.query("SELECT * FROM purchase_permissions WHERE id = $1 AND user_id = $2 FOR UPDATE", [intent.permission_id, userId]);
    const goal = g.rows[0], permission = p.rows[0];
    if (!goal || !permission) throw new Error("Intent ownership invariant failed");
    if (permission.execution_mode === "paypal_sandbox_fresh") {
      await client.query("UPDATE purchase_intents SET state = 'BUYER_APPROVAL_REQUIRED', updated_at = now() WHERE id = $1 AND state = 'QUEUED'", [intentId]);
      await client.query("COMMIT");
      return;
    }
    if (!intent.store_session_id) {
      const browserJob = await client.query(
        "SELECT id FROM outbox_jobs WHERE dedupe_key = $1 AND status IN ('PENDING','RUNNING') LIMIT 1",
        [`kernel-cart:${intentId}`],
      );
      if (browserJob.rowCount) {
        await client.query("UPDATE purchase_intents SET state = 'NEEDS_USER', reason = 'Kernel is preparing the synthetic cart', updated_at = now() WHERE id = $1", [intentId]);
        await client.query("COMMIT");
        return;
      }
    }
    const allowedSkus = [permission.primary_sku, ...(permission.alternative_skus as string[])];
    const storeCart = intent.store_session_id ? await client.query(
      `SELECT s.id AS store_session_id,c.sku,c.destination_id
       FROM mock_store_sessions s JOIN mock_store_carts c ON c.session_id = s.id
       WHERE s.id = $1 AND s.owner_user_id = $2
         AND s.session_token_hash IS NOT NULL AND s.session_expires_at > now()
       FOR SHARE OF s,c`, [intent.store_session_id, userId],
    ) : { rows: [] };
    if ((permission.execution_mode === "paypal_sandbox" || intent.store_session_id) && !storeCart.rows[0]?.sku) {
      await client.query("UPDATE purchase_intents SET state = 'NEEDS_USER', reason = 'Prepare the synthetic store cart before Sandbox payment', updated_at = now() WHERE id = $1", [intentId]);
      await client.query("COMMIT"); return;
    }
    const products = await client.query("SELECT * FROM demo_products WHERE sku = ANY($1::text[]) FOR UPDATE", [allowedSkus]);
    const chosen = intent.store_session_id
      ? products.rows.find((row) => row.sku === storeCart.rows[0].sku && row.available)
      : allowedSkus.map((sku: string) => products.rows.find((row) => row.sku === sku)).find((row: Record<string, unknown> | undefined) => row?.available);
    if (!chosen) {
      await client.query("UPDATE purchase_intents SET state = 'NEEDS_USER', reason = 'No approved item is available', updated_at = now() WHERE id = $1", [intentId]);
      await client.query("COMMIT"); return;
    }
    const totalMinor = chosen.price_minor + chosen.shipping_minor + chosen.tax_minor;
    const quote = await client.query(
      `INSERT INTO mock_quotes (intent_id,sku,variant,seller,quantity,item_minor,shipping_minor,tax_minor,total_minor,inventory_version,destination_id,expires_at)
       VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,now() + interval '5 minutes') RETURNING *`,
      [intentId, chosen.sku, chosen.variant, chosen.seller, chosen.price_minor, chosen.shipping_minor, chosen.tax_minor, totalMinor, chosen.inventory_version, intent.store_session_id ? storeCart.rows[0].destination_id : permission.synthetic_destination_id],
    );
    const lease = await client.query("UPDATE purchase_intents SET state = 'READY_TO_COMMIT', selected_sku = $2, quote_id = $3, lease_owner = 'worker', lease_fence = lease_fence + 1, lease_until = now() + interval '2 minutes', updated_at = now() WHERE id = $1 RETURNING lease_fence,lease_until", [intentId, chosen.sku, quote.rows[0].id]);
    const count = await client.query(
      `SELECT COUNT(*)::int AS n FROM daily_qualifications dq
       JOIN evidence_submissions e ON e.id = dq.evidence_id
       WHERE dq.goal_id = $1 AND dq.goal_version = $2 AND dq.rubric_version = $3
         AND dq.local_date >= $4 AND dq.local_date < $5
         AND ($6::text IS NULL OR (e.review_provider = $6 AND e.status = 'ACCEPTED'))`,
      [goal.id, goal.goal_version, goal.rubric_version, goal.start_date, goal.end_date_exclusive,
        permission.execution_mode === "fixture" ? null : "anthropic"],
    );
    const connection = permission.payment_connection_id ? await client.query("SELECT status,environment FROM payment_connections WHERE id = $1 AND user_id = $2", [permission.payment_connection_id, userId]) : { rows: [] };
    const businessDate = localDateAt(new Date(), goal.timezone);
    const gate = evaluatePurchaseGate({
      runtime: "hackathon", paymentHost: getConfig().PAYPAL_API_BASE_URL, actorUserId: userId, intentUserId: intent.user_id,
      goal: { version: goal.goal_version, rubricVersion: goal.rubric_version, qualified: count.rows[0].n >= goal.required_days, status: goal.status },
      permission: {
        userId: permission.user_id, goalVersion: permission.goal_version, rubricVersion: permission.rubric_version,
        status: permission.status, primarySku: permission.primary_sku, alternativeSkus: permission.alternative_skus,
        approvedVariants: permission.approved_variants, seller: permission.seller, quantity: permission.quantity,
        currency: permission.currency, destinationId: permission.synthetic_destination_id, totalCapMinor: permission.total_cap_minor,
        earliestDate: pgDate(permission.earliest_date), latestDate: pgDate(permission.latest_date),
        unattendedSandboxApproved: permission.unattended_sandbox_approved, executionMode: permission.execution_mode,
      },
      intent: { state: "READY_TO_COMMIT", captureId: intent.capture_id, leaseValid: lease.rows[0]?.lease_until > new Date() },
      quote: { sku: chosen.sku, variant: chosen.variant, seller: chosen.seller, quantity: 1, currency: "USD", destinationId: quote.rows[0].destination_id, totalMinor, fresh: quote.rows[0].expires_at > new Date(), inventoryVersionMatches: quote.rows[0].inventory_version === chosen.inventory_version, extraItems: false },
      businessDate,
      paymentConnectionReady: connection.rows[0]?.status === "ACTIVE" && connection.rows[0]?.environment === "sandbox",
      fixtureModeAllowed: getConfig().ALLOW_FIXTURE_PROVIDERS === "true",
    });
    if (!gate.allowed) {
      await client.query("UPDATE purchase_intents SET state = 'NEEDS_USER', reason = $2, updated_at = now() WHERE id = $1", [intentId, gate.code]);
      await client.query("COMMIT"); return;
    }
    const frozen = { intentId, quoteId: quote.rows[0].id, sku: chosen.sku, variant: chosen.variant, seller: chosen.seller, totalMinor, currency: "USD", permissionHash: permission.payload_hash, leaseFence: lease.rows[0].lease_fence,
      ...(intent.store_session_id ? { storeSessionId: storeCart.rows[0].store_session_id } : {}) };
    const hash = createHash("sha256").update(JSON.stringify(frozen)).digest("hex");
    const op = await client.query(
      `INSERT INTO payment_operations (intent_id,kind,provider,payload_hash,payload)
       VALUES ($1,'create_order',$2,$3,$4) RETURNING *`,
      [intentId, permission.execution_mode, hash, JSON.stringify(frozen)],
    );
    await client.query("UPDATE mock_quotes SET status = 'RESERVED' WHERE id = $1", [quote.rows[0].id]);
    await client.query("UPDATE purchase_intents SET state = 'COMMITTING', updated_at = now() WHERE id = $1", [intentId]);
    if (permission.execution_mode === "fixture") {
      await confirmFixture(client, { intentId, userId, quote: quote.rows[0], operationId: op.rows[0].id });
    } else {
      await client.query("INSERT INTO outbox_jobs (kind,dedupe_key,payload) VALUES ('commit_paypal',$1,$2) ON CONFLICT (dedupe_key) DO NOTHING", [`paypal:${op.rows[0].id}`, JSON.stringify({ operationId: op.rows[0].id, userId })]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function confirmFixture(client: PoolClient, input: { intentId: string; userId: string; quote: Record<string, unknown>; operationId: string }) {
  await client.query(
    `INSERT INTO mock_store_orders (intent_id,quote_id,sku,variant,seller,quantity,total_minor,provider,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'fixture','SIMULATED') ON CONFLICT (intent_id) DO NOTHING`,
    [input.intentId, input.quote.id, input.quote.sku, input.quote.variant, input.quote.seller, input.quote.quantity, input.quote.total_minor],
  );
  await client.query("UPDATE payment_operations SET state = 'FIXTURE_COMPLETED', updated_at = now() WHERE id = $1", [input.operationId]);
  await client.query("UPDATE purchase_intents SET state = 'CONFIRMED', receipt_provider = 'fixture', updated_at = now() WHERE id = $1 AND state = 'COMMITTING'", [input.intentId]);
  await client.query("INSERT INTO audit_events (user_id,actor,type,details) VALUES ($1,'worker','FIXTURE_RECEIPT_CREATED',$2)", [input.userId, JSON.stringify({ intentId: input.intentId, quoteId: input.quote.id })]);
}

export async function sweepDueGoals() {
  const rows = await getPool().query(
    `SELECT i.id AS intent_id,i.user_id,g.id AS goal_id,g.timezone,p.earliest_date,p.latest_date
     FROM purchase_intents i JOIN goals g ON g.id = i.goal_id JOIN purchase_permissions p ON p.id = i.permission_id
     WHERE i.state = 'QUALIFIED_WAITING_WINDOW' AND p.status = 'ACTIVE' LIMIT 100`,
  );
  for (const row of rows.rows) {
    const today = localDateAt(new Date(), row.timezone);
    const earliest = pgDate(row.earliest_date);
    if (today >= earliest) await processEvaluate(row.goal_id, row.user_id);
  }
}
