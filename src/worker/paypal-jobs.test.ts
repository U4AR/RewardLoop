import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  wallet: vi.fn(),
  config: vi.fn(),
}));

vi.mock("../db/client", () => ({ getPool: () => ({ query: mocks.query, connect: mocks.connect }) }));
vi.mock("../server/paypal-wallet", () => ({ getActiveWalletForUser: mocks.wallet }));
vi.mock("../config", () => ({ getConfig: mocks.config }));

import { commitPayPal, reconcilePayPal } from "./paypal-jobs";

const operation = {
  id: "operation-1", intent_id: "intent-1", user_id: "user-1", kind: "create_order",
  state: "PREPARED", request_id: "request-1", order_id: null, capture_id: null,
  created_at: new Date(), intent_state: "COMMITTING", permission_id: "permission-1",
  payment_connection_id: "connection-1", permission_status: "ACTIVE",
  current_permission_hash: "hash-1", provider: "paypal_sandbox",
  payload: {
    intentId: "intent-1", quoteId: "quote-1", totalMinor: 1234,
    sku: "SKU-1", variant: "blue", seller: "demo-seller", currency: "USD",
    permissionHash: "hash-1", leaseFence: 7, storeSessionId: "store-session-1",
  },
};

function validContext() {
  return {
    intent_state: "COMMITTING", intent_reason: null, capture_id: null, intent_order_id: null,
    quote_id: "quote-1", selected_sku: "SKU-1", store_session_id: "store-session-1", lease_owner: "worker", lease_fence: 7,
    lease_until: new Date(Date.now() + 60_000), permission_status: "ACTIVE", payload_hash: "hash-1",
    goal_version: 1, rubric_version: 1, earliest_date: "2020-01-01", latest_date: "2099-01-01",
    unattended_sandbox_approved: true, execution_mode: "paypal_sandbox",
    payment_connection_id: "connection-1", primary_sku: "SKU-1", alternative_skus: [],
    approved_variants: { "SKU-1": "blue" }, approved_seller: "demo-seller", approved_quantity: 1,
    approved_currency: "USD", synthetic_destination_id: "demo-address", total_cap_minor: 2000,
    goal_status: "ACTIVE", current_goal_version: 1, current_rubric_version: 1,
    timezone: "UTC", required_days: 1, start_date: "2020-01-01", end_date_exclusive: "2099-01-01",
    quote_status: "RESERVED", expires_at: new Date(Date.now() + 60_000), total_minor: 1234,
    currency: "USD", sku: "SKU-1", variant: "blue", seller: "demo-seller", quantity: 1,
    destination_id: "demo-address", inventory_version: 1, current_inventory_version: 1,
    available: true, connection_status: "ACTIVE", environment: "sandbox", merchant_id: "merchant-1",
    store_owner: "user-1", session_token_hash: "hash", session_expires_at: new Date(Date.now() + 60_000),
    cart_sku: "SKU-1", cart_destination_id: "demo-address",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockReturnValue({
    PAYPAL_API_BASE_URL: "https://api-m.sandbox.paypal.com",
    PAYPAL_SANDBOX_CLIENT_ID: "sandbox-id", PAYPAL_SANDBOX_CLIENT_SECRET: "sandbox-secret",
    PAYPAL_SANDBOX_MERCHANT_ID: "merchant-1",
  });
  mocks.wallet.mockResolvedValue({ connectionId: "connection-1", vaultId: "sandbox-vault" });
});

afterEach(() => vi.unstubAllGlobals());

