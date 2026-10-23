import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../config";
import {
  requireAppOrigin,
  requireConfiguredStoreOrigin,
  storeCookieHeader,
  storeCookieName,
} from "./mock-store";

vi.mock("../config", () => ({ getConfig: vi.fn() }));
vi.mock("../db/client", () => ({ getPool: vi.fn() }));

beforeEach(() => {
  vi.mocked(getConfig).mockReturnValue({
    APP_ORIGIN: "http://localhost:3000",
    MOCK_STORE_ORIGIN: "http://127.0.0.1:3000",
  } as ReturnType<typeof getConfig>);
});

function request(url: string, origin?: string) {
  const parsed = new URL(url);
  return new Request(url, { method: "POST", headers: { host: parsed.host, ...(origin ? { origin } : {}) } });
}

describe("synthetic store origin boundary", () => {
  it("allows the configured store host for its own POST", () => {
    expect(requireConfiguredStoreOrigin(request("http://127.0.0.1:3000/api/store/cart", "http://127.0.0.1:3000"), "POST").origin)
      .toBe("http://127.0.0.1:3000");
  });

  it("uses the browser Host when Next normalizes Request.url to the app origin", () => {
    const normalized = new Request("http://localhost:3000/api/store/cart", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    });
    expect(requireConfiguredStoreOrigin(normalized, "POST").origin).toBe("http://127.0.0.1:3000");
  });

  it("rejects store APIs on the app host and cross-origin store mutations", () => {
    expect(() => requireConfiguredStoreOrigin(request("http://localhost:3000/api/store/cart", "http://localhost:3000"), "POST"))
      .toThrow(/configured address/);
    expect(() => requireConfiguredStoreOrigin(request("http://127.0.0.1:3000/api/store/cart", "http://localhost:3000"), "POST"))
      .toThrow(/unapproved origin/);
  });

  it("requires app setup-code creation to come from the app host", () => {
    expect(() => requireAppOrigin(request("http://127.0.0.1:3000/api/mock-store/setup-code", "http://127.0.0.1:3000")))
      .toThrow(/unapproved origin/);
    expect(() => requireAppOrigin(request("http://localhost:3000/api/mock-store/setup-code", "http://localhost:3000")))
      .not.toThrow();
  });

  it("sets a host-only HTTP-only cookie and uses the browser-enforced __Host prefix on HTTPS", () => {
    const expires = new Date(Date.now() + 60_000);
    const header = storeCookieHeader("a".repeat(43), new URL("https://store.example.org"), expires);
    expect(storeCookieName(new URL("https://store.example.org"))).toBe("__Host-rewardloop_store");
    expect(header).toContain("; Path=/; HttpOnly; SameSite=Lax;");
    expect(header).toContain("; Secure");
    expect(header).not.toContain("Domain=");
  });
});
