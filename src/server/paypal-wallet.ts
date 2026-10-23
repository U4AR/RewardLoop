import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getConfig } from "../config";
import { getPool } from "../db/client";
import { PayPalSandboxClient, PayPalSandboxError } from "../integrations/paypal-sandbox";

const SETUP_LIFETIME_MS = 71 * 60 * 60 * 1000; // Inside PayPal's default 3-day setup-token lifetime.

export class WalletError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "WalletError";
  }
}

function requireSandboxClient(): PayPalSandboxClient {
  const config = getConfig();
  if (!config.PAYPAL_SANDBOX_CLIENT_ID || !config.PAYPAL_SANDBOX_CLIENT_SECRET || !config.PAYPAL_SANDBOX_MERCHANT_ID) {
    throw new WalletError(503, "PAYPAL_SANDBOX_NOT_CONFIGURED");
  }
  return new PayPalSandboxClient({
    clientId: config.PAYPAL_SANDBOX_CLIENT_ID,
    clientSecret: config.PAYPAL_SANDBOX_CLIENT_SECRET,
    apiBaseUrl: config.PAYPAL_API_BASE_URL,
    merchantId: config.PAYPAL_SANDBOX_MERCHANT_ID,
  });
}

/** Require same-origin browser mutations in addition to the authenticated session. */
export function requireWalletOrigin(request: Request): void {
  const expected = new URL(getConfig().APP_ORIGIN).origin;
  const observed = request.headers.get("origin");
  if (!observed || observed !== expected) throw new WalletError(403, "CROSS_ORIGIN_REQUEST");
}

function encryptionKey(encodedKey: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) {
    throw new WalletError(503, "DATA_ENCRYPTION_KEY_INVALID");
  }
  const key = Buffer.from(encodedKey, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encodedKey) {
    throw new WalletError(503, "DATA_ENCRYPTION_KEY_INVALID");
  }
  return key;
}

