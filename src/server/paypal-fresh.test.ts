import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), config: vi.fn() }));
vi.mock("../db/client", () => ({ getPool: () => ({ query: mocks.query, connect: mocks.connect }) }));
vi.mock("../config", () => ({ getConfig: mocks.config }));

import { captureFreshCheckoutOrder, createFreshCheckoutOrder } from "./paypal-fresh";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockReturnValue({
    PAYPAL_API_BASE_URL: "https://api-m.sandbox.paypal.com",
    PAYPAL_SANDBOX_CLIENT_ID: "sandbox-id",
    PAYPAL_SANDBOX_CLIENT_SECRET: "sandbox-secret",
    PAYPAL_SANDBOX_MERCHANT_ID: "sandbox-merchant",
  });
});

describe("fresh PayPal Sandbox approval", () => {
  it("parks an expired existing order without replacing its frozen quote or order ID", async () => {
    const intent = {
      id: "intent-1", user_id: "user-1", permission_id: "permission-1", goal_id: "goal-1",
      state: "BUYER_APPROVAL_PENDING", order_id: "sandbox-order-1", quote_id: "quote-1",
      store_session_id: "bound-session-1", lease_until: new Date(Date.now() - 1_000),
    };
    const txQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT i.* FROM purchase_intents")) return { rows: [intent] };
      if (sql.includes("FROM purchase_permissions WHERE")) return { rows: [{ id: "permission-1", status: "ACTIVE" }] };
      if (sql.includes("FROM goals WHERE")) return { rows: [{ id: "goal-1", status: "ACTIVE" }] };
      if (sql.includes("FROM mock_quotes")) return { rows: [{ id: "quote-1", status: "RESERVED", expires_at: new Date(Date.now() - 1_000) }] };
      if (sql.includes("FROM mock_store_sessions")) {
        expect(params).toEqual(["bound-session-1", "user-1"]);
        return { rows: [{ store_session_id: "bound-session-1", sku: "FOCUS-1", destination_id: "demo-us-address" }] };
      }
      if (sql.includes("FROM demo_products")) return { rows: [{ sku: "FOCUS-1", available: true }] };
      if (sql.includes("FROM payment_operations")) return { rows: [{ payload: { storeSessionId: "bound-session-1" } }] };
      return { rows: [], rowCount: 1 };
    });
    mocks.connect.mockResolvedValue({ query: txQuery, release: vi.fn() });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createFreshCheckoutOrder("user-1")).rejects.toMatchObject({ code: "EXISTING_SANDBOX_ORDER_REQUIRES_REVIEW" });

    const park = txQuery.mock.calls.find(([sql]) => String(sql).includes("SET state = 'NEEDS_USER'"));
    expect(park).toBeDefined();
    expect(String(park?.[0])).not.toMatch(/order_id\s*=|quote_id\s*=/);
    expect(txQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO payment_operations"))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("never asks PayPal to capture an order not bound to the authenticated buyer", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(captureFreshCheckoutOrder("user-1", "someone-elses-order"))
      .rejects.toMatchObject({ code: "ORDER_NOT_BOUND_TO_BUYER" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
