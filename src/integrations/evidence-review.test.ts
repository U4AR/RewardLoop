import { afterEach, describe, expect, it, vi } from "vitest";
const config = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock("../config", () => config);
import { reviewEvidence, reviewWithLocalModel } from "./evidence-review";

const input = {
  rubric: "Explain how a database index improves lookup and one trade-off of adding indexes. Both details must appear in the note.",
  notes: "A database index maps key values to matching rows, so a lookup can avoid scanning every row. The trade-off is that inserts and updates must maintain the index, which costs extra write time and storage.",
};
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
  it("uses the model pinned on the permission, without falling back to a different configured model", async () => {
    config.getConfig.mockReturnValue({ LOCAL_EVIDENCE_URL: url, LOCAL_EVIDENCE_MODEL: "different-model" });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await reviewEvidence(input, { provider: "local_llama", model });
    expect(result).toMatchObject({ decision: "needs_review", provider: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can produce an accepted genuine AI review under the exact pinned local model", async () => {
    config.getConfig.mockReturnValue({ LOCAL_EVIDENCE_URL: url, LOCAL_EVIDENCE_MODEL: model });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", rationale: "Both concepts are explained.", certainty: "high",
    }));
    expect(await reviewEvidence(input, { provider: "local_llama", model }))
      .toMatchObject({ decision: "accepted", provider: "local_llama", model });
  });

  it("sends bounded JSON-only review and preserves actual local-model provenance", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", rationale: "Both concepts are explained.", certainty: "high",
    }));
    const result = await reviewWithLocalModel(input, url, model);
    expect(result).toMatchObject({ decision: "accepted", provider: "local_llama", model, inputTokens: 50, outputTokens: 40 });
    const [requestUrl, options] = mock.mock.calls[0];
    const body = JSON.parse(String(options?.body));
    expect(requestUrl).toBe(url);
    expect(body.max_tokens).toBe(250);
    expect(body.temperature).toBe(0);
    expect(body.messages[1].content).toContain(input.notes);
    expect(body.response_format.type).toBe("json_schema");
  });

  it("does not accept an uncertain model judgment", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", rationale: "The rubric may be incomplete.", certainty: "medium",
    }));
    expect((await reviewWithLocalModel(input, url, model)).decision).toBe("needs_review");
  });

  it("rejects an incomplete note even when the model falsely says accepted with high certainty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", rationale: "The note explains the index.", certainty: "high",
    }));
    const result = await reviewWithLocalModel({ ...input,
      notes: "An index maps a key value to matching rows, allowing the database to find rows without scanning the entire table.",
    }, url, model);
    expect(result).toMatchObject({ decision: "needs_review", confidence: 0.3 });
    expect(result.missingRequirements).toContain("Identify the cost of maintaining an index during writes");
    expect(result.missingRequirements).toContain("Identify the extra storage cost of an index");
  });

  it("requires concrete examples when the rubric asks for them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", rationale: "All details are present.", certainty: "high",
    }));
    const result = await reviewWithLocalModel({ ...input,
      rubric: "Explain how a database index speeds up a lookup, identify its write and storage costs, and give specific examples.",
    }, url, model);
    expect(result.decision).toBe("needs_review");
    expect(result.missingRequirements).toContain("Give a specific lookup example");
  });

  it("accepts a concrete index explanation after model and coverage gates agree", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", rationale: "The lookup and both costs are explained with an example.", certainty: "high",
    }));
    const result = await reviewWithLocalModel({
      rubric: "Explain how a database index speeds up a lookup, and identify its write and storage costs. Give specific examples.",
      notes: "A B-tree index on users.email maps email keys to row locations. A query such as SELECT * FROM users WHERE email = 'test@example.com' can use the index to find matching rows instead of scanning every user. Inserts and updates must maintain the B-tree entries, which adds write work. The index pages also consume extra disk storage.",
    }, url, model);
    expect(result).toMatchObject({ decision: "accepted", provider: "local_llama" });
  });

  it("fails closed for content rubrics outside the bounded local qualification", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", rationale: "The note covers the rubric.", certainty: "high",
    }));
    const result = await reviewWithLocalModel({ rubric: "Explain what you learned about joins.",
      notes: "An inner join combines related rows from two tables on a matching foreign key." }, url, model);
    expect(result.decision).toBe("needs_review");
    expect(result.missingRequirements[0]).toMatch(/human review/);
  });

  it("does not accept a duration claim from notes alone even if the model says accepted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", rationale: "The note says thirty minutes passed.", certainty: "high",
    }));
    const result = await reviewWithLocalModel({ rubric: "Provide independent proof of studying for 30 minutes.",
      notes: "I studied for 30 minutes." }, url, model);
    expect(result).toMatchObject({ decision: "needs_review", provider: "local_llama" });
    expect(result.missingRequirements).toContain("Independent measurement of the required duration");
  });

  it("fails closed when model identity differs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", rationale: "Both concepts are explained.", certainty: "high",
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
      decision: "accepted", rationale: "Both concepts are explained.", certainty: "high",
    }, { choices: [{ finish_reason: "length", message: { content: JSON.stringify({ decision: "accepted", rationale: "Both concepts are explained.", certainty: "high" }) } }] }));
    expect((await reviewWithLocalModel(input, url, model)).decision).toBe("needs_review");
  });

  it("fails closed on an unexpected field instead of repairing malformed model output", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverReply({
      decision: "accepted", rationale: "Both concepts are explained.", certainty: "high", confidence: 3,
    }));
    expect((await reviewWithLocalModel(input, url, model)).decision).toBe("needs_review");
  });
});