/** AES-256-GCM with a fresh 96-bit nonce; the encoded value is server-only. */
export function encryptVaultId(vaultId: string, encodedKey: string): string {
  if (!vaultId || !/^[A-Za-z0-9_-]{1,255}$/.test(vaultId)) throw new WalletError(400, "VAULT_ID_INVALID");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(vaultId, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${ciphertext.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}`;
}

export function decryptVaultId(encrypted: string, encodedKey: string): string {
  const parts = encrypted.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new WalletError(500, "VAULT_CIPHERTEXT_INVALID");
  try {
    const iv = Buffer.from(parts[1]!, "base64url");
    const ciphertext = Buffer.from(parts[2]!, "base64url");
    const tag = Buffer.from(parts[3]!, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("Malformed vault ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(encodedKey), iv);
    decipher.setAuthTag(tag);
    const vaultId = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(vaultId)) throw new Error("Malformed vault ID");
    return vaultId;
  } catch {
    throw new WalletError(500, "VAULT_CIPHERTEXT_INVALID");
  }
}

function stateHash(state: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new WalletError(400, "WALLET_STATE_INVALID");
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function validateApprovalPayload(value: unknown): { vaultSetupToken: string; state: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WalletError(400, "WALLET_APPROVAL_INVALID");
  }
  const body = value as Record<string, unknown>;
  if (typeof body.vaultSetupToken !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(body.vaultSetupToken)) {
    throw new WalletError(400, "WALLET_APPROVAL_INVALID");
  }
  if (typeof body.state !== "string") throw new WalletError(400, "WALLET_APPROVAL_INVALID");
  stateHash(body.state);
  return { vaultSetupToken: body.vaultSetupToken, state: body.state };
}

export async function readWalletJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 4096) throw new WalletError(413, "WALLET_REQUEST_TOO_LARGE");
  const raw = await request.text();
  if (raw.length > 4096) throw new WalletError(413, "WALLET_REQUEST_TOO_LARGE");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new WalletError(400, "WALLET_REQUEST_INVALID_JSON");
  }
}

export function walletErrorResponse(error: unknown): Response {
  if (error instanceof WalletError) {
    return Response.json({ error: error.code }, { status: error.status });
  }
  if (error instanceof PayPalSandboxError) {
    // Provider bodies, payer details, tokens, and debug headers are never echoed.
    const ambiguous = error.status === undefined || error.status >= 500;
    return Response.json({ error: ambiguous ? "PAYPAL_OUTCOME_UNKNOWN" : "PAYPAL_SANDBOX_ERROR" }, {
      status: ambiguous ? 202 : 502,
    });
  }
  return Response.json({ error: "WALLET_OPERATION_FAILED" }, { status: 500 });
}

export async function createSdkToken(): Promise<{ clientId: string; merchantId: string; idToken: string }> {
  const config = getConfig();
  const client = requireSandboxClient();
  const token = await client.getOAuthToken(true);
  if (!token.idToken) throw new WalletError(502, "PAYPAL_ID_TOKEN_MISSING");
  return {
    clientId: config.PAYPAL_SANDBOX_CLIENT_ID!,
    merchantId: config.PAYPAL_SANDBOX_MERCHANT_ID!,
    idToken: token.idToken,
  };
}

export async function createSetupSession(userId: string): Promise<{
  setupToken: string;
  state: string;
  expiresAt: string;
}> {
  const config = getConfig();
  encryptionKey(config.DATA_ENCRYPTION_KEY);
  const client = requireSandboxClient();
  const existing = await getPool().query<{ id: string }>(
    "SELECT id FROM payment_connections WHERE user_id = $1 AND status = 'ACTIVE' LIMIT 1",
    [userId],
  );
  if (existing.rowCount) throw new WalletError(409, "WALLET_ALREADY_CONNECTED");

  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SETUP_LIFETIME_MS);
  const appOrigin = new URL(config.APP_ORIGIN).origin;
  const setup = await client.createVaultSetupToken({
    requestId: randomUUID(),
    returnUrl: `${appOrigin}/?paypal_wallet=approved`,
    cancelUrl: `${appOrigin}/?paypal_wallet=canceled`,
  });
  if (setup.status !== "PAYER_ACTION_REQUIRED") {
    throw new WalletError(502, "PAYPAL_SETUP_ACTION_NOT_REQUIRED");
  }
  await getPool().query(
    `INSERT INTO wallet_setup_sessions
      (id, user_id, setup_token_id, state_hash, status, expires_at)
     VALUES ($1, $2, $3, $4, 'PENDING', $5)`,
    [randomUUID(), userId, setup.setupTokenId, stateHash(state), expiresAt],
  );
  return { setupToken: setup.setupTokenId, state, expiresAt: expiresAt.toISOString() };
}

export async function exchangeApprovedSetupSession(
  userId: string,
  payload: unknown,
): Promise<{ status: "CONNECTED" }> {
  const { vaultSetupToken, state } = validateApprovalPayload(payload);
  // Fail before the provider creates a durable token if local storage cannot
  // protect that token.
  encryptionKey(getConfig().DATA_ENCRYPTION_KEY);
  const client = requireSandboxClient();
  const active = await getPool().query<{ id: string }>(
    "SELECT id FROM payment_connections WHERE user_id = $1 AND status = 'ACTIVE' LIMIT 1",
    [userId],
  );
  if (active.rowCount) throw new WalletError(409, "WALLET_ALREADY_CONNECTED");
  const claim = await getPool().query<{ id: string }>(
    `UPDATE wallet_setup_sessions
        SET status = 'EXCHANGING', consumed_at = COALESCE(consumed_at, NOW())
      WHERE user_id = $1 AND setup_token_id = $2 AND state_hash = $3
        AND expires_at > NOW()
        AND (status = 'PENDING' OR (status = 'OUTCOME_UNKNOWN' AND consumed_at > NOW() - INTERVAL '2 hours'))
      RETURNING id`,
    [userId, vaultSetupToken, stateHash(state)],
  );
  const sessionId = claim.rows[0]?.id;
  if (!sessionId) throw new WalletError(409, "WALLET_SETUP_INVALID_OR_CONSUMED");

  let token: { paymentTokenId: string; customerId: string };
  try {
    // The session UUID is the persisted, stable exchange operation ID.
    token = await client.exchangeApprovedSetupToken({ requestId: sessionId, setupTokenId: vaultSetupToken });
  } catch (error) {
    const ambiguous = !(error instanceof PayPalSandboxError) || error.status === undefined || error.status >= 500;
    await getPool().query(
      "UPDATE wallet_setup_sessions SET status = $2 WHERE id = $1 AND status = 'EXCHANGING'",
      [sessionId, ambiguous ? "OUTCOME_UNKNOWN" : "FAILED"],
    );
    if (ambiguous) throw new WalletError(202, "PAYPAL_OUTCOME_UNKNOWN");
    throw error;
  }

  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const connection = await db.query<{ id: string }>(
      `INSERT INTO payment_connections
        (id, user_id, environment, merchant_id, paypal_customer_id, encrypted_vault_id, status)
       VALUES ($1, $2, 'sandbox', $3, $4, $5, 'ACTIVE')
       ON CONFLICT (user_id) DO UPDATE SET
         id = EXCLUDED.id,
         merchant_id = EXCLUDED.merchant_id,
         paypal_customer_id = EXCLUDED.paypal_customer_id,
         encrypted_vault_id = EXCLUDED.encrypted_vault_id,
         environment = 'sandbox', status = 'ACTIVE', updated_at = NOW()
       WHERE payment_connections.status <> 'ACTIVE'
       RETURNING id`,
      [
        randomUUID(), userId, getConfig().PAYPAL_SANDBOX_MERCHANT_ID,
        token.customerId, encryptVaultId(token.paymentTokenId, getConfig().DATA_ENCRYPTION_KEY),
      ],
    );
    if (!connection.rowCount) throw new WalletError(409, "WALLET_ALREADY_CONNECTED");
    await db.query(
      "UPDATE wallet_setup_sessions SET status = 'CONSUMED' WHERE id = $1 AND status = 'EXCHANGING'",
      [sessionId],
    );
    await db.query(
      "INSERT INTO audit_events (user_id, actor, type, details) VALUES ($1, 'user', 'PAYPAL_WALLET_CONNECTED', $2)",
      [userId, JSON.stringify({ connectionId: connection.rows[0]!.id, environment: "sandbox" })],
    );
    await db.query("COMMIT");
    return { status: "CONNECTED" };
  } catch (error) {
    await rollbackQuietly(db);
    if (error instanceof WalletError && error.code === "WALLET_ALREADY_CONNECTED") {
      try { await client.deletePaymentToken(token.paymentTokenId); } catch { /* no local use is possible */ }
      await getPool().query("UPDATE wallet_setup_sessions SET status = 'FAILED' WHERE id = $1", [sessionId]);
      throw error;
    }
    await getPool().query(
      "UPDATE wallet_setup_sessions SET status = 'OUTCOME_UNKNOWN' WHERE id = $1 AND status = 'EXCHANGING'",
      [sessionId],
    );
    if (error instanceof WalletError) throw error;
    throw new WalletError(202, "PAYPAL_OUTCOME_UNKNOWN");
  } finally {
    db.release();
  }
}

async function rollbackQuietly(db: PoolClient): Promise<void> {
  try { await db.query("ROLLBACK"); } catch { /* connection may already be lost */ }
}

/** For the private purchase worker only; never return the vault ID through an HTTP route. */
export async function getActiveWalletForUser(userId: string): Promise<{
  connectionId: string;
  vaultId: string;
  merchantId: string;
} | null> {
  const config = getConfig();
  const result = await getPool().query<{
    id: string; encrypted_vault_id: string; merchant_id: string;
  }>(
    `SELECT id, encrypted_vault_id, merchant_id FROM payment_connections
     WHERE user_id = $1 AND status = 'ACTIVE' AND environment = 'sandbox' LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.merchant_id !== config.PAYPAL_SANDBOX_MERCHANT_ID) {
    throw new WalletError(409, "WALLET_MERCHANT_MISMATCH");
  }
  return {
    connectionId: row.id,
    vaultId: decryptVaultId(row.encrypted_vault_id, config.DATA_ENCRYPTION_KEY),
    merchantId: row.merchant_id,
  };
}

