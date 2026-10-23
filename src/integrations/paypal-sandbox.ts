/**
 * Server-only PayPal Sandbox adapter. The domain purchase gate must authorize and
 * persist a frozen operation (payload + PayPal-Request-Id) before calling here.
 * No method retries a financial mutation or follows a URL returned by PayPal.
 *
 * API references:
 * https://developer.paypal.com/api/rest/authentication/
 * https://developer.paypal.com/api/payment-tokens/v3/setup-tokens-create
 * https://developer.paypal.com/api/payment-tokens/v3/payment-tokens-create
 * https://developer.paypal.com/api/orders/v2/orders-create
 * https://developer.paypal.com/api/orders/v2/orders-capture
 * https://developer.paypal.com/api/rest/reference/idempotency/
 */

export const PAYPAL_SANDBOX_API_BASE_URL = "https://api-m.sandbox.paypal.com";

type JsonRecord = Record<string, unknown>;
type HttpMethod = "GET" | "POST" | "DELETE";

export interface PayPalSandboxConfig {
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
  /** The actual US Business Sandbox account's PayPal merchant ID. */
  merchantId?: string;
  /** Injection point for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface CreateSandboxOrderInput {
  /** Trusted all-in quote amount, in integer US cents. */
  totalCents: number;
  /** Server-owned durable PayPal payment token, never supplied by the browser. */
  vaultId: string;
  /** Stable local purchase intent or operation reference. */
  referenceId: string;
  /** Persisted before POST and reused with the identical payload on retry. */
  requestId: string;
  customId?: string;
  clientMetadataId?: string;
  beforeFinancialPost?: () => Promise<void>;
}

export interface CreateFreshSandboxOrderInput {
  totalCents: number;
  referenceId: string;
  requestId: string;
  beforeFinancialPost?: () => Promise<void>;
}

export interface CaptureSandboxOrderInput {
  orderId: string;
  expectedTotalCents: number;
  referenceId: string;
  /** A separate persisted ID from the create-order request. */
  requestId: string;
  clientMetadataId?: string;
  beforeFinancialPost?: () => Promise<void>;
}

export interface GetSandboxOrderInput {
  orderId: string;
  expectedTotalCents: number;
  referenceId: string;
}

export interface CreateVaultSetupTokenInput {
  requestId: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface ExchangeApprovedSetupTokenInput {
  requestId: string;
  setupTokenId: string;
}

export type SandboxOrderState =
  | "CONFIRMED"
  | "READY_TO_CAPTURE"
  | "NEEDS_USER"
  | "PAYMENT_PENDING"
  | "OUTCOME_UNKNOWN"
  | "FAILED";

export interface SandboxOrderAssessment {
  orderId: string;
  orderStatus: string;
  state: SandboxOrderState;
  captureId?: string;
  captureStatus?: string;
  /** Explains a fail-closed result without exposing provider PII. */
  reason?:
    | "MISSING_MERCHANT_ID"
    | "MERCHANT_MISMATCH"
    | "MISSING_PAYEE"
    | "AMOUNT_MISMATCH"
    | "REFERENCE_MISMATCH"
    | "MULTIPLE_PURCHASE_UNITS"
    | "MULTIPLE_CAPTURES"
    | "NO_COMPLETED_CAPTURE"
    | "PROVIDER_STATUS";
}

export class PayPalSandboxError extends Error {
  readonly status?: number;
  readonly providerName?: string;
  readonly debugId?: string;

  constructor(message: string, details: { status?: number; providerName?: string; debugId?: string } = {}) {
    super(message);
    this.name = "PayPalSandboxError";
    this.status = details.status;
    this.providerName = details.providerName;
    this.debugId = details.debugId;
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function assertId(value: string, label: string, maxLength = 108): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PayPalSandboxError(`Invalid ${label}`);
  }
  return value;
}

function assertRequestId(value: string): string {
  return assertId(value, "PayPal-Request-Id");
}

function assertCents(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PayPalSandboxError("Amount must be a positive, safe integer number of US cents");
  }
  return value;
}

