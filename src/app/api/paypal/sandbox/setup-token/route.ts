import { getUser } from "../../../../../lib/session";
import { createSetupSession, requireWalletOrigin, walletErrorResponse } from "../../../../../server/paypal-wallet";

export const runtime = "nodejs";

/** The SDK's createVaultSetupToken callback calls this authenticated route. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireWalletOrigin(request);
    const user = await getUser();
    if (!user) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    return Response.json(await createSetupSession(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return walletErrorResponse(error);
  }
}
