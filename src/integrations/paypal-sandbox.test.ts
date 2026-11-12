import { describe, expect, it, vi } from "vitest";
import {
  assessSandboxOrder,
  PayPalSandboxClient,
  PAYPAL_SANDBOX_API_BASE_URL,
  sandboxBuyerApprovalUrl,
  usdFromCents,
} from "./paypal-sandbox.js";

const merchantId = "M123456789012";
const token = { access_token: "sandbox-oauth-token", expires_in: 32400 };

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function order(status: string, captures: unknown[] = [], amount = "12.34", payeeMerchantId = merchantId) {
  return {
    id: "1AB23456CD789012E",
    status,
    purchase_units: [{
      reference_id: "purchase_1",
      payee: { merchant_id: payeeMerchantId },
      amount: { currency_code: "USD", value: amount },
      payments: { captures },
    }],
  };
}

function completedCapture(amount = "12.34") {
  return {
    id: "9XY87654VU321098Z",
    status: "COMPLETED",
    amount: { currency_code: "USD", value: amount },
  };
}

function client(fetchImpl: typeof fetch) {
  return new PayPalSandboxClient({
    clientId: "sandbox-client-id",
    clientSecret: "sandbox-client-secret",
    apiBaseUrl: PAYPAL_SANDBOX_API_BASE_URL,
    merchantId,
    fetchImpl,
  });
}

describe("PayPal Sandbox isolation", () => {
  it.each([
    "https://api-m.paypal.com",
    "http://api-m.sandbox.paypal.com",
    "https://api-m.sandbox.paypal.com.evil.example",
    "https://api-m.sandbox.paypal.com/v1",
  ])("rejects unsafe API base %s", (apiBaseUrl) => {
    expect(() => new PayPalSandboxClient({
      clientId: "id", clientSecret: "secret", apiBaseUrl,
    })).toThrow("canonical Sandbox base URL");
  });

  it("formats integer US cents without floating-point rounding", () => {
    expect(usdFromCents(1234)).toBe("12.34");
    expect(usdFromCents(5)).toBe("0.05");
    expect(() => usdFromCents(0.1)).toThrow();
  });
});