export function usdFromCents(cents: number): string {
  assertCents(cents);
  const dollars = Math.floor(cents / 100);
  return `${dollars}.${String(cents % 100).padStart(2, "0")}`;
}

function parseUsdCents(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)\.\d{2}$/.test(value)) return undefined;
  const [dollars, cents] = value.split(".");
  const parsed = Number(dollars) * 100 + Number(cents);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Orders v2 can return a completed capture from the CREATE call when the vaulted
 * wallet permits it. Only a matched, completed capture is proof of payment.
 */
export function assessSandboxOrder(
  value: unknown,
  expectedTotalCents: number,
  expectedMerchantId?: string,
  expectedReferenceId?: string,
): SandboxOrderAssessment {
  assertCents(expectedTotalCents);
  const order = asRecord(value);
  const orderId = asString(order?.id);
  const orderStatus = asString(order?.status);
  if (!orderId || !orderStatus) {
    throw new PayPalSandboxError("PayPal returned an order without an ID or status");
  }

  const units = asArray(order?.purchase_units);
  const baseline: SandboxOrderAssessment = { orderId, orderStatus, state: "OUTCOME_UNKNOWN" };
  if (!units || units.length !== 1) {
    return { ...baseline, reason: "MULTIPLE_PURCHASE_UNITS" };
  }
  const unit = asRecord(units[0]);
  if (expectedReferenceId && unit?.reference_id !== expectedReferenceId) {
    return { ...baseline, reason: "REFERENCE_MISMATCH" };
  }
  const payee = asRecord(unit?.payee);
  const merchantId = asString(payee?.merchant_id);
  if (!expectedMerchantId) {
    return { ...baseline, reason: "MISSING_MERCHANT_ID" };
  }
  if (merchantId && merchantId !== expectedMerchantId) {
    return { ...baseline, reason: "MERCHANT_MISMATCH" };
  }

  const amount = asRecord(unit?.amount);
  if (amount && (amount.currency_code !== "USD" || parseUsdCents(amount.value) !== expectedTotalCents)) {
    return { ...baseline, reason: "AMOUNT_MISMATCH" };
  }

  const payments = asRecord(unit?.payments);
  const captures = asArray(payments?.captures) ?? [];
  if (!amount && captures.length === 0) {
    return { ...baseline, reason: "AMOUNT_MISMATCH" };
  }
  if (captures.length > 1) {
    return { ...baseline, reason: "MULTIPLE_CAPTURES" };
  }
  if (captures.length === 1) {
    const capture = asRecord(captures[0]);
    const captureId = asString(capture?.id);
    const captureStatus = asString(capture?.status);
    const captureAmount = asRecord(capture?.amount);
    if (
      captureAmount?.currency_code !== "USD" ||
      parseUsdCents(captureAmount?.value) !== expectedTotalCents
    ) {
      return { ...baseline, reason: "AMOUNT_MISMATCH", captureId, captureStatus };
    }
    if (captureStatus === "COMPLETED" && captureId && orderStatus === "COMPLETED") {
      // PayPal's own saved-wallet example omits payee and order amount in the
      // order response. The client resolves MISSING_PAYEE via GET capture.
      if (!merchantId) {
        return { ...baseline, reason: "MISSING_PAYEE", captureId, captureStatus };
      }
      return { orderId, orderStatus, state: "CONFIRMED", captureId, captureStatus };
    }
    if (captureStatus === "PENDING") {
      return { orderId, orderStatus, state: "PAYMENT_PENDING", captureId, captureStatus };
    }
    if (captureStatus === "DECLINED" || captureStatus === "FAILED") {
      return { orderId, orderStatus, state: "FAILED", captureId, captureStatus };
    }
    return { ...baseline, reason: "NO_COMPLETED_CAPTURE", captureId, captureStatus };
  }

  if (orderStatus === "APPROVED") {
    return { orderId, orderStatus, state: "READY_TO_CAPTURE", ...(!merchantId ? { reason: "MISSING_PAYEE" as const } : {}) };
  }
  if (orderStatus === "PAYER_ACTION_REQUIRED" || orderStatus === "CREATED" || orderStatus === "SAVED") {
    return { orderId, orderStatus, state: "NEEDS_USER" };
  }
  if (orderStatus === "PENDING") return { orderId, orderStatus, state: "PAYMENT_PENDING" };
  if (orderStatus === "VOIDED") return { orderId, orderStatus, state: "FAILED" };
  return { ...baseline, reason: "NO_COMPLETED_CAPTURE" };
}

