import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), getProduct: vi.fn(), review: vi.fn() }));
vi.mock("../db/client", () => ({ getPool: () => ({ query: mocks.query, connect: mocks.connect }) }));
vi.mock("../integrations/vertex-review", () => ({ reviewWithVertex: mocks.review }));
vi.mock("../config", () => ({ getConfig: () => ({ CHANNEL3_API_KEY: "test", VERTEX_PROJECT_ID: "test-project", VERTEX_MODEL: "gemini-3.8-flash" }) }));
vi.mock("../integrations/channel3", async (importOriginal) => ({ ...await importOriginal<typeof import("../integrations/channel3")>(), Channel3Catalog: class { getProduct = mocks.getProduct; } }));
import { checkoutReward, submitCheckin } from "./workspace";
const planId = "123e4567-e89b-42d3-a456-426614174000";
const plan = { id: planId, user_id: "alice", days: 5, required_days: 5, timezone: "UTC", deadline: "2099-01-01", product_id: "lamp", merchant: "retailer.com", offer_url: "https://retailer.com/lamp", budget_minor: 4000, retailer_check: null };
beforeEach(() => { vi.clearAllMocks(); });
describe("earned reward retailer handoff", () => {
  it("does not open another user's reward or a goal that has not been earned", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(checkoutReward("bob", { planId })).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
    expect(mocks.query.mock.calls[0][1]).toEqual([planId, "bob"]);
    mocks.query.mockResolvedValueOnce({ rows: [{ ...plan, days: 4 }] });
    await expect(checkoutReward("alice", { planId })).rejects.toMatchObject({ code: "GOAL_INCOMPLETE" });
    expect(mocks.getProduct).not.toHaveBeenCalled();
  });
  it("blocks an increased catalog price or unavailable saved offer", async () => {
    mocks.query.mockResolvedValue({ rows: [plan] });
    mocks.getProduct.mockResolvedValue({ offers: [{ sourceUrl: plan.offer_url, sourceMerchantDomain: plan.merchant, observedPriceMinor: 4500, availability: "in_stock" }] });
    await expect(checkoutReward("alice", { planId })).rejects.toMatchObject({ code: "OVER_BUDGET" });
    mocks.getProduct.mockResolvedValue({ offers: [] });
    await expect(checkoutReward("alice", { planId })).rejects.toMatchObject({ code: "OFFER_CHANGED" });
  });
  it("honors a recent retailer observation that contradicts the catalog", async () => {
    mocks.query.mockResolvedValue({ rows: [{ ...plan, retailer_check: { checkedAt: new Date().toISOString(), priceMinor: 5000, availability: "in_stock" } }] });
    mocks.getProduct.mockResolvedValue({ offers: [{ sourceUrl: plan.offer_url, sourceMerchantDomain: plan.merchant, observedPriceMinor: 3500, availability: "in_stock" }] });
    await expect(checkoutReward("alice", { planId })).rejects.toMatchObject({ code: "RETAILER_OFFER_CHANGED" });
  });
  it("returns the real retailer URL and never claims that an order was placed", async () => {
    mocks.query.mockResolvedValue({ rows: [plan] });
    mocks.getProduct.mockResolvedValue({ offers: [{ sourceUrl: plan.offer_url, sourceMerchantDomain: plan.merchant, observedPriceMinor: 3500, availability: "in_stock" }] });
    const result = await checkoutReward("alice", { planId });
    expect(result.url).toBe(plan.offer_url);
    expect(result.message).toContain("has not placed an order or charged you");
  });
});

describe("hosted review credit reservation", () => {
  const input = { planId, notes: "An index maps sorted keys to rows; writes take extra work and the index takes additional disk space." };
  function transaction(counts: { n: number; pending: number }, accepted: boolean) {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM reward_plans")) return { rows: [{ ...plan, rubric: "Explain index lookups and costs", review_model: "gemini-3.8-flash", start_date: "2020-01-01" }] };
      if (sql.includes("CLOUD_REVIEW_REQUESTED") && sql.includes("SELECT")) return { rows: [counts] };
      if (sql.includes("status='accepted'")) return { rows: accepted ? [{ id: "previous" }] : [], rowCount: accepted ? 1 : 0 };
      return { rows: [{ id: "checkin-1" }], rowCount: 1 };
    });
    mocks.connect.mockResolvedValue({ query, release: vi.fn() });
    return query;
  }
  it("does not call Google when the daily review budget is exhausted or another review is pending", async () => {
    transaction({ n: 20, pending: 0 }, false);
    await expect(submitCheckin("alice", input)).rejects.toMatchObject({ code: "REVIEW_LIMIT" });
    transaction({ n: 1, pending: 1 }, false);
    await expect(submitCheckin("alice", input)).rejects.toMatchObject({ code: "REVIEW_LIMIT" });
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("prevents a second qualifying day from the same calendar date before calling the provider", async () => {
    transaction({ n: 1, pending: 0 }, true);
    await expect(submitCheckin("alice", input)).rejects.toMatchObject({ code: "DAY_COMPLETE" });
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("reserves a bounded call before inference and preserves notes after a provider outage", async () => {
    const query = transaction({ n: 0, pending: 0 }, false);
    mocks.review.mockImplementation(async () => {
      expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO audit_events"))).toBe(true);
      throw new Error("provider timeout");
    });
    await expect(submitCheckin("alice", input)).rejects.toMatchObject({ code: "REVIEW_UNAVAILABLE" });
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("SET status='error'"))).toBe(true);
  });
});
