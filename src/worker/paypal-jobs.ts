import { getPool } from "../db/client";
import { createHash } from "node:crypto";
import { getConfig } from "../config";
import { pgDate } from "../db/date";
import { localDateAt } from "../domain/clock";
import { PayPalSandboxClient, type SandboxOrderAssessment } from "../integrations/paypal-sandbox";
import { getActiveWalletForUser } from "../server/paypal-wallet";
import type { Pool, PoolClient } from "pg";

const REPLAY_WINDOW_MS = 5 * 60 * 60 * 1000; // Below PayPal Orders' documented 6-hour key retention.

type Operation = {
  id: string; intent_id: string; user_id: string; kind: string; state: string; request_id: string;
  order_id: string | null; capture_id: string | null; created_at: Date;
  payload: { intentId: string; quoteId: string; totalMinor: number; sku: string; variant: string; seller: string; permissionHash: string; currency: string; leaseFence: number; storeSessionId: string; orderId?: string };
  intent_state: string; permission_id: string; payment_connection_id: string | null;
  permission_status: string; current_permission_hash: string; execution_mode: string; provider: string;
};

class FinancialPreflightError extends Error {}

async function loadOperation(operationId: string, userId: string): Promise<Operation | null> {
  const result = await getPool().query(
    `SELECT op.*,i.user_id,i.state AS intent_state,i.permission_id,p.payment_connection_id,
            p.status AS permission_status,p.payload_hash AS current_permission_hash,p.execution_mode
     FROM payment_operations op JOIN purchase_intents i ON i.id = op.intent_id
     JOIN purchase_permissions p ON p.id = i.permission_id
     WHERE op.id = $1 AND i.user_id = $2`, [operationId, userId],
  );
  return result.rows[0] ?? null;
}

function paypalClient() {
  const config = getConfig();
  if (!config.PAYPAL_SANDBOX_CLIENT_ID || !config.PAYPAL_SANDBOX_CLIENT_SECRET || !config.PAYPAL_SANDBOX_MERCHANT_ID) {
    throw new Error("PayPal Sandbox merchant credentials are incomplete");
  }
  return new PayPalSandboxClient({
    clientId: config.PAYPAL_SANDBOX_CLIENT_ID,
    clientSecret: config.PAYPAL_SANDBOX_CLIENT_SECRET,
    apiBaseUrl: config.PAYPAL_API_BASE_URL,
    merchantId: config.PAYPAL_SANDBOX_MERCHANT_ID,
  });
}

async function exactWallet(op: Operation) {
  const wallet = await getActiveWalletForUser(op.user_id);
  return wallet && wallet.connectionId === op.payment_connection_id ? wallet : null;
}

async function enqueueReconcile(operationId: string, userId: string, delaySeconds = 60, db: Pool | PoolClient = getPool()) {
  // Bucket by future minute: duplicate events coalesce, but a finished
  // reconciliation can schedule a later attempt if the outcome is still open.
  const slot = Math.ceil((Date.now() + delaySeconds * 1000) / 60_000);
  await db.query(
    `INSERT INTO outbox_jobs (kind,dedupe_key,payload,available_at)
     VALUES ('reconcile_paypal',$1,$2,to_timestamp($3::double precision)) ON CONFLICT (dedupe_key) DO NOTHING`,
    [`reconcile:${operationId}:${slot}`, JSON.stringify({ operationId, userId }), slot * 60],
  );
}

