import { describe, expect, it } from "vitest";
import { reviewFailureCause } from "./workspace";

describe("reviewFailureCause", () => {
  it("reports only Google's status, never the message body or token", () => {
    expect(reviewFailureCause(new Error("Hosted evidence reviewer returned HTTP 429 (RESOURCE_EXHAUSTED): Quota exceeded for project 123"))).toBe("Google returned HTTP 429 RESOURCE_EXHAUSTED");
    expect(reviewFailureCause(new Error("Command failed: gcloud.cmd auth print-access-token --account=a@b.c"))).toBe("the local Google Cloud sign-in did not return a token");
    expect(reviewFailureCause(new Error("The operation was aborted due to timeout"))).toBe("the request timed out");
    expect(reviewFailureCause("x")).toBe("unexpected reviewer error");
  });
});
