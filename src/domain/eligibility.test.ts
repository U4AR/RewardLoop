import { describe, expect, it } from "vitest";
import { isGoalQualified, qualifyingDistinctDays, type AcceptedDay } from "./eligibility";

const window = {
  goalVersion: 2,
  rubricVersion: 3,
  startDate: "2026-03-01",
  endDateExclusive: "2026-04-01",
};

describe("deterministic goal qualification", () => {
  it("counts each accepted local day once and excludes stale rules and dates outside the period", () => {
    const days: AcceptedDay[] = [
      { date: "2026-03-09", goalVersion: 2, rubricVersion: 3 },
      { date: "2026-03-09", goalVersion: 2, rubricVersion: 3 },
      { date: "2026-03-08", goalVersion: 2, rubricVersion: 3 },
      { date: "2026-03-10", goalVersion: 1, rubricVersion: 3 },
      { date: "2026-03-11", goalVersion: 2, rubricVersion: 2 },
      { date: "2026-02-28", goalVersion: 2, rubricVersion: 3 },
      { date: "2026-04-01", goalVersion: 2, rubricVersion: 3 },
    ];
    expect(qualifyingDistinctDays({ ...window, days })).toEqual(["2026-03-08", "2026-03-09"]);
  });

  it("qualifies exactly at the required distinct-day threshold", () => {
    const days: AcceptedDay[] = [
      { date: "2026-03-01", goalVersion: 2, rubricVersion: 3 },
      { date: "2026-03-01", goalVersion: 2, rubricVersion: 3 },
      { date: "2026-03-02", goalVersion: 2, rubricVersion: 3 },
    ];
    expect(isGoalQualified({ ...window, days, requiredDays: 3 })).toBe(false);
    expect(isGoalQualified({ ...window, days, requiredDays: 2 })).toBe(true);
  });

  it("does not let accepted days from an earlier rubric or goal version unlock a replacement", () => {
    const days: AcceptedDay[] = [
      { date: "2026-03-01", goalVersion: 1, rubricVersion: 1 },
      { date: "2026-03-02", goalVersion: 1, rubricVersion: 1 },
    ];
    expect(isGoalQualified({ ...window, days, requiredDays: 1 })).toBe(false);
  });
});
