import { getConfig } from "../config";
import type { AppConfig } from "../config";
import { getPool } from "../db/client";
import { KernelCartError, kernelStoreOrigin, runKernelTwoSessionCart } from "../integrations/kernel-cart";
import { bindStoreCart, createStoreSetupCode, MockStoreError } from "./mock-store";

const PREPARE_STATES = new Set(["ARMED", "QUALIFIED_WAITING_WINDOW", "QUEUED", "NEEDS_USER", "BUYER_APPROVAL_REQUIRED"]);

type CartIntent = {
  id: string;
  user_id: string;
  state: string;
  quote_id: string | null;
  store_session_id: string | null;
  goal_status: string;
  goal_version: number;
  rubric_version: number;
  permission_status: string;
  permission_goal_version: number;
  permission_rubric_version: number;
  primary_sku: string;
  approved_variants: Record<string, string>;
  seller: string;
  synthetic_destination_id: string;
  total_cap_minor: number;
  product_sku: string;
  product_variant: string;
  product_seller: string;
  price_minor: number;
  shipping_minor: number;
  tax_minor: number;
  available: boolean;
};

const latestIntentSql = `
  SELECT i.id,i.user_id,i.state,i.quote_id,i.store_session_id,
         g.status AS goal_status,g.goal_version,g.rubric_version,
         p.status AS permission_status,p.goal_version AS permission_goal_version,
         p.rubric_version AS permission_rubric_version,p.primary_sku,p.approved_variants,
         p.seller,p.synthetic_destination_id,p.total_cap_minor,
         d.sku AS product_sku,d.variant AS product_variant,d.seller AS product_seller,
         d.price_minor,d.shipping_minor,d.tax_minor,d.available
  FROM purchase_intents i
  JOIN goals g ON g.id = i.goal_id AND g.user_id = i.user_id
  JOIN purchase_permissions p ON p.id = i.permission_id AND p.user_id = i.user_id
  JOIN demo_products d ON d.sku = p.primary_sku
  WHERE i.user_id = $1 AND g.status = 'ACTIVE'`;

export function assertKernelCartIntent(row: CartIntent | undefined, userId: string): asserts row is CartIntent {
  if (!row || row.user_id !== userId || row.goal_status !== "ACTIVE" || row.permission_status !== "ACTIVE" ||
      row.goal_version !== row.permission_goal_version || row.rubric_version !== row.permission_rubric_version ||
      !PREPARE_STATES.has(row.state) || row.quote_id || row.store_session_id ||
      row.primary_sku !== row.product_sku || row.approved_variants?.[row.product_sku] !== row.product_variant ||
      row.seller !== row.product_seller || row.synthetic_destination_id !== "demo-us-address" ||
      row.available !== true || !Number.isSafeInteger(row.total_cap_minor) ||
      ![row.price_minor, row.shipping_minor, row.tax_minor].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      row.price_minor + row.shipping_minor + row.tax_minor > row.total_cap_minor) {
    throw new KernelCartError("KERNEL_PRECONDITION_CHANGED");
  }
}

type KernelConfig = Pick<AppConfig, "KERNEL_API_KEY" | "MOCK_STORE_ORIGIN" | "APP_ORIGIN">;

function requireKernelConfiguration(override?: KernelConfig) {
  const config = override ?? getConfig();
  if (!config.KERNEL_API_KEY?.trim()) throw new MockStoreError("KERNEL_NOT_CONFIGURED", 503, "Kernel browser access is not configured");
  try { kernelStoreOrigin(config.MOCK_STORE_ORIGIN, config.APP_ORIGIN); }
  catch { throw new MockStoreError("PUBLIC_HTTPS_STORE_REQUIRED", 503, "Kernel needs a distinct public HTTPS synthetic store"); }
  return config;
}

