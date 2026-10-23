import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getConfig } from "../config";
import { getPool } from "../db/client";
import { pgDate } from "../db/date";
import { localDateAt } from "../domain/clock";
import { evaluatePurchaseGate } from "../domain/purchase-gate";
import { PayPalSandboxClient, PayPalSandboxError } from "../integrations/paypal-sandbox";
import { capturePayPal, financialPostStillAllowed } from "../worker/paypal-jobs";

export class FreshCheckoutError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}

function sandboxClient() {
  const config = getConfig();
  if (!config.PAYPAL_SANDBOX_CLIENT_ID || !config.PAYPAL_SANDBOX_CLIENT_SECRET || !config.PAYPAL_SANDBOX_MERCHANT_ID) {
    throw new FreshCheckoutError("PAYPAL_SANDBOX_NOT_CONFIGURED", 503);
  }
  return new PayPalSandboxClient({
    clientId: config.PAYPAL_SANDBOX_CLIENT_ID,
    clientSecret: config.PAYPAL_SANDBOX_CLIENT_SECRET,
    merchantId: config.PAYPAL_SANDBOX_MERCHANT_ID,
    apiBaseUrl: config.PAYPAL_API_BASE_URL,
  });
}

async function activeFreshIntent(db: PoolClient, userId: string) {
  const found = await db.query(
    `SELECT i.* FROM purchase_intents i
     JOIN purchase_permissions p ON p.id = i.permission_id
     JOIN goals g ON g.id = i.goal_id
     WHERE i.user_id = $1 AND p.execution_mode = 'paypal_sandbox_fresh' AND g.status = 'ACTIVE'
     ORDER BY i.created_at DESC LIMIT 1 FOR UPDATE OF i`, [userId],
  );
  const intent = found.rows[0];
  if (!intent) throw new FreshCheckoutError("FRESH_CHECKOUT_NOT_READY", 404);
  const p = await db.query("SELECT * FROM purchase_permissions WHERE id = $1 AND user_id = $2 FOR SHARE", [intent.permission_id, userId]);
  const g = await db.query("SELECT * FROM goals WHERE id = $1 AND user_id = $2 FOR SHARE", [intent.goal_id, userId]);
  if (!p.rows[0] || !g.rows[0]) throw new FreshCheckoutError("PURCHASE_CONTEXT_MISSING");
  return { intent, permission: p.rows[0], goal: g.rows[0] };
}

async function boundCart(db: PoolClient, intent: Record<string, unknown>, userId: string) {
  if (!intent.store_session_id) throw new FreshCheckoutError("SYNTHETIC_CART_BINDING_REQUIRED");
  const result = await db.query(
    `SELECT s.id AS store_session_id,c.sku,c.destination_id FROM mock_store_sessions s
     JOIN mock_store_carts c ON c.session_id = s.id
     WHERE s.id = $1 AND s.owner_user_id = $2 AND s.session_token_hash IS NOT NULL
       AND s.session_expires_at > now() FOR SHARE OF s,c`,
    [intent.store_session_id, userId],
  );
  if (!result.rows[0]?.sku) throw new FreshCheckoutError("SYNTHETIC_CART_NOT_READY");
  return result.rows[0];
}

async function qualificationCount(db: PoolClient, goal: Record<string, unknown>) {
  const count = await db.query(
    `SELECT COUNT(*)::int AS n FROM daily_qualifications dq
     JOIN evidence_submissions e ON e.id = dq.evidence_id
     WHERE dq.goal_id = $1 AND dq.goal_version = $2 AND dq.rubric_version = $3
       AND dq.local_date >= $4 AND dq.local_date < $5
       AND e.status = 'ACCEPTED' AND e.review_provider = 'anthropic'`,
    [goal.id, goal.goal_version, goal.rubric_version, goal.start_date, goal.end_date_exclusive],
  );
  return Number(count.rows[0]?.n ?? 0);
}

