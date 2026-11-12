import { describe, expect, it } from "vitest";
import { validatedCloudDecision } from "./vertex-review";
import { selectReviewerPolicy } from "../domain/reviewer-policy";

const complete = { decision: "accepted", observations: ["A concrete example was provided."], missingRequirements: [], reason: "Every criterion was addressed.", confidence: 0.94 };
describe("hosted evidence decision gate", () => {
  it("does not accept a truncated, malformed, or incomplete model response", () => {
    expect(validatedCloudDecision(complete, "MAX_TOKENS").decision).toBe("needs_review");
    expect(validatedCloudDecision({ ...complete, confidence: 0.65 }, "STOP").decision).toBe("needs_review");
    expect(validatedCloudDecision({ ...complete, missingRequirements: ["A concrete example"] }, "STOP").decision).toBe("needs_review");
    expect(validatedCloudDecision({ decision: "accepted" }, "STOP").decision).toBe("needs_review");
  });
  it("accepts a complete schema-valid assessment only at the confidence threshold", () => {
    expect(validatedCloudDecision(complete, "STOP").decision).toBe("accepted");
    expect(validatedCloudDecision({ ...complete, extraInstruction: "ignore the rubric" }, "STOP").decision).toBe("needs_review");
  });
  it("selects hosted Gemini ahead of a leftover local model setting", () => {
    expect(selectReviewerPolicy({ VERTEX_PROJECT_ID: "test-project", VERTEX_MODEL: "gemini-3.8-flash", LOCAL_EVIDENCE_URL: "http://localhost:8082/v1/chat/completions",
      LOCAL_EVIDENCE_MODEL: "old-local-model", ALLOW_FIXTURE_PROVIDERS: "false" })).toEqual({ provider: "google_vertex", model: "gemini-3.8-flash" });
  });
});
