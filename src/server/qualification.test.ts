import { describe, expect, it, vi } from "vitest";
import { countQualifyingDays } from "./qualification";

const goal = {
  id: "goal-1", goal_version: 1, rubric_version: 1,
  start_date: "2026-10-01", end_date_exclusive: "2026-11-01",
};
const permission = {
  user_id: "owner-1", status: "ACTIVE", goal_version: 1, rubric_version: 1,
  execution_mode: "paypal_sandbox_fresh", review_provider: "local_llama",
  review_model: "Qwen3-1.7B-Q4_K_M",
};

describe("owner-approved evidence reviewer", () => {
  it("counts only accepted days from the exact pinned provider, model, and owner", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ n: 1 }] });
    const count = await countQualifyingDays({ query } as never, goal, permission);
    expect(count).toBe(1);
    expect(query.mock.calls[0][0]).toContain("e.status = 'ACCEPTED'");
    expect(query.mock.calls[0][0]).toContain("e.review_model = $8");
    expect(query.mock.calls[0][1]).toEqual([
      "goal-1", 1, 1, "2026-10-01", "2026-11-01", "owner-1", "local_llama", "Qwen3-1.7B-Q4_K_M",
    ]);
  });

  it("cannot qualify Sandbox using a fixture result or an unpinned legacy permission", async () => {
    const query = vi.fn();
    expect(await countQualifyingDays({ query } as never, goal,
      { ...permission, review_provider: "fixture", review_model: "deterministic-word-count-v1" })).toBe(0);
    expect(await countQualifyingDays({ query } as never, goal,
      { ...permission, review_provider: null, review_model: null })).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("does not count a revoked or version-mismatched permission", async () => {
    const query = vi.fn();
    expect(await countQualifyingDays({ query } as never, goal, { ...permission, status: "REVOKED" })).toBe(0);
    expect(await countQualifyingDays({ query } as never, goal, { ...permission, goal_version: 2 })).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
