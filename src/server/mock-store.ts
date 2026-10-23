import { createHash, randomBytes } from "node:crypto";
import { ZodError } from "zod";
import { z } from "zod";
import { getPool } from "../db/client";
import { getConfig } from "../config";
import type { KernelCartResult } from "../integrations/kernel-cart";

const SETUP_CODE_TTL_MS = 10 * 60 * 1000;
const STORE_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class MockStoreError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
  }
}

export function requireConfiguredStoreOrigin(request: Request, method: "GET" | "POST"): URL {
  const config = getConfig();
  if (!config.MOCK_STORE_ORIGIN) {
    throw new MockStoreError("STORE_NOT_CONFIGURED", 503, "The synthetic store origin is not configured");
  }
  const expected = new URL(config.MOCK_STORE_ORIGIN);
  // Next may normalize Request.url to APP_ORIGIN even when the browser used the
  // distinct store host. The Host header preserves the browser's authority.
  if (expected.origin === new URL(config.APP_ORIGIN).origin || request.headers.get("host") !== expected.host) {
    throw new MockStoreError("WRONG_STORE_ORIGIN", 403, "Open the synthetic store on its configured address");
  }
  if (method === "POST" && request.headers.get("origin") !== expected.origin) {
    throw new MockStoreError("INVALID_ORIGIN", 403, "Store action came from an unapproved origin");
  }
  return expected;
}

export function requireAppOrigin(request: Request): void {
  const expected = new URL(getConfig().APP_ORIGIN);
  const actual = new URL(request.url);
  if (actual.origin !== expected.origin || request.headers.get("host") !== expected.host || request.headers.get("origin") !== expected.origin) {
    throw new MockStoreError("INVALID_ORIGIN", 403, "App action came from an unapproved origin");
  }
}

