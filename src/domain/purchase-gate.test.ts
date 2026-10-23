import { describe, expect, it } from "vitest";
import { evaluatePurchaseGate, type GateCode, type GateInput } from "./purchase-gate";

function approvedPurchase(): GateInput {
  return {
    runtime: "hackathon",
    paymentHost: "https://api-m.sandbox.paypal.com",
    actorUserId: "buyer-1",
    intentUserId: "buyer-1",
    goal: { version: 2, rubricVersion: 3, qualified: true, status: "ACTIVE" },
    permission: {
      userId: "buyer-1",
      goalVersion: 2,
      rubricVersion: 3,
      status: "ACTIVE",
      primarySku: "notebook-navy",
      alternativeSkus: ["desk-lamp"],
      approvedVariants: { "notebook-navy": "navy", "desk-lamp": "white" },
      seller: "RewardLoop Demo Store",
      quantity: 1,
      currency: "USD",
      destinationId: "demo-us-address",
      totalCapMinor: 5000,
      earliestDate: "2026-10-07",
      latestDate: "2026-11-06",
      unattendedSandboxApproved: true,
      executionMode: "paypal_sandbox",
    },
    intent: { state: "READY_TO_COMMIT", captureId: null, leaseValid: true },
    quote: {
      sku: "notebook-navy",
      variant: "navy",
      seller: "RewardLoop Demo Store",
      quantity: 1,
      currency: "USD",
      destinationId: "demo-us-address",
      totalMinor: 4500,
      fresh: true,
      inventoryVersionMatches: true,
      extraItems: false,
    },
    businessDate: "2026-10-07",
    paymentConnectionReady: true,
    fixtureModeAllowed: false,
  };
}

function expectDenied(input: GateInput, code: GateCode) {
  expect(evaluatePurchaseGate(input)).toEqual({ allowed: false, code });
}

