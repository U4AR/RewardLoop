import { afterEach, describe, expect, it, vi } from "vitest";
import { generateVertexJson, reviewWithVertex } from "./vertex-review";
import { selectReviewerPolicy } from "../domain/reviewer-policy";

const config = { GOOGLE_AI_BACKEND: "gemini_api", GEMINI_API_KEY: "private-test-key-not-for-browser", VERTEX_MODEL: "gemini-test",
  VERTEX_LOCATION: "global", VERTEX_PROJECT_ID: "leftover-paid-project", GOOGLE_AUTH_MODE: "adc", APP_ORIGIN: "https://demo.example.com" } as const;
afterEach(() => vi.unstubAllGlobals());
const result = (value: unknown) => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] }));

describe("explicit Gemini API backend", () => {
  it("uses a server header, never a key in the URL or Vertex authentication", async () => {
    const send = vi.fn(async () => result({ ok: true })); vi.stubGlobal("fetch", send);
    await expect(generateVertexJson(config, { system: "s", input: {}, schema: {} })).resolves.toEqual({ ok: true });
    const [url, request] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(url).not.toContain(config.GEMINI_API_KEY);
    expect(request.headers).toEqual({ "x-goog-api-key": config.GEMINI_API_KEY, "content-type": "application/json" });
  });
  it("fails without falling back to paid Vertex on free-tier quota errors", async () => {
    const send = vi.fn(async () => new Response("quota", { status: 429 })); vi.stubGlobal("fetch", send);
    await expect(generateVertexJson(config, { system: "s", input: {}, schema: {} })).rejects.toThrow("HTTP 429");
    expect(send).toHaveBeenCalledTimes(1);
    expect(selectReviewerPolicy({ ...config, GEMINI_API_KEY: undefined, ALLOW_FIXTURE_PROVIDERS: "true" })).toBeNull();
  });
  it("reports the actual provider for a validated review", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => result({ decision: "accepted", observations: [], missingRequirements: [], reason: "Complete.", confidence: 0.95 })));
    expect(await reviewWithVertex({ rubric: "r", notes: "n" }, config)).toMatchObject({ provider: "google_gemini", decision: "accepted" });
  });
  it("does not echo upstream errors that might contain the credential", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: config.GEMINI_API_KEY } }), { status: 400 })));
    await expect(reviewWithVertex({ rubric: "r", notes: "n" }, config)).rejects.toThrow(/^Hosted evidence reviewer returned HTTP 400$/);
  });
});