export async function createStoreSetupCode(userId: string) {
  const config = getConfig();
  if (!config.MOCK_STORE_ORIGIN || new URL(config.MOCK_STORE_ORIGIN).origin === new URL(config.APP_ORIGIN).origin) {
    throw new MockStoreError("STORE_NOT_CONFIGURED", 503, "Configure a store origin distinct from the app origin");
  }
  const setupCode = randomBytes(18).toString("base64url");
  const accountLabel = `demo-${randomBytes(4).toString("hex")}`;
  const expiresAt = new Date(Date.now() + SETUP_CODE_TTL_MS);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const session = await client.query<{ id: string }>(
      `INSERT INTO mock_store_sessions (owner_user_id,account_label,setup_code_hash,setup_code_expires_at)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [userId, accountLabel, hash(setupCode), expiresAt],
    );
    await client.query("INSERT INTO mock_store_carts (session_id) VALUES ($1)", [session.rows[0].id]);
    await client.query("COMMIT");
    return {
      storeSessionId: session.rows[0].id,
      accountLabel,
      setupCode,
      expiresAt: expiresAt.toISOString(),
      storeUrl: new URL("/store", config.MOCK_STORE_ORIGIN).toString(),
      syntheticOnly: true as const,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const bindInput = z.object({ storeSessionId: z.uuid() }).strict();

export async function bindStoreCart(userId: string, raw: unknown, options?: {
  expectedIntentId?: string;
  requireUnbound?: boolean;
  kernelProof?: KernelCartResult;
}) {
  const { storeSessionId } = bindInput.parse(raw);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const intentResult = await client.query(
      `SELECT i.id,i.state,i.quote_id,i.store_session_id,p.id AS permission_id,p.status AS permission_status,
              p.primary_sku,p.alternative_skus,p.approved_variants,p.seller,p.synthetic_destination_id,p.execution_mode
       FROM purchase_intents i
       JOIN goals g ON g.id = i.goal_id
       JOIN purchase_permissions p ON p.id = i.permission_id
       WHERE i.user_id = $1 AND g.user_id = $1 AND g.status = 'ACTIVE'
       ORDER BY i.created_at DESC LIMIT 1 FOR UPDATE OF i,p`,
      [userId],
    );
    const intent = intentResult.rows[0];
    if (!intent || intent.permission_status !== "ACTIVE") throw new MockStoreError("NO_ACTIVE_REWARD", 409, "Approve an active reward before binding a cart");
    if (options?.expectedIntentId && intent.id !== options.expectedIntentId) {
      throw new MockStoreError("REWARD_CHANGED", 409, "The reward changed while the store cart was being prepared");
    }
    if (options?.requireUnbound && intent.store_session_id) {
      throw new MockStoreError("CART_ALREADY_BOUND", 409, "A different store cart is already linked to this reward");
    }
    if (!["ARMED", "QUALIFIED_WAITING_WINDOW", "QUEUED", "NEEDS_USER", "BUYER_APPROVAL_REQUIRED"].includes(intent.state) || intent.quote_id) {
      throw new MockStoreError("PURCHASE_ALREADY_STARTED", 409, "This purchase has already reached a quote or payment step");
    }
    const operation = await client.query("SELECT id FROM payment_operations WHERE intent_id = $1 LIMIT 1", [intent.id]);
    if (operation.rowCount) throw new MockStoreError("PURCHASE_ALREADY_STARTED", 409, "This purchase already has a payment operation");
    const store = await client.query(
      `SELECT s.id,c.sku,c.destination_id,dp.variant,dp.seller
       FROM mock_store_sessions s JOIN mock_store_carts c ON c.session_id = s.id
       LEFT JOIN demo_products dp ON dp.sku = c.sku
       WHERE s.id = $1 AND s.owner_user_id = $2 AND s.session_token_hash IS NOT NULL
         AND s.session_expires_at > now() FOR SHARE OF s,c`,
      [storeSessionId, userId],
    );
    const cart = store.rows[0];
    if (!cart?.sku) throw new MockStoreError("CART_NOT_READY", 409, "Sign in to the synthetic store and save a product first");
    const alternatives = intent.alternative_skus as string[];
    const variants = intent.approved_variants as Record<string, string>;
    if (![intent.primary_sku, ...alternatives].includes(cart.sku) || variants[cart.sku] !== cart.variant ||
        intent.seller !== cart.seller || intent.synthetic_destination_id !== cart.destination_id) {
      throw new MockStoreError("CART_OUTSIDE_PERMISSION", 409, "The saved cart is outside this reward's approved item or destination");
    }
    if (intent.store_session_id !== storeSessionId) {
      await client.query("UPDATE purchase_intents SET store_session_id = $2, updated_at = now() WHERE id = $1", [intent.id, storeSessionId]);
      await client.query("INSERT INTO audit_events (user_id,actor,type,details) VALUES ($1,$1,'STORE_CART_BOUND',$2)",
        [userId, JSON.stringify({ intentId: intent.id, storeSessionId, sku: cart.sku })]);
    }
    if (options?.kernelProof) {
      const proof = options.kernelProof;
      if (proof.storeSessionId !== storeSessionId || proof.sku !== cart.sku ||
          !proof.writerSessionId || !proof.readerSessionId || proof.writerSessionId === proof.readerSessionId) {
        throw new MockStoreError("KERNEL_PROOF_MISMATCH", 409, "Kernel browser sessions did not verify this exact cart");
      }
      await client.query("INSERT INTO audit_events (user_id,actor,type,details) VALUES ($1,'worker','KERNEL_CART_VERIFIED',$2)",
        [userId, JSON.stringify({ intentId: intent.id, storeSessionId, sku: cart.sku,
          writerSessionId: proof.writerSessionId, readerSessionId: proof.readerSessionId })]);
    }
    if (intent.state === "NEEDS_USER" && intent.execution_mode !== "paypal_sandbox_fresh") {
      await client.query("UPDATE purchase_intents SET state = 'QUEUED', reason = NULL, updated_at = now() WHERE id = $1", [intent.id]);
      await client.query(
        "INSERT INTO outbox_jobs (kind,dedupe_key,payload) VALUES ('execute_purchase',$1,$2) ON CONFLICT (dedupe_key) DO NOTHING",
        [`bind:${intent.id}:${storeSessionId}`, JSON.stringify({ intentId: intent.id, userId })],
      );
    }
    await client.query("COMMIT");
    return { intentId: intent.id, storeSessionId, sku: cart.sku, bound: true as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function redeemStoreSetupCode(setupCode: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STORE_SESSION_TTL_MS);
  const result = await getPool().query<{ id: string; account_label: string }>(
    `UPDATE mock_store_sessions
     SET setup_code_hash = NULL, setup_code_expires_at = NULL,
         session_token_hash = $2, session_expires_at = $3
     WHERE setup_code_hash = $1 AND setup_code_expires_at > now() AND session_token_hash IS NULL
     RETURNING id,account_label`,
    [hash(setupCode), hash(token), expiresAt],
  );
  if (!result.rows[0]) throw new MockStoreError("INVALID_SETUP_CODE", 401, "Code was not found, was used, or expired");
  return { token, accountLabel: result.rows[0].account_label, expiresAt };
}

export function storeCookieName(storeOrigin: URL) {
  return storeOrigin.protocol === "https:" ? "__Host-rewardloop_store" : "rewardloop_store";
}

export function storeCookieHeader(token: string, origin: URL, expiresAt: Date) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return `${storeCookieName(origin)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin.protocol === "https:" ? "; Secure" : ""}`;
}

function cookieToken(request: Request, origin: URL): string | null {
  const name = storeCookieName(origin);
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  const token = match?.slice(name.length + 1) ?? "";
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export async function requireStoreSession(request: Request, origin: URL) {
  const token = cookieToken(request, origin);
  if (!token) throw new MockStoreError("STORE_SIGN_IN_REQUIRED", 401, "Sign in to the synthetic store");
  const result = await getPool().query<{ id: string; account_label: string }>(
    `SELECT id,account_label FROM mock_store_sessions
     WHERE session_token_hash = $1 AND session_expires_at > now()`,
    [hash(token)],
  );
  if (!result.rows[0]) throw new MockStoreError("STORE_SESSION_EXPIRED", 401, "Store session expired; request a new setup code");
  return { id: result.rows[0].id, accountLabel: result.rows[0].account_label };
}

export async function getStoreCart(storeSessionId: string) {
  const pool = getPool();
  const [cart, products] = await Promise.all([
    pool.query<{ sku: string | null; destination_id: string }>(
      "SELECT sku,destination_id FROM mock_store_carts WHERE session_id = $1", [storeSessionId],
    ),
    pool.query<{ sku: string; title: string; variant: string; seller: string; price_minor: number; shipping_minor: number; tax_minor: number; available: boolean }>(
      "SELECT sku,title,variant,seller,price_minor,shipping_minor,tax_minor,available FROM demo_products ORDER BY sku",
    ),
  ]);
  if (!cart.rows[0]) throw new MockStoreError("CART_NOT_FOUND", 404, "Synthetic cart was not found");
  return {
    accountSessionId: storeSessionId,
    sku: cart.rows[0].sku,
    destinationId: cart.rows[0].destination_id,
    products: products.rows.map((product) => ({
      sku: product.sku,
      title: product.title,
      variant: product.variant,
      seller: product.seller,
      priceMinor: product.price_minor,
      shippingMinor: product.shipping_minor,
      taxMinor: product.tax_minor,
      available: product.available,
    })),
    syntheticOnly: true as const,
    checkoutEnabled: false as const,
    shipment: false as const,
  };
}

export async function saveStoreCart(storeSessionId: string, sku: string) {
  const pool = getPool();
  const product = await pool.query("SELECT sku FROM demo_products WHERE sku = $1", [sku]);
  if (!product.rows[0]) throw new MockStoreError("UNKNOWN_DEMO_SKU", 400, "Choose one of the synthetic demo products");
  const updated = await pool.query(
    `UPDATE mock_store_carts SET sku = $2, destination_id = 'demo-us-address', updated_at = now()
     WHERE session_id = $1 RETURNING id`,
    [storeSessionId, sku],
  );
  if (!updated.rows[0]) throw new MockStoreError("CART_NOT_FOUND", 404, "Synthetic cart was not found");
  return getStoreCart(storeSessionId);
}

export function storeErrorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (error instanceof MockStoreError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  console.error("Synthetic store failed", error instanceof Error ? error.name : "unknown error");
  return Response.json({ error: "INTERNAL_ERROR" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