describe("Orders v2 saved-wallet payment", () => {
  it("creates a fresh buyer-approved Sandbox order without a vault token", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).endsWith("/v1/oauth2/token")) return json(token);
      if (String(url).endsWith("/v2/checkout/orders")) return json({
        ...order("PAYER_ACTION_REQUIRED"),
        links: [{ href: "https://www.sandbox.paypal.com/checkoutnow?token=1AB23456CD789012E",
          rel: "payer-action", method: "GET" }],
      }, 201);
      throw new Error("unexpected request");
    });
    const result = await client(fetchMock as typeof fetch).createFreshOrder({
      totalCents: 1234, referenceId: "purchase_1", requestId: "fresh-operation-uuid-1",
      returnUrl: "http://localhost:3000/?paypal_fresh=approved",
      cancelUrl: "http://localhost:3000/?paypal_fresh=canceled",
    });
    expect(result).toMatchObject({
      orderId: "1AB23456CD789012E", state: "NEEDS_USER",
      approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=1AB23456CD789012E",
    });
    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(String(init?.body));
    expect(body.payment_source).toEqual({ paypal: { experience_context: {
      return_url: "http://localhost:3000/?paypal_fresh=approved",
      cancel_url: "http://localhost:3000/?paypal_fresh=canceled",
      user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING",
    } } });
    expect(body.purchase_units[0]).toMatchObject({
      reference_id: "purchase_1", payee: { merchant_id: merchantId },
      amount: { currency_code: "USD", value: "12.34" },
    });
    expect(init?.headers).toMatchObject({ "PayPal-Request-Id": "fresh-operation-uuid-1" });
  });

  it.each([
    "https://www.paypal.com/checkoutnow?token=1AB23456CD789012E",
    "https://www.sandbox.paypal.com.evil.test/checkoutnow?token=1AB23456CD789012E",
    "http://www.sandbox.paypal.com/checkoutnow?token=1AB23456CD789012E",
    "https://www.sandbox.paypal.com/checkoutnow?token=DIFFERENT",
    "https://www.sandbox.paypal.com/checkoutnow?token=1AB23456CD789012E&next=https://evil.test",
  ])("rejects an unsafe Sandbox approval link %s", (href) => {
    expect(() => sandboxBuyerApprovalUrl({ links: [{ rel: "payer-action", method: "GET", href }] },
      "1AB23456CD789012E")).toThrow("Invalid Sandbox approval link");
  });
  it("sends a frozen USD create request with a caller-provided idempotency ID and detects auto-capture", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/v1/oauth2/token")) return json(token);
      if (String(url).endsWith("/v2/checkout/orders")) return json(order("COMPLETED", [completedCapture()]), 201);
      throw new Error("unexpected request");
    });
    const result = await client(fetchMock as typeof fetch).createOrder({
      totalCents: 1234,
      vaultId: "vault_123",
      referenceId: "purchase_1",
      requestId: "create-operation-uuid-1",
    });
    expect(result).toMatchObject({ state: "CONFIRMED", captureId: "9XY87654VU321098Z" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe(`${PAYPAL_SANDBOX_API_BASE_URL}/v2/checkout/orders`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "PayPal-Request-Id": "create-operation-uuid-1",
      Prefer: "return=representation",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: "purchase_1",
        payee: { merchant_id: merchantId },
        amount: { currency_code: "USD", value: "12.34" },
      }],
      payment_source: { paypal: { vault_id: "vault_123" } },
    });
  });

  it("verifies merchant and amount through GET capture when PayPal omits them from the order", async () => {
    const sparseOrder = {
      id: "1AB23456CD789012E",
      status: "COMPLETED",
      purchase_units: [{
        reference_id: "purchase_1",
        payments: { captures: [completedCapture()] },
      }],
    };
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).endsWith("/v1/oauth2/token")) return json(token);
      if (String(url).endsWith("/v2/checkout/orders")) return json(sparseOrder, 201);
      if (String(url).endsWith("/v2/payments/captures/9XY87654VU321098Z")) {
        return json({
          ...completedCapture(),
          payee: { merchant_id: merchantId },
          supplementary_data: { related_ids: { order_id: "1AB23456CD789012E" } },
        });
      }
      throw new Error("unexpected request");
    });
    const result = await client(fetchMock as typeof fetch).createOrder({
      totalCents: 1234,
      vaultId: "vault_123",
      referenceId: "purchase_1",
      requestId: "create-operation-uuid-1",
    });
    expect(result).toMatchObject({ state: "CONFIRMED", captureId: "9XY87654VU321098Z" });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/capture"))).toHaveLength(0);
  });

  it("does not call capture when a fresh GET already shows a completed capture", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).endsWith("/v1/oauth2/token")) return json(token);
      if (String(url).endsWith("/v2/checkout/orders/1AB23456CD789012E")) {
        return json(order("COMPLETED", [completedCapture()]));
      }
      throw new Error("capture should not be called");
    });
    const result = await client(fetchMock as typeof fetch).captureOrder({
      orderId: "1AB23456CD789012E",
      expectedTotalCents: 1234,
      referenceId: "purchase_1",
      requestId: "capture-operation-uuid-2",
    });
    expect(result.state).toBe("CONFIRMED");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/capture"))).toBe(false);
  });

  it("captures an approved uncaptured order using a distinct stable request ID", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).endsWith("/v1/oauth2/token")) return json(token);
      if (String(url).endsWith("/v2/checkout/orders/1AB23456CD789012E")) return json(order("APPROVED"));
      if (String(url).endsWith("/capture")) return json(order("COMPLETED", [completedCapture()]));
      throw new Error("unexpected request");
    });
    const result = await client(fetchMock as typeof fetch).captureOrder({
      orderId: "1AB23456CD789012E",
      expectedTotalCents: 1234,
      referenceId: "purchase_1",
      requestId: "capture-operation-uuid-2",
    });
    expect(result.state).toBe("CONFIRMED");
    const captureCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/capture"));
    expect(captureCall?.[1]?.headers).toMatchObject({ "PayPal-Request-Id": "capture-operation-uuid-2" });
  });

  it("refuses to capture an approved order whose payee cannot be verified", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/v1/oauth2/token")) return json(token);
      if (String(url).endsWith("/v2/checkout/orders/1AB23456CD789012E")) {
        return json({
          id: "1AB23456CD789012E", status: "APPROVED",
          purchase_units: [{ reference_id: "purchase_1", amount: { currency_code: "USD", value: "12.34" } }],
        });
      }
      throw new Error("capture should not be called");
    });
    await expect(client(fetchMock as typeof fetch).captureOrder({
      orderId: "1AB23456CD789012E", expectedTotalCents: 1234,
      referenceId: "purchase_1", requestId: "capture-operation-uuid-2",
    })).rejects.toThrow("MISSING_PAYEE");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/capture"))).toBe(false);
  });

  it("fails closed on wrong merchant, amount, multiple captures, or missing merchant configuration", () => {
    expect(assessSandboxOrder(order("COMPLETED", [completedCapture()], "12.34", "WRONG"), 1234, merchantId))
      .toMatchObject({ state: "OUTCOME_UNKNOWN", reason: "MERCHANT_MISMATCH" });
    expect(assessSandboxOrder(order("COMPLETED", [completedCapture("12.35")]), 1234, merchantId))
      .toMatchObject({ state: "OUTCOME_UNKNOWN", reason: "AMOUNT_MISMATCH" });
    expect(assessSandboxOrder(order("COMPLETED", [completedCapture(), completedCapture()]), 1234, merchantId))
      .toMatchObject({ state: "OUTCOME_UNKNOWN", reason: "MULTIPLE_CAPTURES" });
    expect(assessSandboxOrder(order("COMPLETED", [completedCapture()]), 1234))
      .toMatchObject({ state: "OUTCOME_UNKNOWN", reason: "MISSING_MERCHANT_ID" });
    expect(assessSandboxOrder(order("COMPLETED", [completedCapture()]), 1234, merchantId, "different_intent"))
      .toMatchObject({ state: "OUTCOME_UNKNOWN", reason: "REFERENCE_MISMATCH" });
  });

  it("keeps a pending capture out of the confirmed state", () => {
    expect(assessSandboxOrder(order("PENDING", [{
      id: "9XY87654VU321098Z",
      status: "PENDING",
      amount: { currency_code: "USD", value: "12.34" },
    }]), 1234, merchantId)).toMatchObject({ state: "PAYMENT_PENDING" });
  });
});

