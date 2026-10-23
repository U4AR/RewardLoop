import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../config";
import { getUser } from "../lib/session";
import { POST as search } from "../app/api/rewards/search/route";
import { POST as lookup } from "../app/api/rewards/lookup/route";

vi.mock("../config", () => ({ getConfig: vi.fn() }));
vi.mock("../lib/session", () => ({ getUser: vi.fn() }));

function request(path: string, body: unknown, origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(getUser).mockResolvedValue({ id: "user-1" } as Awaited<ReturnType<typeof getUser>>);
  vi.mocked(getConfig).mockReturnValue({
    APP_ORIGIN: "http://localhost:3000",
    CHANNEL3_API_KEY: "test-key",
  } as ReturnType<typeof getConfig>);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("authenticated catalog routes", () => {
  it("refuses unauthenticated search before calling the provider", async () => {
    vi.mocked(getUser).mockResolvedValue(null);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await search(request("/api/rewards/search", { query: "study lamp" }));
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin mutation even with a session", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await lookup(request("/api/rewards/lookup", { url: "https://shop.example.org/item" }, "https://attacker.example.org"));
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports a missing key honestly without a fixture response", async () => {
    vi.mocked(getConfig).mockReturnValue({ APP_ORIGIN: "http://localhost:3000" } as ReturnType<typeof getConfig>);
    const response = await search(request("/api/rewards/search", { query: "study lamp" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "CHANNEL3_NOT_CONFIGURED" });
  });

  it("returns a normalized provider result with provenance and no-store", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      products: [{ id: "p1", title: "Study lamp", brands: [], images: [], offers: [{
        url: "https://buy.trychannel3.com/p1", domain: "shop.example.org",
        price: { price: 24.5, currency: "USD" }, availability: "InStock",
      }] }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await search(request("/api/rewards/search", { query: "study lamp" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      provenance: "channel3",
      products: [{ sourceProductId: "p1", offers: [{ observedPriceMinor: 2450 }] }],
    });
  });
});
