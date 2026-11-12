import { describe, expect, it, vi } from "vitest";
import { prepareCheckout, submitOrder, type BrowserDriver, type Planner, type PlannerDecision, type Snapshot } from "./shopping-agent";

const approved = { title: "Trail Daypack 22L", variant: "Color: Blue", merchant: "example-outdoor.com" };
const page = (url: string, texts: string[], extra: Partial<Snapshot> = {}): Snapshot =>
  ({ url, title: "t", text: texts.join(" "), elements: texts.map((text, i) => ({ i, tag: "button", role: "", text })), loginRequired: false, captcha: false, ...extra });

function fakes(pages: Snapshot[], decisions: PlannerDecision[]) {
  let at = 0;
  const driver: BrowserDriver & { clicks: string[] } = {
    clicks: [],
    goto: vi.fn(async () => {}),
    snapshot: vi.fn(async () => pages[Math.min(at, pages.length - 1)]),
    click: vi.fn(async (i: number) => { driver.clicks.push(pages[Math.min(at, pages.length - 1)].elements[i].text); at++; }),
    selectOption: vi.fn(async () => { at++; }),
  };
  let d = 0;
  const planner: Planner = {
    decide: vi.fn(async () => decisions[Math.min(d++, decisions.length - 1)]),
    extractCheckout: vi.fn(async () => ({ pageUrl: "", items: [{ title: approved.title, variant: "Blue", quantity: 1, matchesApprovedItem: true }], subtotalMinor: 7500, shippingMinor: 600, taxMinor: 620, totalMinor: 8720, currency: "USD", shipToText: "x", paymentText: "x", placeOrderVisible: true })),
    extractReceipt: vi.fn(async () => ({ pageUrl: "", orderNumber: "EO-1", totalMinor: 8720, confirmed: true })),
  };
  return { driver, planner };
}
const run = (pages: Snapshot[], decisions: PlannerDecision[], checkpoint = async () => {}) => {
  const f = fakes(pages, decisions), steps: string[] = [];
  return { f, steps, outcome: prepareCheckout({ ...f, approved, offerUrl: "https://buy.trychannel3.com/x", maxSteps: 6, checkpoint, log: async s => { steps.push(`${s.kind}:${s.detail}`); } }) };
};

describe("shopping agent loop", () => {
  it("adds the item, reaches checkout review and reads it without placing an order", async () => {
    const { f, outcome } = run([
      page("https://example-outdoor.com/p/daypack", ["Add to Cart", "Buy Now"]),
      page("https://example-outdoor.com/cart", ["Proceed to checkout"]),
      page("https://example-outdoor.com/checkout/review", ["Place your order"]),
    ], [
      { action: "click", index: 0, option: null, reason: "add" }, { action: "click", index: 0, option: null, reason: "checkout" },
      { action: "at_checkout_review", index: null, option: null, reason: "review" },
    ]);
    const result = await outcome;
    expect(result.kind).toBe("checkout_review");
    expect(f.driver.clicks).toEqual(["Add to Cart", "Proceed to checkout"]);
    expect(f.driver.clicks).not.toContain("Place your order");
  });
  it("refuses a model request to click Buy Now or Place order, and never clicks it", async () => {
    const { f, steps, outcome } = run([page("https://example-outdoor.com/p/daypack", ["Add to Cart", "Buy Now"])],
      [{ action: "click", index: 1, option: null, reason: "fast" }]);
    const result = await outcome;
    expect(result.kind).toBe("blocked");
    expect(f.driver.click).not.toHaveBeenCalled();
    expect(steps.some(s => s.startsWith("refused:"))).toBe(true);
  });
  it("hands off to the person at a sign-in page or CAPTCHA", async () => {
    expect((await run([page("https://example-outdoor.com/signin", ["Sign in"], { loginRequired: true })], []).outcome).kind).toBe("handoff");
    const captcha = await run([page("https://example-outdoor.com/p", ["Add"], { captcha: true })], []).outcome;
    expect(captcha).toMatchObject({ kind: "handoff", reason: expect.stringMatching(/CAPTCHA/) });
  });
  it("stops if the browser leaves the approved merchant", async () => {
    const result = await run([page("https://lookalike-outdoor.com/p", ["Add to Cart"])], [{ action: "click", index: 0, option: null, reason: "x" }]).outcome;
    expect(result).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/left example-outdoor.com/) });
  });
  it("stops at the next checkpoint after revocation", async () => {
    let calls = 0;
    const { outcome } = run([page("https://example-outdoor.com/p", ["Add to Cart"])], [{ action: "click", index: 0, option: null, reason: "x" }],
      async () => { if (++calls > 1) throw new Error("revoked"); });
    await expect(outcome).rejects.toThrow("revoked");
  });
});

