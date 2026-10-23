import { getUser } from "../../../../../../lib/session";
import { assertAppMutationOrigin, errorResponse } from "../../../../../../server/http";
import { DomainError } from "../../../../../../server/flow";
import { createFreshCheckoutOrder, freshCheckoutErrorResponse } from "../../../../../../server/paypal-fresh";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertAppMutationOrigin(request);
    const user = await getUser();
    if (!user) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    return Response.json(await createFreshCheckoutOrder(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return error instanceof DomainError ? errorResponse(error) : freshCheckoutErrorResponse(error); }
}