export class PayPalSandboxClient {
  readonly apiBaseUrl = PAYPAL_SANDBOX_API_BASE_URL;
  readonly merchantId?: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PayPalSandboxConfig) {
    // Compare the whole URL, not a hostname suffix. This rejects live, proxy,
    // HTTP, embedded credentials, and path/query overrides at construction.
    if (config.apiBaseUrl !== PAYPAL_SANDBOX_API_BASE_URL) {
      throw new PayPalSandboxError("PayPal API must use the canonical Sandbox base URL");
    }
    if (!config.clientId || !config.clientSecret) {
      throw new PayPalSandboxError("Sandbox client ID and client secret are required");
    }
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.merchantId = config.merchantId;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Generate a new short-lived id_token for each SDK wallet-setup rendering. */
  async getOAuthToken(includeIdToken = false): Promise<{
    accessToken: string;
    expiresIn: number;
    idToken?: string;
  }> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        ...(includeIdToken ? { response_type: "id_token" } : {}),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const data = await this.readJson(response);
    if (!response.ok) throw this.apiError(response.status, data);
    const accessToken = asString(data.access_token);
    const expiresIn = data.expires_in;
    const idToken = asString(data.id_token);
    if (!accessToken || typeof expiresIn !== "number" || expiresIn <= 0 || (includeIdToken && !idToken)) {
      throw new PayPalSandboxError("PayPal returned an incomplete OAuth token response");
    }
    return { accessToken, expiresIn, ...(includeIdToken ? { idToken } : {}) };
  }

  /** Bounded auth smoke test result with no access token or secret in the output. */
  async probeCredentials(): Promise<{ expiresIn: number }> {
    const token = await this.getOAuthToken();
    return { expiresIn: token.expiresIn };
  }

  async createVaultSetupToken(input: CreateVaultSetupTokenInput): Promise<{ setupTokenId: string; status: string }> {
    const requestId = assertRequestId(input.requestId);
    const returnUrl = new URL(input.returnUrl);
    const cancelUrl = new URL(input.cancelUrl);
    if (!["https:", "http:"].includes(returnUrl.protocol) || !["https:", "http:"].includes(cancelUrl.protocol)) {
      throw new PayPalSandboxError("Vault callback URLs must use HTTP(S)");
    }
    const data = await this.apiRequest("POST", "/v3/vault/setup-tokens", {
      requestId,
      body: {
        payment_source: {
          paypal: {
            usage_type: "MERCHANT",
            customer_type: "CONSUMER",
            usage_pattern: "IMMEDIATE",
            experience_context: {
              return_url: returnUrl.toString(),
              cancel_url: cancelUrl.toString(),
            },
          },
        },
      },
    });
    const setupTokenId = asString(data.id);
    const status = asString(data.status);
    if (!setupTokenId || !status) throw new PayPalSandboxError("PayPal returned an incomplete setup token");
    return { setupTokenId, status };
  }

  /** Caller must bind the approved setup token to its authenticated user first. */
  async exchangeApprovedSetupToken(input: ExchangeApprovedSetupTokenInput): Promise<{
    paymentTokenId: string;
    customerId: string;
  }> {
    const data = await this.apiRequest("POST", "/v3/vault/payment-tokens", {
      requestId: assertRequestId(input.requestId),
      body: {
        payment_source: { token: { id: assertId(input.setupTokenId, "setup token ID"), type: "SETUP_TOKEN" } },
      },
    });
    const paymentTokenId = asString(data.id);
    const customerId = asString(asRecord(data.customer)?.id);
    if (!paymentTokenId || !customerId) {
      throw new PayPalSandboxError("PayPal returned an incomplete payment token");
    }
    return { paymentTokenId, customerId };
  }

  async deletePaymentToken(paymentTokenId: string): Promise<void> {
    await this.apiRequest("DELETE", `/v3/vault/payment-tokens/${encodeURIComponent(assertId(paymentTokenId, "payment token ID", 255))}`);
  }

  async createOrder(input: CreateSandboxOrderInput): Promise<SandboxOrderAssessment> {
    const requestId = assertRequestId(input.requestId);
    const amount = usdFromCents(input.totalCents);
    const referenceId = assertId(input.referenceId, "reference ID", 256);
    const vaultId = assertId(input.vaultId, "vault ID", 255);
    const unit: JsonRecord = {
      reference_id: referenceId,
      amount: { currency_code: "USD", value: amount },
    };
    if (this.merchantId) unit.payee = { merchant_id: this.merchantId };
    if (input.customId) unit.custom_id = assertId(input.customId, "custom ID", 127);
    const data = await this.apiRequest("POST", "/v2/checkout/orders", {
      requestId,
      clientMetadataId: input.clientMetadataId,
      preferRepresentation: true,
      beforeFinancialPost: input.beforeFinancialPost,
      body: {
        intent: "CAPTURE",
        purchase_units: [unit],
        payment_source: { paypal: { vault_id: vaultId } },
      },
    });
    return this.resolveOrder(data, input.totalCents, referenceId);
  }

  /** Standard Checkout: buyer approves this order afresh in PayPal Sandbox. */
  async createFreshOrder(input: CreateFreshSandboxOrderInput): Promise<SandboxOrderAssessment> {
    const requestId = assertRequestId(input.requestId);
    const referenceId = assertId(input.referenceId, "reference ID", 256);
    const unit: JsonRecord = {
      reference_id: referenceId,
      amount: { currency_code: "USD", value: usdFromCents(input.totalCents) },
    };
    if (!this.merchantId) throw new PayPalSandboxError("Sandbox merchant ID is required");
    unit.payee = { merchant_id: this.merchantId };
    const data = await this.apiRequest("POST", "/v2/checkout/orders", {
      requestId,
      preferRepresentation: true,
      beforeFinancialPost: input.beforeFinancialPost,
      body: { intent: "CAPTURE", purchase_units: [unit] },
    });
    return this.resolveOrder(data, input.totalCents, referenceId);
  }

  async getOrder(input: GetSandboxOrderInput): Promise<SandboxOrderAssessment> {
    const orderId = assertId(input.orderId, "order ID", 36);
    const referenceId = assertId(input.referenceId, "reference ID", 256);
    const data = await this.apiRequest("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    return this.resolveOrder(data, input.expectedTotalCents, referenceId);
  }

  /**
   * GET first so an auto-captured CREATE result never triggers a second capture.
   * A persisted capture request ID is still necessary across races and retries.
   */
  async captureOrder(input: CaptureSandboxOrderInput): Promise<SandboxOrderAssessment> {
    const requestId = assertRequestId(input.requestId);
    const current = await this.getOrder({
      orderId: input.orderId,
      expectedTotalCents: input.expectedTotalCents,
      referenceId: input.referenceId,
    });
    if (current.state === "CONFIRMED") return current;
    if (current.state !== "READY_TO_CAPTURE" || current.reason) {
      throw new PayPalSandboxError(`Order is not safe to capture: ${current.reason ?? current.state}`);
    }
    const data = await this.apiRequest("POST", `/v2/checkout/orders/${encodeURIComponent(current.orderId)}/capture`, {
      requestId,
      clientMetadataId: input.clientMetadataId,
      preferRepresentation: true,
      beforeFinancialPost: input.beforeFinancialPost,
      body: {},
    });
    return this.resolveOrder(data, input.expectedTotalCents, input.referenceId);
  }

  /** Fetch the authoritative capture when the order omits payee identity. */
  private async resolveOrder(
    data: JsonRecord,
    expectedTotalCents: number,
    referenceId: string,
  ): Promise<SandboxOrderAssessment> {
    const result = assessSandboxOrder(data, expectedTotalCents, this.merchantId, referenceId);
    if (result.reason !== "MISSING_PAYEE" || result.captureStatus !== "COMPLETED" || !result.captureId) {
      return result;
    }
    const captureId = assertId(result.captureId, "capture ID", 36);
    const capture = await this.apiRequest("GET", `/v2/payments/captures/${encodeURIComponent(captureId)}`);
    const amount = asRecord(capture.amount);
    const payee = asRecord(capture.payee);
    const related = asRecord(asRecord(capture.supplementary_data)?.related_ids);
    if (capture.id !== captureId || capture.status !== "COMPLETED") {
      return { ...result, reason: "NO_COMPLETED_CAPTURE" };
    }
    if (amount?.currency_code !== "USD" || parseUsdCents(amount.value) !== expectedTotalCents) {
      return { ...result, reason: "AMOUNT_MISMATCH" };
    }
    if (payee?.merchant_id !== this.merchantId) {
      return { ...result, reason: "MERCHANT_MISMATCH" };
    }
    if (related?.order_id !== undefined && related.order_id !== result.orderId) {
      return { ...result, reason: "REFERENCE_MISMATCH" };
    }
    return {
      orderId: result.orderId,
      orderStatus: result.orderStatus,
      captureId,
      captureStatus: "COMPLETED",
      state: "CONFIRMED",
    };
  }

  private async apiRequest(
    method: HttpMethod,
    path: string,
    options: {
      requestId?: string;
      clientMetadataId?: string;
      preferRepresentation?: boolean;
      beforeFinancialPost?: () => Promise<void>;
      body?: unknown;
    } = {},
  ): Promise<JsonRecord> {
    const { accessToken } = await this.getOAuthToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.requestId) headers["PayPal-Request-Id"] = options.requestId;
    if (options.preferRepresentation) headers.Prefer = "return=representation";
    if (options.clientMetadataId) {
      headers["PayPal-Client-Metadata-Id"] = assertId(options.clientMetadataId, "client metadata ID", 68);
    }
    // OAuth and any capture GET occur earlier. The trusted server rechecks its
    // quote/lease/window immediately before this financial POST is dispatched.
    if (options.beforeFinancialPost) await options.beforeFinancialPost();
    // Every endpoint is a fixed relative path constructed within this class.
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 204) return {};
    const data = await this.readJson(response);
    if (!response.ok) throw this.apiError(response.status, data);
    return data;
  }

  private async readJson(response: Response): Promise<JsonRecord> {
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new PayPalSandboxError("PayPal returned an unreadable JSON response", { status: response.status });
    }
    const data = asRecord(value);
    if (!data) throw new PayPalSandboxError("PayPal returned a non-object JSON response", { status: response.status });
    return data;
  }

  private apiError(status: number, data: JsonRecord): PayPalSandboxError {
    // Do not echo raw API bodies: they can include payer data or token details.
    const providerName = asString(data.name);
    const debugId = asString(data.debug_id);
    return new PayPalSandboxError(`PayPal Sandbox request failed with HTTP ${status}`, {
      status,
      providerName,
      debugId,
    });
  }
}
