import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const dbQuery = vi.hoisted(() => vi.fn());

vi.mock("../config", () => ({
  getConfig: () => ({
    APP_ORIGIN: "http://localhost:3000",
    PAYPAL_API_BASE_URL: "https://api-m.sandbox.paypal.com",
    PAYPAL_SANDBOX_CLIENT_ID: "sandbox-client-id",
    PAYPAL_SANDBOX_CLIENT_SECRET: "sandbox-client-secret",
    PAYPAL_SANDBOX_MERCHANT_ID: "M123456789012",
    DATA_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  }),
}));
vi.mock("../db/client", () => ({ getPool: () => ({ query: dbQuery }) }));

import {
  decryptVaultId,
  encryptVaultId,
  exchangeApprovedSetupSession,
  readWalletJson,
  requireWalletOrigin,
  validateApprovalPayload,
  WalletError,
} from "./paypal-wallet";

const key = randomBytes(32).toString("base64url");

describe("server-only wallet token protection", () => {
  it("encrypts a durable token with a new nonce and rejects tampering or wrong keys", () => {
    const first = encryptVaultId("sandbox_vault_123", key);
    const second = encryptVaultId("sandbox_vault_123", key);
    expect(first).not.toBe(second);
    expect(first).not.toContain("sandbox_vault_123");
    expect(decryptVaultId(first, key)).toBe("sandbox_vault_123");
    expect(decryptVaultId(second, key)).toBe("sandbox_vault_123");
    expect(() => decryptVaultId(first, randomBytes(32).toString("base64url"))).toThrow("VAULT_CIPHERTEXT_INVALID");
    const pieces = first.split(":");
    pieces[2] = `${pieces[2]![0] === "A" ? "B" : "A"}${pieces[2]!.slice(1)}`;
    expect(() => decryptVaultId(pieces.join(":"), key)).toThrow("VAULT_CIPHERTEXT_INVALID");
  });

  it("requires an actual 32-byte base64url encryption key", () => {
    expect(() => encryptVaultId("sandbox_vault_123", "example-secret")).toThrow("DATA_ENCRYPTION_KEY_INVALID");
  });
});

describe("wallet callback input boundaries", () => {
  it("requires the SDK setup token and a full entropy state", () => {
    const state = randomBytes(32).toString("base64url");
    expect(validateApprovalPayload({ vaultSetupToken: "setup_123", state }))
      .toEqual({ vaultSetupToken: "setup_123", state });
    expect(() => validateApprovalPayload({ vaultSetupToken: "setup_123", state: "short" }))
      .toThrow(WalletError);
    expect(() => validateApprovalPayload({ vaultSetupToken: "../../other", state }))
      .toThrow("WALLET_APPROVAL_INVALID");
  });

  it("rejects cross-origin and missing-origin wallet mutations", () => {
    expect(() => requireWalletOrigin(new Request("http://localhost:3000/api/paypal/sandbox/setup-token", {
      method: "POST", headers: { Origin: "http://localhost:3000" },
    }))).not.toThrow();
    expect(() => requireWalletOrigin(new Request("http://localhost:3000/api/paypal/sandbox/setup-token", {
      method: "POST", headers: { Origin: "https://attacker.example" },
    }))).toThrow("CROSS_ORIGIN_REQUEST");
    expect(() => requireWalletOrigin(new Request("http://localhost:3000/api/paypal/sandbox/setup-token", {
      method: "POST",
    }))).toThrow("CROSS_ORIGIN_REQUEST");
  });

  it("limits callback JSON size and rejects malformed input", async () => {
    const oversized = new Request("http://localhost:3000", { method: "POST", body: "x".repeat(5000) });
    await expect(readWalletJson(oversized)).rejects.toThrow("WALLET_REQUEST_TOO_LARGE");
    const malformed = new Request("http://localhost:3000", { method: "POST", body: "{not json" });
    await expect(readWalletJson(malformed)).rejects.toThrow("WALLET_REQUEST_INVALID_JSON");
  });

  it("cannot exchange a setup token unless the database atomically claims it for this user and state", async () => {
    dbQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const state = randomBytes(32).toString("base64url");
    await expect(exchangeApprovedSetupSession("other-user", {
      vaultSetupToken: "setup_123", state,
    })).rejects.toThrow("WALLET_SETUP_INVALID_OR_CONSUMED");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dbQuery).toHaveBeenCalledTimes(2);
    const [statement, params] = dbQuery.mock.calls[1] as [string, unknown[]];
    expect(statement).toContain("user_id = $1 AND setup_token_id = $2 AND state_hash = $3");
    expect(statement).toContain("status = 'PENDING'");
    expect(statement).toContain("expires_at > NOW()");
    expect(params[0]).toBe("other-user");
    expect(params[1]).toBe("setup_123");
    expect(params[2]).not.toBe(state);
    fetchSpy.mockRestore();
  });
});
