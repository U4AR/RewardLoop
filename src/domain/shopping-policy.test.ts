import { describe, expect, it } from "vitest";
import {
  destinationFingerprint, forbiddenForAgent, maskedDestinationLabel, shipToMatches, validateCheckout, verifyReceipt,
  type CheckoutObservation, type Destination, type PurchaseAuthorization,
} from "./shopping-policy";

const home: Destination = { fullName: "Test Person", line1: "742 Evergreen Terrace", city: "Springfield", region: "OR", postalCode: "97403", country: "US" };
const auth: PurchaseAuthorization = {
  id: "a1", productId: "p1", productTitle: "Trail Daypack 22L", variantLabel: "Color: Blue", merchant: "example-outdoor.com", quantity: 1,
  destinationFingerprint: destinationFingerprint(home), destinationLabel: maskedDestinationLabel(home), paymentLabel: "Visa ending 4242",
  currency: "USD", totalCapMinor: 9000, validFrom: "2026-11-01T00:00:00Z", validUntil: "2026-12-01T00:00:00Z", mode: "dry_run", status: "active",
};
const good: CheckoutObservation = {
  pageUrl: "https://www.example-outdoor.com/checkout/review",
  items: [{ title: "Trail Daypack 22L", variant: "Blue", quantity: 1, matchesApprovedItem: true }],
  subtotalMinor: 7500, shippingMinor: 600, taxMinor: 620, totalMinor: 8720, currency: "USD",
  shipToText: "Test Person, 742 Evergreen Terrace, Springfield, OR 97403, United States", paymentText: "Visa •••• 4242", placeOrderVisible: true,
};
const now = new Date("2026-11-12T10:00:00Z");
const check = (overrides: Partial<CheckoutObservation> = {}, extra: Partial<Parameters<typeof validateCheckout>[0]> = {}) =>
  validateCheckout({ authorization: auth, destination: home, goalEarned: true, observation: { ...good, ...overrides }, now, ...extra });

describe("checkout validation (code-enforced purchase boundary)", () => {
  it("passes only when every bound term matches", () => {
    expect(check()).toMatchObject({ ok: true, reasons: [] });
  });
  it("Sandbox payment uses the bound wallet instead of a retailer text label, while every other checkout term remains required", () => {
    const authorization = { ...auth, paymentLabel: "PayPal Sandbox · ****1234", paymentConnectionId: "server-bound-wallet" };
    expect(check({ paymentText: null }, { authorization }).ok).toBe(true);
    expect(check({ paymentText: null, totalMinor: 9900 }, { authorization }).ok).toBe(false);
    expect(check({ placeOrderVisible: false }, { authorization }).ok).toBe(false);
    expect(check({ subtotalMinor: 7501 }, { authorization }).ok).toBe(false);
  });
  it("blocks a total above the cap once shipping and tax are included", () => {
    const result = check({ shippingMinor: 900, taxMinor: 800, totalMinor: 9200 });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/exceeds the approved cap/);
  });
  it("fails closed when shipping, tax or total cannot be read", () => {
    expect(check({ totalMinor: null }).ok).toBe(false);
    expect(check({ shippingMinor: null }).reasons.join(" ")).toMatch(/Shipping and tax/);
  });

  it("accepts a store that shows no tax line only when the total equals subtotal plus shipping", () => {
    expect(check({ taxMinor: null, totalMinor: 8100 }).ok).toBe(true);
    expect(check({ taxMinor: null, totalMinor: 8720 }).reasons.join(" ")).toMatch(/Shipping and tax/);
    expect(check({ taxMinor: null, shippingMinor: null, totalMinor: 7500 }).ok).toBe(false);
  });
  it("blocks a different item, a different variant, extra items or a changed quantity", () => {
    expect(check({ items: [{ ...good.items[0], matchesApprovedItem: false }] }).reasons.join(" ")).toMatch(/does not match the approved product/);
    expect(check({ items: [{ ...good.items[0], variant: "Red" }] }).reasons.join(" ")).toMatch(/variant/);
    expect(check({ items: [good.items[0], { title: "Water bottle", variant: null, quantity: 1, matchesApprovedItem: false }] }).ok).toBe(false);
    expect(check({ items: [{ ...good.items[0], quantity: 2 }] }).reasons.join(" ")).toMatch(/Quantity must be 1/);
  });
  it("blocks a changed delivery address, both in the saved profile and at the retailer", () => {
    const moved = { ...home, line1: "1 Other Street", postalCode: "10001" };
    expect(check({}, { destination: moved }).reasons.join(" ")).toMatch(/changed after approval/);
    expect(check({ shipToText: "Test Person, 1 Other Street, New York, NY 10001" }).reasons.join(" ")).toMatch(/ship-to address does not match/);
  });
  it("blocks the wrong merchant, currency or payment method", () => {
    expect(check({ pageUrl: "https://lookalike-outdoor.com/checkout" }).reasons.join(" ")).toMatch(/not the approved merchant/);
    expect(check({ currency: "EUR" }).ok).toBe(false);
    expect(check({ paymentText: "Mastercard •••• 1111" }).reasons.join(" ")).toMatch(/payment method/);
  });
  it("blocks when the goal is not earned, the approval was revoked, or the window closed", () => {
    expect(check({}, { goalEarned: false }).ok).toBe(false);
    expect(check({}, { authorization: { ...auth, status: "revoked" } }).ok).toBe(false);
    expect(check({}, { now: new Date("2026-12-02T00:00:00Z") }).reasons.join(" ")).toMatch(/window/);
  });
});

