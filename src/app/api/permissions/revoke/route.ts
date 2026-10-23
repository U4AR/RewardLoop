import { getUser } from "../../../../lib/session";
import { revokePermission } from "../../../../server/flow";
import { assertAppMutationOrigin, errorResponse } from "../../../../server/http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    assertAppMutationOrigin(request);
    const result = await revokePermission(user.id, await request.json());
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
