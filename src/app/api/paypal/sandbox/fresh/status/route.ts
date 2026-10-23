import { getUser } from "../../../../../../lib/session";
import { freshCheckoutErrorResponse, freshCheckoutStatus } from "../../../../../../server/paypal-fresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    return Response.json(await freshCheckoutStatus(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return freshCheckoutErrorResponse(error); }
}
