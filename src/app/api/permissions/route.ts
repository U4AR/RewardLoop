import { getUser } from "../../../lib/session";
import { createPermission } from "../../../server/flow";
import { assertAppMutationOrigin, errorResponse } from "../../../server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    assertAppMutationOrigin(request);
    return Response.json(await createPermission(user.id, await request.json()), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