describe("guarded order submission (live mode only)", () => {
  it("records that payment may be submitted before clicking the single order button", async () => {
    const order: string[] = [];
    const { driver, planner } = fakes([page("https://example-outdoor.com/checkout/review", ["Edit", "Place your order"]), page("https://example-outdoor.com/confirmation", ["Thanks"])], []);
    const click = driver.click;
    driver.click = vi.fn(async (i: number) => { order.push("click"); await click(i); });
    const result = await submitOrder({ driver, planner, merchant: approved.merchant, log: async () => {}, beforeSubmit: async () => { order.push("recorded"); } });
    expect(order).toEqual(["recorded", "click"]);
    expect(result).toMatchObject({ kind: "submitted", receipt: { orderNumber: "EO-1" } });
  });
  it("does not submit when the order button is missing or ambiguous", async () => {
    const before = vi.fn();
    const { driver, planner } = fakes([page("https://example-outdoor.com/checkout", ["Place order", "Place order now"])], []);
    expect(await submitOrder({ driver, planner, merchant: approved.merchant, log: async () => {}, beforeSubmit: before })).toMatchObject({ kind: "not_submitted" });
    expect(before).not.toHaveBeenCalled();
  });
});

describe("Channel3 affiliate redirect", () => {
  const seqDriver = (urls: string[]) => {
    let n = 0;
    const driver: BrowserDriver = {
      goto: vi.fn(async () => {}),
      snapshot: vi.fn(async () => page(urls[Math.min(n++, urls.length - 1)], ["Add to Cart"])),
      click: vi.fn(async () => {}), selectOption: vi.fn(async () => {}),
    };
    return driver;
  };
  const planner = (): Planner => ({
    decide: vi.fn(async () => ({ action: "handoff", index: null, option: null, reason: "stop here" }) as PlannerDecision),
    extractCheckout: vi.fn(), extractReceipt: vi.fn(),
  });

  it("waits on Channel3's own domain without acting, then continues once the approved merchant loads", async () => {
    const driver = seqDriver(["https://trychannel3.com/r/abc", "https://buy.trychannel3.com/x", "https://example-outdoor.com/p/daypack"]);
    const p = planner(), steps: string[] = [];
    const result = await prepareCheckout({ driver, planner: p, approved, offerUrl: "https://buy.trychannel3.com/x", maxSteps: 3, redirectWaitMs: 0, checkpoint: async () => {}, log: async s => { steps.push(s.kind); } });
    expect(result.kind).toBe("handoff");
    expect(driver.click).not.toHaveBeenCalled();
    expect((p.decide as ReturnType<typeof vi.fn>).mock.calls[0][0].snapshot.url).toBe("https://example-outdoor.com/p/daypack");
  });

  it("stops if the link never leaves Channel3, and never asks the planner to act there", async () => {
    const driver = seqDriver(["https://trychannel3.com/r/abc"]);
    const p = planner(), steps: string[] = [];
    const result = await prepareCheckout({ driver, planner: p, approved, offerUrl: "https://buy.trychannel3.com/x", maxSteps: 3, redirectWaitMs: 0, checkpoint: async () => {}, log: async s => { steps.push(`${s.kind}:${s.detail}`); } });
    expect(result.kind).toBe("blocked");
    expect(p.decide).not.toHaveBeenCalled();
    expect(steps.at(-1)).toContain("did not reach example-outdoor.com");
  });

  it("still blocks any other site", async () => {
    const driver = seqDriver(["https://lookalike-outdoor.com/p/daypack"]);
    const result = await prepareCheckout({ driver, planner: planner(), approved, offerUrl: "https://buy.trychannel3.com/x", maxSteps: 3, redirectWaitMs: 0, checkpoint: async () => {}, log: async () => {} });
    expect(result.kind).toBe("blocked");
  });
});

