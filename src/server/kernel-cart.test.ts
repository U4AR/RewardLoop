import { afterAll, describe, expect, it, vi } from "vitest";
import { assertKernelCartIntent, prepareKernelCart } from "./kernel-cart";

// The project runs Vitest without per-file isolation. Keep this module's real
// configuration import from leaking into older tests that mock getConfig.
afterAll(() => vi.resetModules());

function eligibleIntent() {
  return {
    id: "intent-1", user_id: "owner-1", state: "BUYER_APPROVAL_REQUIRED",
    quote_id: null, store_session_id: null, goal_status: "ACTIVE", goal_version: 1,
    rubric_version: 1, permission_status: "ACTIVE", permission_goal_version: 1,
    permission_rubric_version: 1, primary_sku: "FOCUS-1",
    approved_variants: { "FOCUS-1": "standard" }, seller: "RewardLoop Demo Store",
    synthetic_destination_id: "demo-us-address", total_cap_minor: 4000,
    product_sku: "FOCUS-1", product_variant: "standard",
    product_seller: "RewardLoop Demo Store", price_minor: 3499,
    shipping_minor: 0, tax_minor: 200, available: true,
  };
}

describe("Kernel cart preparation gate", () => {
  it("accepts only the owner's unquoted approved cart under the cap", () => {
    expect(() => assertKernelCartIntent(eligibleIntent(), "owner-1")).not.toThrow();
    expect(() => assertKernelCartIntent(eligibleIntent(), "other-owner")).toThrow("KERNEL_PRECONDITION_CHANGED");
    expect(() => assertKernelCartIntent({ ...eligibleIntent(), quote_id: "quote-1" }, "owner-1")).toThrow();
    expect(() => assertKernelCartIntent({ ...eligibleIntent(), store_session_id: "other-cart" }, "owner-1")).toThrow();
    expect(() => assertKernelCartIntent({ ...eligibleIntent(), permission_status: "REVOKED" }, "owner-1")).toThrow();
    expect(() => assertKernelCartIntent({ ...eligibleIntent(), permission_goal_version: 2 }, "owner-1")).toThrow();
    expect(() => assertKernelCartIntent({ ...eligibleIntent(), product_variant: "large" }, "owner-1")).toThrow();
    expect(() => assertKernelCartIntent({ ...eligibleIntent(), total_cap_minor: 3500 }, "owner-1")).toThrow();
    expect(() => assertKernelCartIntent({ ...eligibleIntent(), state: "COMMITTING" }, "owner-1")).toThrow();
  });

  it("runs the two-session browser only for an unquoted owned intent and binds its exact proof", async () => {
    const order: string[] = [];
    const setup = { storeSessionId: "11111111-1111-4111-8111-111111111111",
      setupCode: "ABCDEFGHIJKLMNOPQRSTUVWX", storeUrl: "https://store.rewardloop-demo.com/store",
      expiresAt: new Date().toISOString(), accountLabel: "demo", syntheticOnly: true as const };
    const browserProof = { writerSessionId: "writer", readerSessionId: "reader",
      storeSessionId: setup.storeSessionId, sku: "FOCUS-1" };
    const createSetup = vi.fn(async () => { order.push("setup"); return setup; });
    const runBrowser = vi.fn(async () => { order.push("browser"); return browserProof; });
    const bindCart = vi.fn(async () => { order.push("bind"); return { intentId: "intent-1",
      storeSessionId: setup.storeSessionId, sku: "FOCUS-1", bound: true as const }; });
    await prepareKernelCart("intent-1", "owner-1", {
      config: { KERNEL_API_KEY: "fake", APP_ORIGIN: "https://app.rewardloop-demo.com",
        MOCK_STORE_ORIGIN: "https://store.rewardloop-demo.com" },
      getIntent: async () => eligibleIntent(), hasPaymentOperation: async () => false,
      createSetup, runBrowser, bindCart,
    });
    expect(order).toEqual(["setup", "browser", "bind"]);
    expect(runBrowser).toHaveBeenCalledWith(expect.objectContaining({
      storeSessionId: setup.storeSessionId, setupCode: setup.setupCode, sku: "FOCUS-1",
    }));
    expect(bindCart).toHaveBeenCalledWith("owner-1", { storeSessionId: setup.storeSessionId }, {
      expectedIntentId: "intent-1", requireUnbound: true, kernelProof: browserProof,
    });
  });

  it("does not issue a store code when the intent has a payment operation", async () => {
    const createSetup = vi.fn();
    await expect(prepareKernelCart("intent-1", "owner-1", {
      config: { KERNEL_API_KEY: "fake", APP_ORIGIN: "https://app.rewardloop-demo.com",
        MOCK_STORE_ORIGIN: "https://store.rewardloop-demo.com" },
      getIntent: async () => eligibleIntent(), hasPaymentOperation: async () => true,
      createSetup,
    })).rejects.toMatchObject({ code: "KERNEL_PRECONDITION_CHANGED" });
    expect(createSetup).not.toHaveBeenCalled();
  });
});