function assertGate(userId: string, intent: Record<string, unknown>, permission: Record<string, unknown>,
  goal: Record<string, unknown>, cart: Record<string, unknown>, product: Record<string, unknown>,
  totalMinor: number, qualified: boolean, leaseValid: boolean) {
  const config = getConfig();
  const gate = evaluatePurchaseGate({
    runtime: "hackathon", paymentHost: config.PAYPAL_API_BASE_URL,
    actorUserId: userId, intentUserId: String(intent.user_id),
    goal: { version: Number(goal.goal_version), rubricVersion: Number(goal.rubric_version), qualified, status: String(goal.status) },
    permission: {
      userId: String(permission.user_id), goalVersion: Number(permission.goal_version), rubricVersion: Number(permission.rubric_version),
      status: String(permission.status), primarySku: String(permission.primary_sku), alternativeSkus: permission.alternative_skus as string[],
      approvedVariants: permission.approved_variants as Record<string, string>, seller: String(permission.seller),
      quantity: Number(permission.quantity), currency: String(permission.currency), destinationId: String(permission.synthetic_destination_id),
      totalCapMinor: Number(permission.total_cap_minor), earliestDate: pgDate(permission.earliest_date), latestDate: pgDate(permission.latest_date),
      unattendedSandboxApproved: false, executionMode: "paypal_sandbox_fresh",
    },
    intent: { state: "READY_TO_COMMIT", captureId: intent.capture_id as string | null, leaseValid },
    quote: {
      sku: String(product.sku), variant: String(product.variant), seller: String(product.seller), quantity: 1,
      currency: "USD", destinationId: String(cart.destination_id), totalMinor,
      fresh: true, inventoryVersionMatches: true, extraItems: false,
    },
    businessDate: localDateAt(new Date(), String(goal.timezone)),
    paymentConnectionReady: false, sandboxMerchantReady: Boolean(config.PAYPAL_SANDBOX_CLIENT_ID && config.PAYPAL_SANDBOX_CLIENT_SECRET && config.PAYPAL_SANDBOX_MERCHANT_ID),
    fixtureModeAllowed: false,
  });
  if (!gate.allowed) throw new FreshCheckoutError(gate.code);
}

function quoteMatchesProduct(quote: Record<string, unknown>, product: Record<string, unknown>): boolean {
  return quote.sku === product.sku && quote.variant === product.variant && quote.seller === product.seller &&
    quote.quantity === 1 && quote.item_minor === product.price_minor &&
    quote.shipping_minor === product.shipping_minor && quote.tax_minor === product.tax_minor &&
    quote.total_minor === Number(product.price_minor) + Number(product.shipping_minor) + Number(product.tax_minor) &&
    quote.inventory_version === product.inventory_version && product.available === true;
}