describe("private destination handling", () => {
  it("masks names and streets and changes the fingerprint when the street or postal code changes", () => {
    const label = maskedDestinationLabel(home);
    expect(label).not.toContain("Evergreen");
    expect(label).not.toContain("Test Person");
    expect(label).toContain("•••03");
    expect(destinationFingerprint({ ...home, fullName: "Someone Else" })).toBe(destinationFingerprint(home));
    expect(destinationFingerprint({ ...home, postalCode: "97404" })).not.toBe(destinationFingerprint(home));
  });
  it("matches a ship-to block by postal code, house number and street word", () => {
    expect(shipToMatches(home, "742 EVERGREEN TERR, SPRINGFIELD OR 97403")).toBe(true);
    expect(shipToMatches(home, "743 Evergreen Terrace, Springfield OR 97403")).toBe(false);
    expect(shipToMatches(home, null)).toBe(false);
  });
});

describe("agent control guard", () => {
  it("refuses order submission and account, address, payment or subscription changes", () => {
    for (const text of ["Place your order", "Buy Now", "Pay now", "Complete purchase", "Subscribe & Save", "Change address", "Add a new card", "Sign out"]) {
      expect(forbiddenForAgent(text)).not.toBeNull();
    }
    for (const text of ["Add to Cart", "Proceed to checkout", "Blue", "Continue", "Use this address"]) expect(forbiddenForAgent(text)).toBeNull();
  });
});

describe("receipt verification", () => {
  it("requires an explicit confirmation, order number, merchant match and in-cap total", () => {
    const receipt = { pageUrl: "https://example-outdoor.com/order/confirmation", orderNumber: "EO-123456", totalMinor: 8720, confirmed: true };
    expect(verifyReceipt(auth, receipt)).toBe(true);
    expect(verifyReceipt(auth, { ...receipt, orderNumber: null })).toBe(false);
    expect(verifyReceipt(auth, { ...receipt, confirmed: false })).toBe(false);
    expect(verifyReceipt(auth, { ...receipt, totalMinor: 9900 })).toBe(false);
    expect(verifyReceipt(auth, { ...receipt, pageUrl: "https://evil.example/confirmation" })).toBe(false);
  });
});

describe("consent banners", () => {
  it("never accepts cookies or terms for the user, but may decline or close", async () => {
    const { forbiddenForAgent } = await import("./shopping-policy");
    for (const t of ["Accept", "Accept all", "Accept All Cookies", "Allow all", "I agree", "Agree & continue"]) expect(forbiddenForAgent(t)).toMatch(/user's decision/);
    for (const t of ["Reject all", "Decline", "Necessary only", "Close", "Add to cart", "Accept terms and place order"]) expect(forbiddenForAgent(t) ?? "").not.toMatch(/user's decision/);
  });
});
