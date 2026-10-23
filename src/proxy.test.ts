import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const before = process.env.MOCK_STORE_ORIGIN;
afterEach(() => { process.env.MOCK_STORE_ORIGIN = before; });

function request(host: string, path: string) {
  return new NextRequest(`http://${host}${path}`, { headers: { host } });
}

describe("store host routing", () => {
  it("blocks app routes on the configured synthetic store host", () => {
    process.env.MOCK_STORE_ORIGIN = "http://127.0.0.1:3000";
    expect(proxy(request("127.0.0.1:3000", "/api/state")).status).toBe(404);
    expect(proxy(request("127.0.0.1:3000", "/")).status).toBe(404);
  });

  it("blocks store routes on the app host while allowing the store host", () => {
    process.env.MOCK_STORE_ORIGIN = "http://127.0.0.1:3000";
    expect(proxy(request("localhost:3000", "/store")).status).toBe(404);
    expect(proxy(request("127.0.0.1:3000", "/store")).status).toBe(200);
    expect(proxy(request("127.0.0.1:3000", "/api/store/cart")).status).toBe(200);
  });
});
