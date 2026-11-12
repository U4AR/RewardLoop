import { describe, expect, it } from "vitest";
import { normalizeWorkspace } from "./workspace-normalize";

describe("normalizeWorkspace", () => {
  it("does not crash when stats are missing and derives distinct accepted days", () => {
    const state = normalizeWorkspace({ user: { name: "A", email: "a@example.com" }, plans: [], checkins: [
      { plan_id: "p1", business_date: "2026-11-10", status: "accepted" },
      { plan_id: "p1", business_date: "2026-11-10", status: "accepted" },
      { plan_id: "p1", business_date: "2026-11-11", status: "rejected" },
    ] });
    expect(state.stats.totalDays).toBe(1);
    expect(state.services.reviewerName).toBe("Gemini");
  });
  it("keeps a valid reported total and rejects responses without a user", () => {
    expect(normalizeWorkspace({ user: { name: "A", email: "a@example.com" }, stats: { totalDays: 4 } }).stats.totalDays).toBe(4);
    expect(() => normalizeWorkspace({ stats: { totalDays: 1 } })).toThrow();
  });
});
