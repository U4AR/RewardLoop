export type ReviewProvider = "anthropic" | "google_vertex" | "google_gemini" | "local_llama" | "fixture";

export type ReviewerPolicy = {
  provider: ReviewProvider;
  model: string;
};

export const FIXTURE_REVIEWER: ReviewerPolicy = {
  provider: "fixture",
  model: "deterministic-word-count-v1",
};

export function selectReviewerPolicy(config: {
  GOOGLE_AI_BACKEND?: "vertex" | "gemini_api";
  GEMINI_API_KEY?: string;
  VERTEX_PROJECT_ID?: string;
  VERTEX_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  EVIDENCE_MODEL?: string;
  LOCAL_EVIDENCE_URL?: string;
  LOCAL_EVIDENCE_MODEL?: string;
  ALLOW_FIXTURE_PROVIDERS: "true" | "false";
}): ReviewerPolicy | null {
  if (config.GOOGLE_AI_BACKEND === "gemini_api") {
    return config.GEMINI_API_KEY && config.VERTEX_MODEL ? { provider: "google_gemini", model: config.VERTEX_MODEL } : null;
  }
  if (config.VERTEX_PROJECT_ID && config.VERTEX_MODEL) {
    return { provider: "google_vertex", model: config.VERTEX_MODEL };
  }
  if (config.ANTHROPIC_API_KEY && config.EVIDENCE_MODEL) {
    return { provider: "anthropic", model: config.EVIDENCE_MODEL };
  }
  if (config.LOCAL_EVIDENCE_URL && config.LOCAL_EVIDENCE_MODEL) {
    return { provider: "local_llama", model: config.LOCAL_EVIDENCE_MODEL };
  }
  return config.ALLOW_FIXTURE_PROVIDERS === "true" ? FIXTURE_REVIEWER : null;
}

export function reviewerPolicyFromPermission(permission: Record<string, unknown>): ReviewerPolicy | null {
  const provider = permission.review_provider;
  const model = permission.review_model;
  const mode = permission.execution_mode;
  if ((provider !== "anthropic" && provider !== "google_vertex" && provider !== "google_gemini" && provider !== "local_llama" && provider !== "fixture") ||
      (mode !== "fixture" && mode !== "paypal_sandbox" && mode !== "paypal_sandbox_fresh") ||
      typeof model !== "string" || model.length === 0 ||
      (provider === "fixture" && model !== FIXTURE_REVIEWER.model) ||
      (mode !== "fixture" && provider === "fixture")) return null;
  return { provider, model };
}
