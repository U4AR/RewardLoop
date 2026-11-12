import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());
const request = (path: string, credentials?: string) => new NextRequest(`https://rewardloop.example${path}`, {
  headers: credentials ? { authorization: `Basic ${Buffer.from(credentials).toString("base64")}` } : undefined,
});

describe("store host routing", () => {
  const hostRequest = (host: string, path: string) => new NextRequest(`http://${host}${path}`, { headers: { host } });
  it("blocks app routes on the configured synthetic store host", () => {
    vi.stubEnv("MOCK_STORE_ORIGIN", "http://127.0.0.1:3000");
    expect(proxy(hostRequest("127.0.0.1:3000", "/api/state")).status).toBe(404);
    expect(proxy(hostRequest("127.0.0.1:3000", "/")).status).toBe(404);
  });
  it("blocks store routes on the app host while allowing the store host", () => {
    vi.stubEnv("MOCK_STORE_ORIGIN", "http://127.0.0.1:3000"); vi.stubEnv("DEMO_ACCESS_PASSCODE", "");
    expect(proxy(hostRequest("localhost:3000", "/store")).status).toBe(404);
    expect(proxy(hostRequest("127.0.0.1:3000", "/store")).status).toBe(200);
    expect(proxy(hostRequest("127.0.0.1:3000", "/api/store/cart")).status).toBe(200);
  });
});

describe("private demo access", () => {
  it("fails closed in production when the passcode is missing", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("DEMO_ACCESS_PASSCODE", "");
    expect(proxy(request("/")).status).toBe(503);
    expect(proxy(request("/api/workspace")).status).toBe(503);
    expect(proxy(request("/api/healthz")).status).toBe(200);
  });
  it("protects both pages and API routes while retaining the health probe", () => {
    vi.stubEnv("DEMO_ACCESS_PASSCODE", "test-passcode-with-enough-entropy");
    expect(proxy(request("/")).status).toBe(401);
    expect(proxy(request("/api/auth/sign-up/email")).status).toBe(401);
    expect(proxy(request("/api/healthz/extra")).status).toBe(401);
    expect(proxy(request("/api/healthz")).status).toBe(200);
  });
  it("accepts only the exact username and passcode, without replacing account authentication", () => {
    vi.stubEnv("DEMO_ACCESS_USER", "judges"); vi.stubEnv("DEMO_ACCESS_PASSCODE", "private:passcode");
    expect(proxy(request("/api/workspace", "judges:private:passcode")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(request("/", "demo:private:passcode")).status).toBe(401);
    expect(proxy(request("/", "judges:wrong")).status).toBe(401);
    expect(proxy(request("/", "judgesprivate:passcode")).status).toBe(401);
  });
});
