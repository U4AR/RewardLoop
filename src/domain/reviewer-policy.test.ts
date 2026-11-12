import { describe, expect, it } from "vitest";
import { reviewerPolicyFromPermission, selectReviewerPolicy } from "./reviewer-policy";

describe("reviewer pinned with purchase permission", () => {
  const empty = { ALLOW_FIXTURE_PROVIDERS: "false" as const };

  it("selects the configured genuine local model when Anthropic is unavailable", () => {
    expect(selectReviewerPolicy({ ...empty, LOCAL_EVIDENCE_URL: "http://127.0.0.1:8082/v1/chat/completions",
      LOCAL_EVIDENCE_MODEL: "Qwen3-1.7B-Q4_K_M" }))
      .toEqual({ provider: "local_llama", model: "Qwen3-1.7B-Q4_K_M" });
  });

  it("does not silently treat a Sandbox fixture or legacy permission as real AI", () => {
    expect(selectReviewerPolicy(empty)).toBeNull();
    expect(reviewerPolicyFromPermission({ execution_mode: "paypal_sandbox_fresh",
      review_provider: "fixture", review_model: "deterministic-word-count-v1" })).toBeNull();
    expect(reviewerPolicyFromPermission({ execution_mode: "paypal_sandbox_fresh" })).toBeNull();
  });

  it("accepts only the exact reviewer and model saved on a Sandbox permission", () => {
    expect(reviewerPolicyFromPermission({ execution_mode: "paypal_sandbox_fresh",
      review_provider: "local_llama", review_model: "Qwen3-1.7B-Q4_K_M" }))
      .toEqual({ provider: "local_llama", model: "Qwen3-1.7B-Q4_K_M" });
  });
});
