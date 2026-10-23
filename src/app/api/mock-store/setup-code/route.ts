import { getUser } from "../../../../lib/session";
import { createStoreSetupCode, requireAppOrigin, storeErrorResponse } from "../../../../server/mock-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    requireAppOrigin(request);
    return Response.json(await createStoreSetupCode(user.id), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return storeErrorResponse(error); }
}
