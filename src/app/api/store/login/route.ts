import { z } from "zod";
import { redeemStoreSetupCode, requireConfiguredStoreOrigin, storeCookieHeader, storeErrorResponse } from "../../../../server/mock-store";

export const runtime = "nodejs";

const inputSchema = z.object({ setupCode: z.string().regex(/^[A-Za-z0-9_-]{24}$/) }).strict();

export async function POST(request: Request) {
  try {
    const origin = requireConfiguredStoreOrigin(request, "POST");
    const text = await request.text();
    if (text.length > 512) return Response.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch { return Response.json({ error: "INVALID_JSON" }, { status: 400 }); }
    const input = inputSchema.parse(raw);
    const session = await redeemStoreSetupCode(input.setupCode);
    return Response.json({ accountLabel: session.accountLabel, syntheticOnly: true }, {
      headers: { "Set-Cookie": storeCookieHeader(session.token, origin, session.expiresAt), "Cache-Control": "no-store" },
    });
  } catch (error) { return storeErrorResponse(error); }
}
