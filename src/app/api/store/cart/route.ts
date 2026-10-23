import { z } from "zod";
import { getStoreCart, requireConfiguredStoreOrigin, requireStoreSession, saveStoreCart, storeErrorResponse } from "../../../../server/mock-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({ sku: z.string().min(1).max(100), destinationId: z.literal("demo-us-address") }).strict();

export async function GET(request: Request) {
  try {
    const origin = requireConfiguredStoreOrigin(request, "GET");
    const session = await requireStoreSession(request, origin);
    return Response.json({ ...(await getStoreCart(session.id)), accountLabel: session.accountLabel }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return storeErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const origin = requireConfiguredStoreOrigin(request, "POST");
    const session = await requireStoreSession(request, origin);
    const text = await request.text();
    if (text.length > 512) return Response.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch { return Response.json({ error: "INVALID_JSON" }, { status: 400 }); }
    const input = inputSchema.parse(raw);
    return Response.json({ ...(await saveStoreCart(session.id, input.sku)), accountLabel: session.accountLabel }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return storeErrorResponse(error); }
}
