import { getUser } from "../../../lib/session";
import { getState } from "../../../server/flow";
import { errorResponse } from "../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    return Response.json(await getState(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