describe("checkout form filling from saved details", () => {
  const contact = { email: "maria@example.com", firstName: "Maria", lastName: "Test", address1: "742 Evergreen Terrace", city: "Springfield", region: "OR", postalCode: "97403" };
  const checkoutPage = (fields: { f: number; label: string; sensitive?: boolean }[]): Snapshot => ({ ...page("https://example-outdoor.com/checkout", ["Pay now"]),
    fields: fields.map(x => ({ f: x.f, tag: "input", label: x.label, filled: false, sensitive: x.sensitive ?? false })) });
  const driverWith = (snaps: Snapshot[]) => {
    let n = 0; const filled: Array<[number, string]> = [];
    const driver: BrowserDriver = { goto: vi.fn(async () => {}), snapshot: vi.fn(async () => snaps[Math.min(n++, snaps.length - 1)]),
      click: vi.fn(async () => {}), selectOption: vi.fn(async () => {}), fill: vi.fn(async (f: number, v: string) => { filled.push([f, v]); }) };
    return { driver, filled };
  };
  const plannerWith = (decisions: PlannerDecision[]): Planner => { let d = 0; return {
    decide: vi.fn(async () => decisions[Math.min(d++, decisions.length - 1)]), extractCheckout: vi.fn(async () => ({ pageUrl: "", items: [], subtotalMinor: null, shippingMinor: null, taxMinor: null, totalMinor: null, currency: null, shipToText: null, paymentText: null, placeOrderVisible: true })), extractReceipt: vi.fn() }; };

  it("types only the user's saved values, chosen by key, into non-sensitive fields", async () => {
    const snap = checkoutPage([{ f: 0, label: "Email" }, { f: 1, label: "Address" }, { f: 2, label: "Card number", sensitive: true }, { f: 3, label: "Security code" }]);
    const { driver, filled } = driverWith([snap, snap]);
    const planner = plannerWith([
      { action: "fill", index: null, option: null, reason: "contact", fills: [{ field: 0, key: "email" }, { field: 1, key: "address1" }, { field: 2, key: "postalCode" }, { field: 3, key: "phone" }] },
      { action: "at_checkout_review", index: null, option: null, reason: "review" },
    ]);
    const steps: string[] = [];
    const result = await prepareCheckout({ driver, planner, approved, offerUrl: null, maxSteps: 4, redirectWaitMs: 0, contact, checkpoint: async () => {}, log: async s => { steps.push(`${s.kind}:${s.detail}`); } });
    expect(result.kind).toBe("checkout_review");
    expect(filled).toEqual([[0, "maria@example.com"], [1, "742 Evergreen Terrace"]]);
    expect(steps.join(" ")).not.toContain("742");
  });

  it("hands off when there are no saved details or only sensitive fields are requested", async () => {
    const snap = checkoutPage([{ f: 0, label: "Card number", sensitive: true }]);
    const { driver, filled } = driverWith([snap]);
    const planner = plannerWith([{ action: "fill", index: null, option: null, reason: "x", fills: [{ field: 0, key: "email" }] }]);
    expect((await prepareCheckout({ driver, planner, approved, offerUrl: null, maxSteps: 2, contact, checkpoint: async () => {}, log: async () => {} })).kind).toBe("handoff");
    const noContact = driverWith([checkoutPage([{ f: 0, label: "Email" }])]);
    expect((await prepareCheckout({ driver: noContact.driver, planner: plannerWith([{ action: "fill", index: null, option: null, reason: "x", fills: [{ field: 0, key: "email" }] }]), approved, offerUrl: null, maxSteps: 2, checkpoint: async () => {}, log: async () => {} })).kind).toBe("handoff");
    expect(filled).toEqual([]); expect(noContact.filled).toEqual([]);
  });
});

describe("state and country dropdowns", () => {
  it("always sets state and country dropdowns from the saved address, using the full state name", async () => {
    const { fillValue } = await import("./shopping-agent");
    expect(fillValue("region", { region: "OR" }, "select")).toBe("Oregon");
    expect(fillValue("region", { region: "OR" }, "input")).toBe("OR");
    const snap: Snapshot = { ...page("https://example-outdoor.com/checkout", ["Continue to shipping"]),
      fields: [{ f: 0, tag: "input", label: "Email", filled: false, sensitive: false }, { f: 1, tag: "select", label: "State", filled: true, sensitive: false }, { f: 2, tag: "select", label: "Country/Region", filled: true, sensitive: false }] };
    const filled: Array<[number, string]> = [];
    const driver: BrowserDriver = { goto: vi.fn(async () => {}), snapshot: vi.fn(async () => snap), click: vi.fn(async () => {}), selectOption: vi.fn(async () => {}), fill: vi.fn(async (f: number, v: string) => { filled.push([f, v]); }) };
    let d = 0;
    const planner: Planner = { decide: vi.fn(async () => (d++ === 0 ? { action: "fill", index: null, option: null, reason: "x", fills: [{ field: 0, key: "email" }] } : { action: "handoff", index: null, option: null, reason: "stop" }) as PlannerDecision), extractCheckout: vi.fn(), extractReceipt: vi.fn() };
    await prepareCheckout({ driver, planner, approved, offerUrl: null, maxSteps: 3, contact: { email: "m@example.com", region: "OR", country: "US" }, checkpoint: async () => {}, log: async () => {} });
    expect(filled).toEqual([[0, "m@example.com"], [1, "Oregon"], [2, "US"]]);
  });
});
