import { getUser } from "../../../../../../lib/session";
import { assertAppMutationOrigin, errorResponse } from "../../../../../../server/http";
import { DomainError } from "../../../../../../server/flow";
import { captureFreshCheckoutOrder, freshCheckoutErrorResponse } from "../../../../../../server/paypal-fresh";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertAppMutationOrigin(request);
    const user = await getUser();
    if (!user) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    const raw: unknown = await request.json();
    const orderId = raw && typeof raw === "object" && !Array.isArray(raw) && "orderId" in raw ? raw.orderId : undefined;
    if (typeof orderId !== "string") return Response.json({ error: "ORDER_ID_INVALID" }, { status: 400 });
    return Response.json(await captureFreshCheckoutOrder(user.id, orderId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return error instanceof DomainError ? errorResponse(error) : freshCheckoutErrorResponse(error); }
}