async function finishFreshCreate(operation: { id: string; intentId: string }, state: string,
  intentState: string, reason: string | null, orderId: string | null): Promise<boolean> {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const intent = await db.query("SELECT state FROM purchase_intents WHERE id = $1 FOR UPDATE", [operation.intentId]);
    if (intent.rows[0]?.state !== "COMMITTING") { await db.query("COMMIT"); return false; }
    const changed = await db.query(
      "UPDATE payment_operations SET state = $2,order_id = $3,updated_at = now() WHERE id = $1 AND state = 'SENT' RETURNING id",
      [operation.id, state, orderId],
    );
    if (!changed.rowCount) { await db.query("COMMIT"); return false; }
    await db.query(
      "UPDATE purchase_intents SET state = $2,order_id = $3,reason = $4,updated_at = now() WHERE id = $1 AND state = 'COMMITTING'",
      [operation.intentId, intentState, orderId, reason],
    );
    await db.query("COMMIT");
    return true;
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

export async function freshCheckoutStatus(userId: string) {
  const config = getConfig();
  const row = await getPool().query(
    `SELECT i.id AS intent_id,i.state,i.order_id,i.lease_until,p.execution_mode
     FROM purchase_intents i JOIN purchase_permissions p ON p.id = i.permission_id
     WHERE i.user_id = $1 ORDER BY i.created_at DESC LIMIT 1`, [userId],
  );
  const intent = row.rows[0];
  const configured = Boolean(config.PAYPAL_SANDBOX_CLIENT_ID && config.PAYPAL_SANDBOX_CLIENT_SECRET && config.PAYPAL_SANDBOX_MERCHANT_ID);
  return {
    configured, environment: "sandbox" as const,
    mode: intent?.execution_mode === "paypal_sandbox_fresh" ? "fresh_buyer_approval" : "not_selected",
    status: intent?.state ?? "NOT_READY",
    ready: configured && intent?.execution_mode === "paypal_sandbox_fresh" &&
      ["BUYER_APPROVAL_REQUIRED", "BUYER_APPROVAL_PENDING"].includes(intent.state),
    clientId: configured ? config.PAYPAL_SANDBOX_CLIENT_ID : undefined,
    merchantId: configured ? config.PAYPAL_SANDBOX_MERCHANT_ID : undefined,
  };
}

export async function createFreshCheckoutOrder(userId: string): Promise<{ orderId: string }> {
  const client = sandboxClient();
  const db = await getPool().connect();
  let operation: { id: string; intentId: string; totalMinor: number; requestId: string };
  let committedPark = false;
  try {
    await db.query("BEGIN");
    const { intent, permission, goal } = await activeFreshIntent(db, userId);
    if (permission.status !== "ACTIVE" || goal.status !== "ACTIVE") throw new FreshCheckoutError("PERMISSION_INACTIVE");
    if (intent.state === "BUYER_APPROVAL_PENDING" && intent.order_id) {
      const quote = await db.query("SELECT * FROM mock_quotes WHERE id = $1 AND intent_id = $2 FOR SHARE", [intent.quote_id, intent.id]);
      const cart = await boundCart(db, intent, userId);
      const product = await db.query("SELECT * FROM demo_products WHERE sku = $1 FOR SHARE", [cart.sku]);
      const createOp = await db.query(
        "SELECT payload FROM payment_operations WHERE intent_id = $1 AND kind = 'create_fresh_order' AND order_id = $2 AND state = 'AWAITING_BUYER' ORDER BY generation DESC LIMIT 1 FOR SHARE",
        [intent.id, intent.order_id],
      );
      if (quote.rows[0] && quote.rows[0].status === "RESERVED" && quote.rows[0].expires_at > new Date() &&
          intent.lease_until > new Date() && cart.sku === quote.rows[0].sku && cart.destination_id === quote.rows[0].destination_id &&
          product.rows[0] && quoteMatchesProduct(quote.rows[0], product.rows[0]) &&
          createOp.rows[0]?.payload?.permissionHash === permission.payload_hash &&
          createOp.rows[0]?.payload?.storeSessionId === cart.store_session_id) {
        const qualified = await qualificationCount(db, goal) >= goal.required_days;
        assertGate(userId, intent, permission, goal, cart, product.rows[0], quote.rows[0].total_minor, qualified, true);
        await db.query("COMMIT");
        return { orderId: intent.order_id };
      }
      // A PayPal order already exists for the frozen quote. Preserve its ID and
      // stop checkout instead of silently creating a second financial order.
      await db.query(
        "UPDATE purchase_intents SET state = 'NEEDS_USER',reason = 'Existing Sandbox order needs review after its approved quote or window changed',updated_at = now() WHERE id = $1",
        [intent.id],
      );
      await db.query("COMMIT");
      committedPark = true;
      throw new FreshCheckoutError("EXISTING_SANDBOX_ORDER_REQUIRES_REVIEW");
    }
    if (intent.state !== "BUYER_APPROVAL_REQUIRED") throw new FreshCheckoutError("FRESH_CHECKOUT_NOT_READY");
    const cart = await boundCart(db, intent, userId);
    const products = await db.query("SELECT * FROM demo_products WHERE sku = $1 FOR SHARE", [cart.sku]);
    const product = products.rows[0];
    if (!product || !product.available) throw new FreshCheckoutError("SYNTHETIC_ITEM_UNAVAILABLE");
    const totalMinor = product.price_minor + product.shipping_minor + product.tax_minor;
    const qualified = await qualificationCount(db, goal) >= goal.required_days;
    assertGate(userId, intent, permission, goal, cart, product, totalMinor, qualified, true);
    const quote = await db.query(
      `INSERT INTO mock_quotes (intent_id,sku,variant,seller,quantity,item_minor,shipping_minor,tax_minor,total_minor,inventory_version,destination_id,status,expires_at)
       VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,'RESERVED',now() + interval '5 minutes') RETURNING id`,
      [intent.id, product.sku, product.variant, product.seller, product.price_minor, product.shipping_minor,
        product.tax_minor, totalMinor, product.inventory_version, cart.destination_id],
    );
    const lease = await db.query(
      `UPDATE purchase_intents SET state = 'COMMITTING',selected_sku = $2,quote_id = $3,
         lease_owner = 'worker',lease_fence = lease_fence + 1,lease_until = now() + interval '5 minutes',updated_at = now()
       WHERE id = $1 RETURNING lease_fence`, [intent.id, product.sku, quote.rows[0].id],
    );
    const frozen = { intentId: intent.id, quoteId: quote.rows[0].id, sku: product.sku, variant: product.variant,
      seller: product.seller, totalMinor, currency: "USD", permissionHash: permission.payload_hash,
      leaseFence: lease.rows[0].lease_fence, storeSessionId: cart.store_session_id };
    const generation = await db.query("SELECT COALESCE(MAX(generation),0) + 1 AS next FROM payment_operations WHERE intent_id = $1 AND kind = 'create_fresh_order'", [intent.id]);
    const op = await db.query(
      `INSERT INTO payment_operations (intent_id,kind,provider,generation,payload_hash,payload,state)
       VALUES ($1,'create_fresh_order','paypal_sandbox',$2,$3,$4,'SENT') RETURNING id,request_id`,
      [intent.id, generation.rows[0].next, createHash("sha256").update(JSON.stringify(frozen)).digest("hex"), JSON.stringify(frozen)],
    );
    operation = { id: op.rows[0].id, intentId: intent.id, totalMinor, requestId: op.rows[0].request_id };
    const slot = Math.ceil((Date.now() + 120_000) / 60_000);
    await db.query(
      `INSERT INTO outbox_jobs (kind,dedupe_key,payload,available_at)
       VALUES ('reconcile_paypal',$1,$2,to_timestamp($3::double precision)) ON CONFLICT (dedupe_key) DO NOTHING`,
      [`reconcile:${operation.id}:${slot}`, JSON.stringify({ operationId: operation.id, userId }), slot * 60],
    );
    await db.query("COMMIT");
  } catch (error) { if (!committedPark) await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }

  try {
    const result = await client.createFreshOrder({
      totalCents: operation.totalMinor, referenceId: operation.intentId, requestId: operation.requestId,
      beforeFinancialPost: async () => {
        if (!await financialPostStillAllowed(operation.id, userId)) throw new FreshCheckoutError("PURCHASE_GATE_CHANGED");
      },
    });
    if (result.state !== "NEEDS_USER" || !["CREATED", "PAYER_ACTION_REQUIRED"].includes(result.orderStatus)) {
      throw new FreshCheckoutError("FRESH_ORDER_UNEXPECTED_STATUS", 502);
    }
    const saved = await finishFreshCreate(operation, "AWAITING_BUYER", "BUYER_APPROVAL_PENDING", null, result.orderId);
    if (!saved) throw new FreshCheckoutError("FRESH_ORDER_OUTCOME_UNKNOWN", 202);
    return { orderId: result.orderId };
  } catch (error) {
    if (error instanceof FreshCheckoutError && error.code === "PURCHASE_GATE_CHANGED") {
      await finishFreshCreate(operation, "NO_PAYMENT", "NEEDS_USER", "Sandbox checkout expired before order creation", null);
      throw error;
    }
    await finishFreshCreate(operation, "OUTCOME_UNKNOWN", "OUTCOME_UNKNOWN", "Manual Sandbox order investigation required", null);
    throw error;
  }
}

export async function captureFreshCheckoutOrder(userId: string, orderId: string) {
  if (!/^[A-Za-z0-9_-]{1,36}$/.test(orderId)) throw new FreshCheckoutError("ORDER_ID_INVALID", 400);
  const client = sandboxClient();
  const approvedOrder = await getPool().query(
    `SELECT i.id,i.order_id,q.total_minor FROM purchase_intents i
     JOIN purchase_permissions p ON p.id = i.permission_id
     JOIN mock_quotes q ON q.id = i.quote_id AND q.intent_id = i.id
     WHERE i.user_id = $1 AND i.order_id = $2 AND i.state = 'BUYER_APPROVAL_PENDING'
       AND p.execution_mode = 'paypal_sandbox_fresh'`, [userId, orderId],
  );
  if (!approvedOrder.rows[0]) throw new FreshCheckoutError("ORDER_NOT_BOUND_TO_BUYER");
  // Bounded provider read happens before locking local purchase rows.
  const assessment = await client.getOrder({ orderId, expectedTotalCents: approvedOrder.rows[0].total_minor, referenceId: approvedOrder.rows[0].id });
  if (assessment.state !== "READY_TO_CAPTURE" || assessment.reason) throw new FreshCheckoutError("BUYER_APPROVAL_NOT_VERIFIED");
  const db = await getPool().connect();
  let operationId: string;
  try {
    await db.query("BEGIN");
    const { intent, permission, goal } = await activeFreshIntent(db, userId);
    if (intent.state !== "BUYER_APPROVAL_PENDING" || intent.order_id !== orderId) throw new FreshCheckoutError("ORDER_NOT_BOUND_TO_BUYER");
    const quoteResult = await db.query("SELECT * FROM mock_quotes WHERE id = $1 AND intent_id = $2 FOR SHARE", [intent.quote_id, intent.id]);
    const quote = quoteResult.rows[0];
    const cart = await boundCart(db, intent, userId);
    const productResult = await db.query("SELECT * FROM demo_products WHERE sku = $1 FOR SHARE", [quote?.sku]);
    const product = productResult.rows[0];
    if (!quote || !product || quote.status !== "RESERVED" || quote.expires_at <= new Date() ||
        !quoteMatchesProduct(quote, product) || cart.sku !== quote.sku || cart.destination_id !== quote.destination_id ||
        quote.total_minor !== approvedOrder.rows[0].total_minor || intent.id !== approvedOrder.rows[0].id) {
      throw new FreshCheckoutError("QUOTE_EXPIRED_OR_CHANGED");
    }
    const qualified = await qualificationCount(db, goal) >= goal.required_days;
    assertGate(userId, intent, permission, goal, cart, product, quote.total_minor, qualified, intent.lease_until > new Date());
    const createOp = await db.query(
      "SELECT payload FROM payment_operations WHERE intent_id = $1 AND kind = 'create_fresh_order' AND order_id = $2 AND state = 'AWAITING_BUYER' ORDER BY generation DESC LIMIT 1 FOR SHARE",
      [intent.id, orderId],
    );
    if (!createOp.rows[0]) throw new FreshCheckoutError("FRESH_ORDER_OPERATION_MISSING");
    const frozen = { ...createOp.rows[0].payload, orderId };
    const hash = createHash("sha256").update(JSON.stringify(frozen)).digest("hex");
    const captured = await db.query(
      `INSERT INTO payment_operations (intent_id,kind,provider,payload_hash,payload,order_id)
       VALUES ($1,'capture_order','paypal_sandbox',$2,$3,$4)
       ON CONFLICT (intent_id,kind,generation) DO NOTHING RETURNING id`,
      [intent.id, hash, JSON.stringify(frozen), orderId],
    );
    if (!captured.rows[0]) throw new FreshCheckoutError("CAPTURE_ALREADY_STARTED");
    operationId = captured.rows[0].id;
    await db.query("UPDATE purchase_intents SET state = 'COMMITTING',updated_at = now() WHERE id = $1", [intent.id]);
    await db.query(
      "INSERT INTO outbox_jobs (kind,dedupe_key,payload) VALUES ('capture_paypal',$1,$2) ON CONFLICT (dedupe_key) DO NOTHING",
      [`capture:${operationId}`, JSON.stringify({ operationId, userId })],
    );
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }

  await capturePayPal(operationId, userId);
  const result = await getPool().query(
    `SELECT i.state,i.order_id,i.capture_id,i.reason FROM purchase_intents i
     JOIN payment_operations op ON op.intent_id = i.id
     WHERE op.id = $1 AND i.user_id = $2`, [operationId, userId],
  );
  const row = result.rows[0];
  return { status: row?.state ?? "OUTCOME_UNKNOWN", orderId: row?.order_id ?? orderId,
    captureId: row?.capture_id ?? undefined, reason: row?.reason ?? undefined };
}

export function freshCheckoutErrorResponse(error: unknown): Response {
  if (error instanceof FreshCheckoutError) return Response.json({ error: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  if (error instanceof PayPalSandboxError) return Response.json({ error: "PAYPAL_SANDBOX_OUTCOME_UNKNOWN" }, { status: 202, headers: { "Cache-Control": "no-store" } });
  console.error("Fresh Sandbox checkout failed", error instanceof Error ? error.name : "unknown error");
  return Response.json({ error: "FRESH_CHECKOUT_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