/** Enqueue one bounded browser preparation for the owner's current intent. */
export async function queueKernelCart(userId: string) {
  requireKernelConfiguration();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<CartIntent>(`${latestIntentSql} ORDER BY i.created_at DESC LIMIT 1 FOR UPDATE OF i,p`, [userId]);
    const row = selected.rows[0];
    if (row?.store_session_id) {
      await client.query("COMMIT");
      return { intentId: row.id, status: "BOUND" as const };
    }
    try { assertKernelCartIntent(row, userId); }
    catch { throw new MockStoreError("KERNEL_CART_NOT_ALLOWED", 409, "Approve an available reward within your cap before preparing the browser cart"); }
    const operations = await client.query("SELECT id FROM payment_operations WHERE intent_id = $1 LIMIT 1", [row.id]);
    if (operations.rowCount) throw new MockStoreError("PURCHASE_ALREADY_STARTED", 409, "This reward has already reached its payment step");
    if (row.state === "QUEUED") await client.query(
      "UPDATE purchase_intents SET state = 'NEEDS_USER', reason = 'Kernel is preparing the synthetic cart', updated_at = now() WHERE id = $1 AND state = 'QUEUED'",
      [row.id],
    );
    const queued = await client.query<{ id: string; status: string }>(
      `INSERT INTO outbox_jobs (kind,dedupe_key,payload)
       VALUES ('prepare_kernel_cart',$1,$2)
       ON CONFLICT (dedupe_key) DO UPDATE SET
         status = CASE WHEN outbox_jobs.status IN ('DONE','FAILED') THEN 'PENDING' ELSE outbox_jobs.status END,
         attempts = CASE WHEN outbox_jobs.status IN ('DONE','FAILED') THEN 0 ELSE outbox_jobs.attempts END,
         available_at = CASE WHEN outbox_jobs.status IN ('DONE','FAILED') THEN now() ELSE outbox_jobs.available_at END,
         locked_until = CASE WHEN outbox_jobs.status IN ('DONE','FAILED') THEN NULL ELSE outbox_jobs.locked_until END,
         last_error = CASE WHEN outbox_jobs.status IN ('DONE','FAILED') THEN NULL ELSE outbox_jobs.last_error END
       RETURNING id,status`,
      [`kernel-cart:${row.id}`, JSON.stringify({ intentId: row.id, userId })],
    );
    await client.query("COMMIT");
    return { intentId: row.id, jobId: queued.rows[0].id, status: queued.rows[0].status };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function getKernelCartStatus(userId: string) {
  const config = getConfig();
  let available = Boolean(config.KERNEL_API_KEY?.trim());
  try { kernelStoreOrigin(config.MOCK_STORE_ORIGIN, config.APP_ORIGIN); }
  catch { available = false; }
  const intent = await getPool().query<{ id: string; store_session_id: string | null }>(
    `SELECT i.id,i.store_session_id FROM purchase_intents i JOIN goals g ON g.id = i.goal_id
     WHERE i.user_id = $1 AND g.user_id = $1 AND g.status = 'ACTIVE'
     ORDER BY i.created_at DESC LIMIT 1`, [userId],
  );
  const row = intent.rows[0];
  if (!row) return { available, status: "NOT_STARTED" as const, verified: false };
  const [job, audit] = await Promise.all([
    getPool().query<{ status: string; last_error: string | null }>(
      "SELECT status,last_error FROM outbox_jobs WHERE dedupe_key = $1", [`kernel-cart:${row.id}`]),
    row.store_session_id ? getPool().query<{ id: string }>(
      `SELECT a.id FROM audit_events a JOIN mock_store_carts c ON c.session_id = $3::uuid
       WHERE a.user_id = $1 AND a.type = 'KERNEL_CART_VERIFIED'
         AND a.details->>'intentId' = $2 AND a.details->>'storeSessionId' = $3
         AND a.details->>'sku' = c.sku LIMIT 1`,
      [userId, row.id, row.store_session_id],
    ) : Promise.resolve({ rows: [] as Array<{ id: string }> }),
  ]);
  return { available, status: row.store_session_id ? "BOUND" : (job.rows[0]?.status ?? "NOT_STARTED"),
    verified: Boolean(row.store_session_id && audit.rows[0]),
    error: job.rows[0]?.status === "FAILED" ? job.rows[0].last_error : null };
}

/** Called only by the worker; the browser never receives app auth or payment data. */
export async function prepareKernelCart(intentId: string, userId: string, deps?: {
  config?: KernelConfig;
  getIntent?: (intentId: string, userId: string) => Promise<CartIntent | undefined>;
  hasPaymentOperation?: (intentId: string) => Promise<boolean>;
  createSetup?: typeof createStoreSetupCode;
  runBrowser?: typeof runKernelTwoSessionCart;
  bindCart?: typeof bindStoreCart;
}) {
  const config = requireKernelConfiguration(deps?.config);
  const row = deps?.getIntent ? await deps.getIntent(intentId, userId) :
    (await getPool().query<CartIntent>(`${latestIntentSql} AND i.id = $2 LIMIT 1`, [userId, intentId])).rows[0];
  assertKernelCartIntent(row, userId);
  const hasPaymentOperation = deps?.hasPaymentOperation ? await deps.hasPaymentOperation(intentId) :
    Boolean((await getPool().query("SELECT id FROM payment_operations WHERE intent_id = $1 LIMIT 1", [intentId])).rowCount);
  if (hasPaymentOperation) throw new KernelCartError("KERNEL_PRECONDITION_CHANGED");

  const setup = await (deps?.createSetup ?? createStoreSetupCode)(userId);
  const proof = await (deps?.runBrowser ?? runKernelTwoSessionCart)({
    apiKey: config.KERNEL_API_KEY, appOrigin: config.APP_ORIGIN, storeOrigin: config.MOCK_STORE_ORIGIN,
    storeSessionId: setup.storeSessionId, setupCode: setup.setupCode, sku: row.primary_sku,
  });
  await (deps?.bindCart ?? bindStoreCart)(userId, { storeSessionId: setup.storeSessionId }, {
    expectedIntentId: intentId, requireUnbound: true, kernelProof: proof,
  });
}
