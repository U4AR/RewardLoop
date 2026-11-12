import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

function equal(actual: string, expected: string) {
  return timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest());
}

/** The demo passcode is an outer gate; Better Auth still enforces user sessions. */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/_next/") || path === "/favicon.ico") return NextResponse.next();
  // Retain the legacy synthetic store's separate-host boundary.
  const configuredStore = process.env.MOCK_STORE_ORIGIN;
  const storeHost = configuredStore ? new URL(configuredStore).host : null;
  const onStoreHost = Boolean(storeHost && request.headers.get("host") === storeHost);
  const storePath = path === "/store" || path.startsWith("/store/") || path.startsWith("/api/store/");
  if (onStoreHost !== storePath) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (path === "/api/healthz") return NextResponse.next();
  const passcode = process.env.DEMO_ACCESS_PASSCODE;
  if (!passcode) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Demo access is being configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Basic ") && authorization.length < 2048) {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const split = decoded.indexOf(":");
    if (split >= 0 && equal(decoded.slice(0, split), process.env.DEMO_ACCESS_USER || "demo") && equal(decoded.slice(split + 1), passcode)) {
      const response = NextResponse.next();
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
      return response;
    }
  }
  return new NextResponse("Enter the provided demo username and passcode, then sign in to your RewardLoop account.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="RewardLoop demo", charset="UTF-8"', "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
