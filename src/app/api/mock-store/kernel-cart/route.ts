import { getUser } from "../../../../lib/session";
import { assertAppMutationOrigin, errorResponse } from "../../../../server/http";
import { getKernelCartStatus, queueKernelCart } from "../../../../server/kernel-cart";
import { MockStoreError, storeErrorResponse } from "../../../../server/mock-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return Response.json(await getKernelCartStatus(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    assertAppMutationOrigin(request);
    const text = await request.text();
    if (text.length > 64) return Response.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
    if (text.trim() !== "{}") return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
    return Response.json(await queueKernelCart(user.id), { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return error instanceof MockStoreError ? storeErrorResponse(error) : errorResponse(error); }
}