export async function disconnectWallet(userId: string): Promise<{
  status: "DISCONNECTED";
  providerDeletion: "CONFIRMED" | "PENDING" | "NOT_NEEDED";
}> {
  const db = await getPool().connect();
  let encryptedVaultId: string | undefined;
  let connectionId: string | undefined;
  try {
    await db.query("BEGIN");
    const result = await db.query<{ id: string; encrypted_vault_id: string }>(
      `SELECT id, encrypted_vault_id FROM payment_connections
       WHERE user_id = $1 AND status = 'ACTIVE' AND environment = 'sandbox' FOR UPDATE`,
      [userId],
    );
    connectionId = result.rows[0]?.id;
    encryptedVaultId = result.rows[0]?.encrypted_vault_id;
    if (connectionId) {
      await db.query("UPDATE payment_connections SET status = 'REVOKED', updated_at = NOW() WHERE id = $1", [connectionId]);
      await db.query(
        `UPDATE purchase_permissions SET status = 'REVOKED', revoked_at = NOW()
         WHERE user_id = $1 AND payment_connection_id = $2 AND status = 'ACTIVE'`,
        [userId, connectionId],
      );
      await db.query(
        "INSERT INTO audit_events (user_id, actor, type, details) VALUES ($1, 'user', 'PAYPAL_WALLET_DISCONNECTED', $2)",
        [userId, JSON.stringify({ connectionId, environment: "sandbox" })],
      );
    }
    await db.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(db);
    throw error;
  } finally {
    db.release();
  }
  if (!connectionId || !encryptedVaultId) return { status: "DISCONNECTED", providerDeletion: "NOT_NEEDED" };

  // The local revoke is committed before any provider call. Even if deletion
  // fails, this token cannot be used for a new app purchase.
  try {
    const vaultId = decryptVaultId(encryptedVaultId, getConfig().DATA_ENCRYPTION_KEY);
    await requireSandboxClient().deletePaymentToken(vaultId);
    await getPool().query("UPDATE payment_connections SET status = 'DELETED', updated_at = NOW() WHERE id = $1", [connectionId]);
    return { status: "DISCONNECTED", providerDeletion: "CONFIRMED" };
  } catch {
    return { status: "DISCONNECTED", providerDeletion: "PENDING" };
  }
}