describe("vault setup", () => {
  it("uses MERCHANT/CONSUMER and exchanges an approved setup token", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).endsWith("/v1/oauth2/token")) return json(token);
      if (String(url).endsWith("/v3/vault/setup-tokens")) return json({ id: "setup_123", status: "PAYER_ACTION_REQUIRED" }, 201);
      if (String(url).endsWith("/v3/vault/payment-tokens")) {
        return json({ id: "vault_456", customer: { id: "customer_789" } }, 201);
      }
      throw new Error("unexpected request");
    });
    const paypal = client(fetchMock as typeof fetch);
    const setup = await paypal.createVaultSetupToken({
      requestId: "setup-operation-uuid-3",
      returnUrl: "https://example.test/return",
      cancelUrl: "https://example.test/cancel",
    });
    expect(setup).toEqual({ setupTokenId: "setup_123", status: "PAYER_ACTION_REQUIRED" });
    const setupCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/setup-tokens"));
    expect(JSON.parse(String(setupCall?.[1]?.body))).toMatchObject({
      payment_source: { paypal: { usage_type: "MERCHANT", customer_type: "CONSUMER" } },
    });
    const payment = await paypal.exchangeApprovedSetupToken({
      requestId: "token-operation-uuid-4",
      setupTokenId: setup.setupTokenId,
    });
    expect(payment).toEqual({ paymentTokenId: "vault_456", customerId: "customer_789" });
    const paymentCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/payment-tokens"));
    expect(JSON.parse(String(paymentCall?.[1]?.body))).toMatchObject({
      payment_source: { token: { id: "setup_123", type: "SETUP_TOKEN" } },
    });
  });
});