describe("PayPal worker financial boundary", () => {
  it("never resends a create operation already marked SENT", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.query.mockImplementation(async (sql: string) => sql.includes("SELECT op.*")
      ? { rows: [{ ...operation, state: "SENT" }] }
      : { rows: [], rowCount: 1 });

    await commitPayPal(operation.id, operation.user_id);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.wallet).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("reconcile_paypal"))).toBe(true);
  });

  it("does not send money when a concurrent worker already claimed PREPARED", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.query.mockResolvedValue({ rows: [operation] });
    const txQuery = vi.fn(async (sql: string) => {
      if (sql.includes("FROM payment_connections")) return { rows: [{ status: "ACTIVE", environment: "sandbox", merchant_id: "merchant-1" }] };
      if (sql.includes("SELECT i.state AS intent_state")) return { rows: [validContext()] };
      if (sql.includes("COUNT(*)::int")) return { rows: [{ n: 1 }] };
      if (sql.includes("state = 'SENT'")) return { rows: [], rowCount: 0 };
      if (sql.includes("state = 'NO_PAYMENT'")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    mocks.connect.mockResolvedValue({ query: txQuery, release: vi.fn() });

    await commitPayPal(operation.id, operation.user_id);

    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes("state = 'SENT'"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops a revoked approval before a Sandbox request leaves the worker", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.query.mockResolvedValue({ rows: [operation] });
    const txQuery = vi.fn(async (sql: string) => {
      if (sql.includes("FROM payment_connections")) return { rows: [{ status: "ACTIVE", environment: "sandbox", merchant_id: "merchant-1" }] };
      if (sql.includes("SELECT i.state AS intent_state")) {
        return { rows: [{ ...validContext(), permission_status: "REVOKED" }] };
      }
      return { rows: [{ id: operation.id }], rowCount: 1 };
    });
    mocks.connect.mockResolvedValue({ query: txQuery, release: vi.fn() });

    await commitPayPal(operation.id, operation.user_id);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes("state = 'NO_PAYMENT'"))).toBe(true);
    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes("state = 'NEEDS_USER'"))).toBe(true);
  });

  it("treats a Sandbox create HTTP error after send as an unknown outcome", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/v1/oauth2/token")
      ? new Response(JSON.stringify({ access_token: "sandbox-token", expires_in: 3600 }), { status: 200 })
      : new Response(JSON.stringify({ name: "UNPROCESSABLE_ENTITY" }), { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.query.mockResolvedValue({ rows: [operation] });
    const txQuery = vi.fn(async (sql: string) => {
      if (sql.includes("FROM payment_connections")) return { rows: [{ status: "ACTIVE", environment: "sandbox", merchant_id: "merchant-1" }] };
      if (sql.includes("SELECT i.state AS intent_state")) return { rows: [validContext()] };
      if (sql.includes("COUNT(*)::int")) return { rows: [{ n: 1 }] };
      return { rows: [{ id: operation.id }], rowCount: 1 };
    });
    mocks.connect.mockResolvedValue({ query: txQuery, release: vi.fn() });

    await commitPayPal(operation.id, operation.user_id);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes("state = 'SENT'"))).toBe(true);
    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes("state = 'OUTCOME_UNKNOWN'"))).toBe(true);
    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes("reconcile_paypal"))).toBe(true);
    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes("state = 'NO_PAYMENT'"))).toBe(false);
  });

  it("rechecks the lease after OAuth and stops before the financial POST", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "sandbox-token", expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.query.mockResolvedValue({ rows: [operation] });
    let contextReads = 0;
    const txQuery = vi.fn(async (sql: string) => {
      if (sql.includes("FROM payment_connections")) return { rows: [{ status: "ACTIVE", environment: "sandbox", merchant_id: "merchant-1" }] };
      if (sql.includes("SELECT i.state AS intent_state")) {
        contextReads += 1;
        return { rows: [{ ...validContext(), lease_until: new Date(Date.now() + (contextReads === 1 ? 60_000 : -1_000)) }] };
      }
      if (sql.includes("COUNT(*)::int")) return { rows: [{ n: 1 }] };
      return { rows: [{ id: operation.id }], rowCount: 1 };
    });
    mocks.connect.mockResolvedValue({ query: txQuery, release: vi.fn() });

    await commitPayPal(operation.id, operation.user_id);

    expect(contextReads).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1); // OAuth only; no create-order POST.
    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes("state = 'NO_PAYMENT'"))).toBe(true);
    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes("state = 'OUTCOME_UNKNOWN'"))).toBe(false);
  });

  it("stops same-ID replay after documented key retention and requests manual investigation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.query.mockImplementation(async (sql: string) => sql.includes("SELECT op.*")
      ? { rows: [{ ...operation, state: "OUTCOME_UNKNOWN", created_at: new Date(Date.now() - 6 * 60 * 60 * 1000) }] }
      : { rows: [], rowCount: 1 });

    await reconcilePayPal(operation.id, operation.user_id);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.wallet).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.some(([sql, params]) => String(sql).includes("UPDATE purchase_intents") && String(params?.[1]).includes("request-ID retention elapsed"))).toBe(true);
  });
});