async function markOutcomeUnknown(op: Operation, reason: string) {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT id FROM purchase_intents WHERE id = $1 FOR UPDATE", [op.intent_id]);
    await db.query("UPDATE payment_operations SET state = 'OUTCOME_UNKNOWN', updated_at = now() WHERE id = $1 AND state NOT IN ('CONFIRMED','NO_PAYMENT')", [op.id]);
    await db.query("UPDATE purchase_intents SET state = 'OUTCOME_UNKNOWN', reason = $2, updated_at = now() WHERE id = $1 AND state <> 'CONFIRMED'", [op.intent_id, reason]);
    await enqueueReconcile(op.id, op.user_id, 60, db);
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

async function markNeedsUser(op: Operation, reason: string) {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT id FROM purchase_intents WHERE id = $1 FOR UPDATE", [op.intent_id]);
    const changed = await db.query("UPDATE payment_operations SET state = 'NO_PAYMENT', updated_at = now() WHERE id = $1 AND state = 'PREPARED' RETURNING id", [op.id]);
    if (changed.rowCount) {
      await db.query("UPDATE purchase_intents SET state = 'NEEDS_USER', reason = $2, updated_at = now() WHERE id = $1 AND state = 'COMMITTING'", [op.intent_id, reason]);
    }
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

async function markStoppedBeforePost(op: Operation, reason: string) {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT id FROM purchase_intents WHERE id = $1 FOR UPDATE", [op.intent_id]);
    const changed = await db.query("UPDATE payment_operations SET state = 'NO_PAYMENT', updated_at = now() WHERE id = $1 AND state = 'SENT' RETURNING id", [op.id]);
    if (changed.rowCount) {
      await db.query("UPDATE purchase_intents SET state = 'NEEDS_USER', reason = $2, updated_at = now() WHERE id = $1 AND state = 'COMMITTING'", [op.intent_id, reason]);
    }
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

/**
 * Revalidate the frozen operation under row locks, then claim it as SENT
 * in the same transaction. Revocation, repricing, and duplicate workers cannot
 * pass between this check and the local commit boundary.
 */
async function claimFinancialOperation(op: Operation, expectedState: "PREPARED" | "OUTCOME_UNKNOWN" | "SENT"): Promise<boolean> {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const context = await db.query(
      `SELECT i.state AS intent_state,i.capture_id,i.order_id AS intent_order_id,
              i.quote_id,i.selected_sku,i.store_session_id,i.lease_owner,i.lease_until,i.lease_fence,
              p.status AS permission_status,p.payload_hash,p.goal_version,p.rubric_version,
              p.earliest_date,p.latest_date,p.unattended_sandbox_approved,p.execution_mode,
              p.payment_connection_id,p.primary_sku,p.alternative_skus,p.approved_variants,
              p.seller AS approved_seller,p.quantity AS approved_quantity,p.currency AS approved_currency,
              p.synthetic_destination_id,p.total_cap_minor,
              g.status AS goal_status,g.goal_version AS current_goal_version,
              g.rubric_version AS current_rubric_version,g.timezone,g.required_days,g.start_date,g.end_date_exclusive,
              q.status AS quote_status,q.expires_at,q.total_minor,q.currency,q.sku,q.variant,q.seller,
              q.quantity,q.destination_id,
              q.inventory_version,d.inventory_version AS current_inventory_version,d.available,
              pc.status AS connection_status,pc.environment,pc.merchant_id,
              s.owner_user_id AS store_owner,s.session_expires_at,s.session_token_hash,
              c.sku AS cart_sku,c.destination_id AS cart_destination_id
       FROM purchase_intents i
       JOIN purchase_permissions p ON p.id = i.permission_id
       JOIN goals g ON g.id = i.goal_id
       JOIN mock_quotes q ON q.id = $3 AND q.intent_id = i.id
       JOIN demo_products d ON d.sku = q.sku
       JOIN mock_store_sessions s ON s.id = i.store_session_id
       JOIN mock_store_carts c ON c.session_id = s.id
       LEFT JOIN payment_connections pc ON pc.id = p.payment_connection_id AND pc.user_id = i.user_id
       WHERE i.id = $1 AND i.user_id = $2
       FOR SHARE OF i,p,g,q,d,s,c`,
      [op.intent_id, op.user_id, op.payload.quoteId],
    );
    const row = context.rows[0];
    const lockedConnection = row?.execution_mode === "paypal_sandbox" ? await db.query(
      `SELECT status,environment,merchant_id FROM payment_connections
       WHERE id = $1 AND user_id = $2 FOR SHARE`,
      [row.payment_connection_id, op.user_id],
    ) : null;
    const config = getConfig();
    const now = new Date();
    const businessDate = row ? localDateAt(now, row.timezone) : "";
    const structuralMatch = Boolean(
      row &&
      op.provider === "paypal_sandbox" &&
      op.payload.intentId === op.intent_id &&
      Number.isSafeInteger(op.payload.totalMinor) && op.payload.totalMinor > 0 &&
      op.payload.currency === "USD" &&
      op.payload.permissionHash === row.payload_hash &&
      op.payload.storeSessionId === row.store_session_id && row.store_owner === op.user_id &&
      !!row.session_token_hash && row.session_expires_at > now &&
      row.cart_sku === row.sku && row.cart_destination_id === row.destination_id &&
      row.quote_id === op.payload.quoteId && row.selected_sku === op.payload.sku &&
      row.payment_connection_id === op.payment_connection_id &&
      op.payload.totalMinor === row.total_minor &&
      op.payload.sku === row.sku && op.payload.variant === row.variant && op.payload.seller === row.seller &&
      row.approved_seller === row.seller && row.approved_quantity === row.quantity && row.quantity === 1 &&
      row.approved_currency === "USD" && row.destination_id === row.synthetic_destination_id &&
      row.total_minor <= row.total_cap_minor &&
      (row.primary_sku === row.sku || (Array.isArray(row.alternative_skus) && row.alternative_skus.includes(row.sku))) &&
      row.approved_variants?.[row.sku] === row.variant &&
      row.currency === "USD" && row.quote_status === "RESERVED" && row.expires_at > now &&
      row.inventory_version === row.current_inventory_version && row.available === true &&
      (expectedState === "PREPARED" ? row.intent_state === "COMMITTING" :
        expectedState === "SENT" ? ["COMMITTING", "OUTCOME_UNKNOWN"].includes(row.intent_state) :
        row.intent_state === "OUTCOME_UNKNOWN") &&
      !row.capture_id && row.lease_owner === "worker" && row.lease_until > now &&
      Number.isSafeInteger(op.payload.leaseFence) && op.payload.leaseFence === row.lease_fence &&
      (["create_order", "create_fresh_order"].includes(op.kind) ? !row.intent_order_id && !op.order_id :
        op.kind === "capture_order" && !!op.order_id && op.order_id === row.intent_order_id && op.payload.orderId === op.order_id) &&
      row.permission_status === "ACTIVE" && row.goal_status === "ACTIVE" &&
      row.goal_version === row.current_goal_version && row.rubric_version === row.current_rubric_version &&
      (row.execution_mode === "paypal_sandbox"
        ? row.unattended_sandbox_approved === true && lockedConnection?.rows[0]?.status === "ACTIVE" &&
          lockedConnection.rows[0].environment === "sandbox" &&
          lockedConnection.rows[0].merchant_id === config.PAYPAL_SANDBOX_MERCHANT_ID
        : row.execution_mode === "paypal_sandbox_fresh" && ["create_fresh_order", "capture_order"].includes(op.kind) &&
          row.payment_connection_id === null && op.payment_connection_id === null &&
          Boolean(config.PAYPAL_SANDBOX_CLIENT_ID && config.PAYPAL_SANDBOX_CLIENT_SECRET && config.PAYPAL_SANDBOX_MERCHANT_ID)) &&
      businessDate >= pgDate(row.earliest_date) && businessDate < pgDate(row.latest_date),
    );
    if (!structuralMatch) { await db.query("COMMIT"); return false; }
    const count = await db.query(
      `SELECT COUNT(*)::int AS n FROM daily_qualifications dq
       JOIN evidence_submissions e ON e.id = dq.evidence_id
       WHERE dq.goal_id = (SELECT goal_id FROM purchase_intents WHERE id = $1)
         AND dq.goal_version = $2 AND dq.rubric_version = $3
         AND dq.local_date >= $4 AND dq.local_date < $5
         AND e.review_provider = 'anthropic' AND e.status = 'ACCEPTED'`,
      [op.intent_id, row.goal_version, row.rubric_version, row.start_date, row.end_date_exclusive],
    );
    if ((count.rows[0]?.n ?? 0) < row.required_days) { await db.query("COMMIT"); return false; }
    const changed = await db.query(
      "UPDATE payment_operations SET state = 'SENT', updated_at = now() WHERE id = $1 AND state = $2 RETURNING id",
      [op.id, expectedState],
    );
    await db.query("COMMIT");
    return Boolean(changed.rowCount);
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

/** Fresh checkout calls this after OAuth and immediately before creating its order. */
export async function financialPostStillAllowed(operationId: string, userId: string): Promise<boolean> {
  const op = await loadOperation(operationId, userId);
  return Boolean(op && op.state === "SENT" && await claimFinancialOperation(op, "SENT"));
}

export async function commitPayPal(operationId: string, userId: string) {
  const op = await loadOperation(operationId, userId);
  if (!op || op.kind !== "create_order" || op.intent_state === "CONFIRMED") return;
  if (op.state !== "PREPARED") {
    if (["SENT", "OUTCOME_UNKNOWN", "PAYMENT_PENDING"].includes(op.state)) await enqueueReconcile(op.id, op.user_id);
    return;
  }
  const wallet = await exactWallet(op);
  if (!wallet) { await markNeedsUser(op, "PayPal Sandbox wallet was disconnected before the order was sent"); return; }
  let client: PayPalSandboxClient;
  try { client = paypalClient(); }
  catch { await markNeedsUser(op, "Sandbox merchant payment configuration is unavailable"); return; }
  if (!await claimFinancialOperation(op, "PREPARED")) {
    await markNeedsUser(op, "Sandbox purchase conditions changed before the order was sent");
    return;
  }
  try {
    const result = await client.createOrder({ totalCents: op.payload.totalMinor, vaultId: wallet.vaultId, referenceId: op.intent_id, requestId: op.request_id,
      beforeFinancialPost: async () => { if (!await claimFinancialOperation(op, "SENT")) throw new FinancialPreflightError(); },
    });
    await applyOrderAssessment(op, result);
  } catch (error) {
    if (error instanceof FinancialPreflightError) {
      await markStoppedBeforePost(op, "Sandbox purchase window or quote expired before the order was sent");
      return;
    }
    // Once a mutation may have left this process, even an HTTP error needs a
    // provider read or same-ID reconciliation before claiming no payment.
    void error;
    await markOutcomeUnknown(op, "Sandbox order outcome is being checked");
  }
}

async function applyOrderAssessment(op: Operation, result: SandboxOrderAssessment) {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const current = await db.query("SELECT state,order_id,capture_id FROM purchase_intents WHERE id = $1 FOR UPDATE", [op.intent_id]);
    if (current.rows[0]?.state === "CONFIRMED") { await db.query("COMMIT"); return; }
    const stored = await db.query("SELECT state,order_id,capture_id FROM payment_operations WHERE id = $1 FOR UPDATE", [op.id]);
    if (
      !stored.rows[0] ||
      (stored.rows[0].order_id && stored.rows[0].order_id !== result.orderId) ||
      (current.rows[0]?.order_id && current.rows[0].order_id !== result.orderId) ||
      (stored.rows[0].capture_id && result.captureId && stored.rows[0].capture_id !== result.captureId) ||
      (current.rows[0]?.capture_id && result.captureId && current.rows[0].capture_id !== result.captureId) ||
      (stored.rows[0].capture_id && result.state === "READY_TO_CAPTURE")
    ) {
      await db.query("UPDATE payment_operations SET state = 'OUTCOME_UNKNOWN', updated_at = now() WHERE id = $1", [op.id]);
      await db.query("UPDATE purchase_intents SET state = 'OUTCOME_UNKNOWN', reason = 'Manual investigation required: conflicting Sandbox order or capture association', updated_at = now() WHERE id = $1", [op.intent_id]);
      await db.query("COMMIT");
      return;
    }
    await db.query("UPDATE payment_operations SET order_id = $2, capture_id = $3, state = $4, updated_at = now() WHERE id = $1", [op.id, result.orderId, result.captureId ?? null, result.state]);
    if (result.state === "CONFIRMED" && result.captureId) {
      const receipt = await db.query(
        `INSERT INTO mock_store_orders (intent_id,quote_id,sku,variant,seller,quantity,total_minor,provider,provider_order_id,provider_capture_id,status)
         SELECT q.intent_id,q.id,q.sku,q.variant,q.seller,q.quantity,q.total_minor,'paypal_sandbox',$2,$3,'SIMULATED_PAID'
         FROM mock_quotes q WHERE q.id = $1 AND q.intent_id = $4 AND q.status = 'RESERVED'
           AND q.total_minor = $5 AND q.sku = $6 AND q.variant = $7 AND q.seller = $8
         ON CONFLICT (intent_id) DO NOTHING RETURNING id`,
        [op.payload.quoteId, result.orderId, result.captureId, op.intent_id,
          op.payload.totalMinor, op.payload.sku, op.payload.variant, op.payload.seller],
      );
      if (!receipt.rowCount) {
        await db.query("UPDATE payment_operations SET state = 'OUTCOME_UNKNOWN', updated_at = now() WHERE id = $1", [op.id]);
        await db.query("UPDATE purchase_intents SET state = 'OUTCOME_UNKNOWN', reason = 'Manual investigation required: paid Sandbox order has no matching frozen mock quote', updated_at = now() WHERE id = $1", [op.intent_id]);
      } else {
        await db.query("UPDATE purchase_intents SET state = 'CONFIRMED', order_id = $2, capture_id = $3, receipt_provider = 'paypal_sandbox', reason = NULL, updated_at = now() WHERE id = $1", [op.intent_id, result.orderId, result.captureId]);
      }
    } else if (result.state === "READY_TO_CAPTURE") {
      if (result.reason) {
        await db.query("UPDATE payment_operations SET state = 'OUTCOME_UNKNOWN', updated_at = now() WHERE id = $1", [op.id]);
        await db.query("UPDATE purchase_intents SET state = 'OUTCOME_UNKNOWN', order_id = $2, reason = $3, updated_at = now() WHERE id = $1", [op.intent_id, result.orderId, `Manual Sandbox merchant verification required: ${result.reason}`]);
      } else if (op.kind === "capture_order") {
        await db.query("UPDATE payment_operations SET state = 'OUTCOME_UNKNOWN', updated_at = now() WHERE id = $1", [op.id]);
        await db.query("UPDATE purchase_intents SET state = 'OUTCOME_UNKNOWN', order_id = $2, reason = 'Sandbox capture remains unconfirmed', updated_at = now() WHERE id = $1", [op.intent_id, result.orderId]);
        await enqueueReconcile(op.id, op.user_id, 60, db);
      } else {
        const frozen = { ...op.payload, orderId: result.orderId };
        const hash = createHash("sha256").update(JSON.stringify(frozen)).digest("hex");
        const inserted = await db.query(
          `INSERT INTO payment_operations (intent_id,kind,provider,payload_hash,payload,order_id)
           VALUES ($1,'capture_order','paypal_sandbox',$2,$3,$4)
           ON CONFLICT (intent_id,kind,generation) DO NOTHING RETURNING id,order_id,payload_hash`,
          [op.intent_id, hash, JSON.stringify(frozen), result.orderId],
        );
        const capture = inserted.rows[0] ?? (await db.query(
          "SELECT id,order_id,payload_hash FROM payment_operations WHERE intent_id = $1 AND kind = 'capture_order' AND generation = 1 FOR UPDATE",
          [op.intent_id],
        )).rows[0];
        if (!capture || capture.order_id !== result.orderId || (capture.payload_hash && capture.payload_hash !== hash)) {
          await db.query("UPDATE purchase_intents SET state = 'OUTCOME_UNKNOWN', reason = 'Manual investigation required: conflicting Sandbox capture operation', updated_at = now() WHERE id = $1", [op.intent_id]);
        } else {
          await db.query("UPDATE purchase_intents SET state = 'COMMITTING', order_id = $2, reason = NULL, updated_at = now() WHERE id = $1", [op.intent_id, result.orderId]);
          await db.query("INSERT INTO outbox_jobs (kind,dedupe_key,payload) VALUES ('capture_paypal',$1,$2) ON CONFLICT (dedupe_key) DO NOTHING", [`capture:${capture.id}`, JSON.stringify({ operationId: capture.id, userId: op.user_id })]);
        }
      }
    } else {
      await db.query("UPDATE purchase_intents SET state = $2, order_id = $3, reason = $4, updated_at = now() WHERE id = $1", [op.intent_id, result.state, result.orderId, result.reason ?? null]);
      if (result.state === "PAYMENT_PENDING" ||
        (result.state === "OUTCOME_UNKNOWN" && ["NO_COMPLETED_CAPTURE", "PROVIDER_STATUS"].includes(result.reason ?? ""))) {
        await enqueueReconcile(op.id, op.user_id, 60, db);
      }
    }
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

export async function capturePayPal(operationId: string, userId: string) {
  const op = await loadOperation(operationId, userId);
  if (!op || op.kind !== "capture_order" || op.intent_state === "CONFIRMED") return;
  if (op.state !== "PREPARED") {
    if (["SENT", "OUTCOME_UNKNOWN", "PAYMENT_PENDING"].includes(op.state)) await enqueueReconcile(op.id, op.user_id);
    return;
  }
  if (!op.order_id) { await markNeedsUser(op, "Approved Sandbox order ID is missing"); return; }
  if (op.execution_mode === "paypal_sandbox" && !await exactWallet(op)) {
    await markNeedsUser(op, "Sandbox wallet was disconnected before capture");
    return;
  }
  let client: PayPalSandboxClient;
  try { client = paypalClient(); }
  catch { await markNeedsUser(op, "Sandbox merchant payment configuration is unavailable"); return; }
  if (!await claimFinancialOperation(op, "PREPARED")) {
    await markNeedsUser(op, "Reapproval needed before Sandbox capture");
    return;
  }
  try {
    const result = await client.captureOrder({ orderId: op.order_id, expectedTotalCents: op.payload.totalMinor, referenceId: op.intent_id, requestId: op.request_id,
      beforeFinancialPost: async () => { if (!await claimFinancialOperation(op, "SENT")) throw new FinancialPreflightError(); },
    });
    await applyOrderAssessment(op, result);
  } catch (error) {
    if (error instanceof FinancialPreflightError) {
      await markStoppedBeforePost(op, "Sandbox purchase window or quote expired before capture");
      return;
    }
    await markOutcomeUnknown(op, "Sandbox capture outcome is being checked");
  }
}

export async function reconcilePayPal(operationId: string, userId: string) {
  const op = await loadOperation(operationId, userId);
  if (!op || op.intent_state === "CONFIRMED") return;
  if (op.kind === "create_fresh_order") {
    // Fresh buyer approval has no server-side capture until the exact order is
    // approved. A lost create response must not manufacture a replacement.
    if (op.state === "SENT") {
      const db = await getPool().connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT id FROM purchase_intents WHERE id = $1 FOR UPDATE", [op.intent_id]);
        const changed = await db.query(
          "UPDATE payment_operations SET state = 'OUTCOME_UNKNOWN',updated_at = now() WHERE id = $1 AND state = 'SENT' RETURNING id",
          [op.id],
        );
        if (changed.rowCount) await db.query(
          "UPDATE purchase_intents SET state = 'OUTCOME_UNKNOWN',reason = 'Manual Sandbox order investigation required',updated_at = now() WHERE id = $1 AND state = 'COMMITTING'",
          [op.intent_id],
        );
        await db.query("COMMIT");
      } catch (error) { await db.query("ROLLBACK"); throw error; }
      finally { db.release(); }
    }
    return;
  }
  if (!op.order_id && !["SENT", "OUTCOME_UNKNOWN"].includes(op.state)) return;
  const ageMs = Date.now() - new Date(op.created_at).getTime();
  const investigate = async (reason: string) => {
    await getPool().query(
      "UPDATE purchase_intents SET state = 'OUTCOME_UNKNOWN', reason = $2, updated_at = now() WHERE id = $1 AND state <> 'CONFIRMED'",
      [op.intent_id, reason],
    );
  };
  try {
    const client = paypalClient();
    if (op.order_id) {
      const result = await client.getOrder({ orderId: op.order_id, expectedTotalCents: op.payload.totalMinor, referenceId: op.intent_id });
      if (op.kind === "capture_order" && result.state === "READY_TO_CAPTURE") {
        if (result.reason) {
          await investigate(`Manual Sandbox merchant verification required: ${result.reason}`);
          return;
        }
        if (ageMs >= REPLAY_WINDOW_MS) {
          await investigate("Manual Sandbox capture investigation required; request-ID retention elapsed");
          return;
        }
        if (op.state === "SENT") {
          await markOutcomeUnknown(op, "Sandbox capture outcome is being checked");
          return;
        }
        if (op.state !== "OUTCOME_UNKNOWN") return;
        if ((op.execution_mode === "paypal_sandbox" && !await exactWallet(op)) || !await claimFinancialOperation(op, "OUTCOME_UNKNOWN")) {
          await investigate("Manual Sandbox capture investigation required; current purchase approval is unavailable");
          return;
        }
        try {
          const replay = await client.captureOrder({ orderId: op.order_id, expectedTotalCents: op.payload.totalMinor, referenceId: op.intent_id, requestId: op.request_id,
            beforeFinancialPost: async () => { if (!await claimFinancialOperation(op, "SENT")) throw new FinancialPreflightError(); },
          });
          await applyOrderAssessment(op, replay);
        } catch (error) {
          if (error instanceof FinancialPreflightError) {
            await investigate("Manual Sandbox capture investigation required; current purchase approval expired");
            return;
          }
          await markOutcomeUnknown(op, "Sandbox capture outcome is being checked");
        }
        return;
      }
      await applyOrderAssessment(op, result);
      return;
    }
    if (op.kind !== "create_order" || ageMs >= REPLAY_WINDOW_MS) {
      await investigate("Manual Sandbox order investigation required; request-ID retention elapsed");
      return;
    }
    if (op.state === "SENT") {
      await markOutcomeUnknown(op, "Sandbox order outcome is being checked");
      return;
    }
    if (op.state !== "OUTCOME_UNKNOWN") return;
    const wallet = await exactWallet(op);
    if (!wallet || !await claimFinancialOperation(op, "OUTCOME_UNKNOWN")) {
      await investigate("Manual Sandbox order investigation required; current purchase approval is unavailable");
      return;
    }
    try {
      const result = await client.createOrder({ totalCents: op.payload.totalMinor, vaultId: wallet.vaultId, referenceId: op.intent_id, requestId: op.request_id,
        beforeFinancialPost: async () => { if (!await claimFinancialOperation(op, "SENT")) throw new FinancialPreflightError(); },
      });
      await applyOrderAssessment(op, result);
    } catch (error) {
      if (error instanceof FinancialPreflightError) {
        await investigate("Manual Sandbox order investigation required; current purchase approval expired");
        return;
      }
      await markOutcomeUnknown(op, "Sandbox order outcome is being checked");
    }
  } catch {
    if (ageMs < REPLAY_WINDOW_MS) await markOutcomeUnknown(op, "Sandbox order status is temporarily unavailable");
    else await investigate("Manual Sandbox investigation required; provider status is unavailable");
  }
}
