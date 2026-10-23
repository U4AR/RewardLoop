import { NextResponse, type NextRequest } from "next/server";

/**
 * The synthetic store shares the Next process but not the app's host or routes.
 * Store APIs still perform their own origin and synthetic-session checks.
 */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/_next/") || path === "/favicon.ico") return NextResponse.next();

  const configuredStore = process.env.MOCK_STORE_ORIGIN;
  const storeHost = configuredStore ? new URL(configuredStore).host : null;
  const requestHost = request.headers.get("host");
  const onStoreHost = Boolean(storeHost && requestHost === storeHost);
  const storePath = path === "/store" || path.startsWith("/store/") || path.startsWith("/api/store/");

  if (onStoreHost && storePath) return NextResponse.next();
  if (onStoreHost || storePath) {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.next();
}
