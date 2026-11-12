import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => {
  let n = 0;
  return { execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => cb(null, { stdout: `token-${++n}\n`, stderr: "" }) };
});

const config = { GOOGLE_AUTH_MODE: "gcloud", GOOGLE_CLOUD_ACCOUNT: "dev@example.com", APP_ORIGIN: "http://localhost:3001",
  VERTEX_PROJECT_ID: "test-project", VERTEX_LOCATION: "global", VERTEX_MODEL: "gemini-test" } as never;

afterEach(() => { vi.unstubAllGlobals(); });

describe("Vertex token refresh", () => {
  it("drops a token Google rejects with 401 and retries once with a fresh one", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization; seen.push(auth);
      if (seen.length === 1) return new Response(JSON.stringify({ error: { status: "UNAUTHENTICATED" } }), { status: 401 });
      return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{\"ok\":true}" }] } }] }), { status: 200 });
    }));
    const { generateVertexJson } = await import("./vertex-review");
    await expect(generateVertexJson(config, { system: "s", input: {}, schema: {} })).resolves.toEqual({ ok: true });
    expect(seen).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  it("does not loop: a second 401 is reported as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const { generateVertexJson } = await import("./vertex-review");
    await expect(generateVertexJson(config, { system: "s", input: {}, schema: {} })).rejects.toThrow("HTTP 401");
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
  });
});