describe("deterministic purchase gate", () => {
  it("allows an exact primary or expressly approved alternative at the cap", () => {
    const primary = approvedPurchase();
    primary.quote.totalMinor = primary.permission.totalCapMinor;
    expect(evaluatePurchaseGate(primary)).toEqual({ allowed: true });

    const alternative = approvedPurchase();
    alternative.quote.sku = "desk-lamp";
    alternative.quote.variant = "white";
    expect(evaluatePurchaseGate(alternative)).toEqual({ allowed: true });
  });

  it("rejects a variant that is not approved for its exact SKU", () => {
    const changedPrimary = approvedPurchase();
    changedPrimary.quote.variant = "red";
    expectDenied(changedPrimary, "WRONG_VARIANT");

    const changedAlternative = approvedPurchase();
    changedAlternative.quote.sku = "desk-lamp";
    changedAlternative.quote.variant = "black";
    expectDenied(changedAlternative, "WRONG_VARIANT");

    const missingVariantApproval = approvedPurchase();
    missingVariantApproval.quote.sku = "desk-lamp";
    missingVariantApproval.quote.variant = "white";
    delete missingVariantApproval.permission.approvedVariants["desk-lamp"];
    expectDenied(missingVariantApproval, "WRONG_VARIANT");
  });

  const quoteChanges: Array<{ name: string; code: GateCode; change: (input: GateInput) => void }> = [
    { name: "an unapproved item", code: "WRONG_SKU", change: (input) => { input.quote.sku = "unapproved-sku"; } },
    { name: "a different seller", code: "WRONG_SELLER", change: (input) => { input.quote.seller = "Other Store"; } },
    { name: "more than one item", code: "WRONG_QUANTITY", change: (input) => { input.quote.quantity = 2; } },
    { name: "a non-USD currency", code: "WRONG_CURRENCY", change: (input) => { input.quote.currency = "EUR"; } },
    { name: "a different destination", code: "WRONG_DESTINATION", change: (input) => { input.quote.destinationId = "other-address"; } },
    { name: "unrelated cart items", code: "EXTRA_ITEMS", change: (input) => { input.quote.extraItems = true; } },
    { name: "an over-cap all-in total", code: "OVER_CAP", change: (input) => { input.quote.totalMinor = 5001; } },
    { name: "a fractional-cent total", code: "OVER_CAP", change: (input) => { input.quote.totalMinor = 4500.5; } },
    { name: "an expired quote", code: "STALE_QUOTE", change: (input) => { input.quote.fresh = false; } },
    { name: "a repriced inventory version", code: "STALE_QUOTE", change: (input) => { input.quote.inventoryVersionMatches = false; } },
  ];

  for (const scenario of quoteChanges) {
    it(`rejects ${scenario.name} before payment`, () => {
      const input = approvedPurchase();
      scenario.change(input);
      expectDenied(input, scenario.code);
    });
  }

  it("blocks a different actor or a permission owned by another user", () => {
    const actor = approvedPurchase();
    actor.actorUserId = "buyer-2";
    expectDenied(actor, "WRONG_OWNER");

    const permission = approvedPurchase();
    permission.permission.userId = "buyer-2";
    expectDenied(permission, "WRONG_OWNER");
  });

  it("requires the exact Sandbox REST host even in a fixture run", () => {
    const live = approvedPurchase();
    live.permission.executionMode = "fixture";
    live.fixtureModeAllowed = true;
    live.paymentHost = "https://api-m.paypal.com";
    expectDenied(live, "LIVE_PAYMENT_FORBIDDEN");

    const lookalike = approvedPurchase();
    lookalike.paymentHost = "https://api-m.sandbox.paypal.com.evil.example";
    expectDenied(lookalike, "LIVE_PAYMENT_FORBIDDEN");
  });

  it("requires USD even if the permission and quote both name another currency", () => {
    const input = approvedPurchase();
    input.permission.currency = "EUR";
    input.quote.currency = "EUR";
    expectDenied(input, "WRONG_CURRENCY");
  });

  it("requires the current qualified goal and an active permission", () => {
    const incomplete = approvedPurchase();
    incomplete.goal.qualified = false;
    expectDenied(incomplete, "GOAL_NOT_QUALIFIED");

    const changedRule = approvedPurchase();
    changedRule.goal.rubricVersion = 4;
    expectDenied(changedRule, "GOAL_VERSION_CHANGED");

    const revoked = approvedPurchase();
    revoked.permission.status = "REVOKED";
    expectDenied(revoked, "PERMISSION_INACTIVE");

    const paused = approvedPurchase();
    paused.goal.status = "PAUSED";
    expectDenied(paused, "PERMISSION_INACTIVE");
  });

  it("opens on the first allowed date and closes on the exclusive final date", () => {
    const before = approvedPurchase();
    before.businessDate = "2026-10-06";
    expectDenied(before, "WINDOW_CLOSED");

    const lastAllowed = approvedPurchase();
    lastAllowed.businessDate = "2026-11-05";
    expect(evaluatePurchaseGate(lastAllowed)).toEqual({ allowed: true });

    const endExclusive = approvedPurchase();
    endExclusive.businessDate = "2026-11-06";
    expectDenied(endExclusive, "WINDOW_CLOSED");
  });

  it("does not commit after capture, from the wrong state, or with a lost lease", () => {
    const captured = approvedPurchase();
    captured.intent.captureId = "sandbox-capture-1";
    expectDenied(captured, "ALREADY_PURCHASED");

    const pending = approvedPurchase();
    pending.intent.state = "OUTCOME_UNKNOWN";
    expectDenied(pending, "WRONG_STATE");

    const leaseLost = approvedPurchase();
    leaseLost.intent.leaseValid = false;
    expectDenied(leaseLost, "LEASE_LOST");
  });

  it("allows a clearly enabled fixture path without a wallet, but never when fixtures are disabled", () => {
    const fixture = approvedPurchase();
    fixture.permission.executionMode = "fixture";
    fixture.permission.unattendedSandboxApproved = false;
    fixture.paymentConnectionReady = false;
    expectDenied(fixture, "PAYMENT_NOT_READY");
    fixture.fixtureModeAllowed = true;
    expect(evaluatePurchaseGate(fixture)).toEqual({ allowed: true });
  });

  it("requires both prior user approval and a ready Sandbox wallet for unattended payment", () => {
    const noApproval = approvedPurchase();
    noApproval.permission.unattendedSandboxApproved = false;
    expectDenied(noApproval, "PAYMENT_NOT_READY");

    const noWallet = approvedPurchase();
    noWallet.paymentConnectionReady = false;
    expectDenied(noWallet, "PAYMENT_NOT_READY");
  });
});
