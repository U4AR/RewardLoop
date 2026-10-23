import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewWithLocalModel } from "./evidence-review";

const input = { rubric: "Explain two concepts learned today.", notes: "I learned how indexes speed lookups and why joins combine related rows." };
const url = "http://127.0.0.1:8082/v1/chat/completions";
const model = "Qwen3-1.7B-Q4_K_M";

function serverReply(verdict: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    model,
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }],
    usage: { prompt_tokens: 50, completion_tokens: 40 },
    ...overrides,
  }), { status: 200 });
}

afterEach(() => vi.restoreAllMocks());

describe("local evidence model", () => {
  it("sends bounded JSON-only review and preserves actual local-model provenance", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", observations: ["Both concepts described"], missingRequirements: [],
      reason: "Notes satisfy the rubric.", confidence: 0.84,
    }));
    const result = await reviewWithLocalModel(input, url, model);
    expect(result).toMatchObject({ decision: "accepted", provider: "local_llama", model, inputTokens: 50, outputTokens: 40 });
    const [requestUrl, options] = mock.mock.calls[0];
    const body = JSON.parse(String(options?.body));
    expect(requestUrl).toBe(url);
    expect(body.max_tokens).toBe(280);
    expect(body.temperature).toBe(0);
    expect(body.messages[1].content).toContain(input.notes);
    expect(body.response_format.type).toBe("json_schema");
  });

  it("does not accept a response with unmet requirements or low self-reported confidence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", observations: [], missingRequirements: ["Second concept missing"],
      reason: "The rubric is incomplete.", confidence: 0.95,
    }));
    expect((await reviewWithLocalModel(input, url, model)).decision).toBe("needs_review");
  });

  it("fails closed when model identity differs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", observations: [], missingRequirements: [], reason: "OK", confidence: 1,
    }, { model: "different-model" }));
    await expect(reviewWithLocalModel(input, url, model)).rejects.toThrow(/identity/);
  });

  it("rejects a remote endpoint before sending notes", async () => {
    const mock = vi.spyOn(globalThis, "fetch");
    await expect(reviewWithLocalModel(input, "https://example.com/v1/chat/completions", model)).rejects.toThrow(/loopback/);
    expect(mock).not.toHaveBeenCalled();
  });

  it("does not count a truncated model answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", observations: [], missingRequirements: [], reason: "OK", confidence: 1,
    }, { choices: [{ finish_reason: "length", message: { content: JSON.stringify({ decision: "accepted", observations: [], missingRequirements: [], reason: "OK", confidence: 1 }) } }] }));
    expect((await reviewWithLocalModel(input, url, model)).decision).toBe("needs_review");
  });
});
