import { getUser } from "../../../../lib/session";
import { bindStoreCart, storeErrorResponse } from "../../../../server/mock-store";
import { DomainError } from "../../../../server/flow";
import { assertAppMutationOrigin, errorResponse } from "../../../../server/http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    assertAppMutationOrigin(request);
    const text = await request.text();
    if (text.length > 512) return Response.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch { return Response.json({ error: "INVALID_JSON" }, { status: 400 }); }
    return Response.json(await bindStoreCart(user.id, raw), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return error instanceof DomainError ? errorResponse(error) : storeErrorResponse(error); }
}
