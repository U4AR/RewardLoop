import { getUser } from "../../../../../lib/session";
import { createSdkToken, requireWalletOrigin, walletErrorResponse } from "../../../../../server/paypal-wallet";

export const runtime = "nodejs";

/** Fresh short-lived PayPal ID token for the authenticated human wallet setup. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireWalletOrigin(request);
    const user = await getUser();
    if (!user) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    return Response.json(await createSdkToken(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return walletErrorResponse(error);
  }
}
