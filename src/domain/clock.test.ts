import { describe, expect, it } from "vitest";
import { assertDateRange, assertIanaTimezone, dateWithin, localDateAt } from "./clock";

describe("goal business dates", () => {
  it("uses the pinned timezone at a midnight boundary", () => {
    const instant = new Date("2026-03-09T03:59:00.000Z");
    expect(localDateAt(instant, "America/New_York")).toBe("2026-03-08");
    expect(localDateAt(instant, "UTC")).toBe("2026-03-09");
    expect(localDateAt(new Date("2026-03-09T04:01:00.000Z"), "America/New_York")).toBe("2026-03-09");
  });

  it("keeps both occurrences of the repeated fall-back hour on one local date", () => {
    expect(localDateAt(new Date("2026-11-01T05:30:00.000Z"), "America/New_York")).toBe("2026-11-01");
    expect(localDateAt(new Date("2026-11-01T06:30:00.000Z"), "America/New_York")).toBe("2026-11-01");
  });

  it("rejects invalid timezones and impossible calendar dates", () => {
    expect(() => assertIanaTimezone("America/New_York")).not.toThrow();
    expect(() => assertIanaTimezone("Not/A_Timezone")).toThrow("Invalid IANA timezone");
    expect(() => assertDateRange("2026-02-30", "2026-03-05", 1)).toThrow();
    expect(() => assertDateRange("2026-02-01", "2026-02-30", 1)).toThrow();
    expect(() => assertDateRange("2028-02-29", "2028-03-01", 1)).not.toThrow();
  });

  it("requires an achievable count inside an inclusive-start, exclusive-end period", () => {
    expect(() => assertDateRange("2026-10-07", "2026-11-06", 20)).not.toThrow();
    expect(() => assertDateRange("2026-10-07", "2026-10-08", 2)).toThrow("Required days exceed goal period");
    expect(() => assertDateRange("2026-10-08", "2026-10-08", 1)).toThrow("End date must follow start date");
    expect(dateWithin("2026-10-07", "2026-10-07", "2026-11-06")).toBe(true);
    expect(dateWithin("2026-11-06", "2026-10-07", "2026-11-06")).toBe(false);
  });
});
