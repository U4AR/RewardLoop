import { getUser } from "../../../../../lib/session";
import {
  exchangeApprovedSetupSession,
  readWalletJson,
  requireWalletOrigin,
  walletErrorResponse,
} from "../../../../../server/paypal-wallet";

export const runtime = "nodejs";

/** Complete the SDK onApprove exchange; never send the durable Vault ID to JS. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireWalletOrigin(request);
    const user = await getUser();
    if (!user) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    const body = await readWalletJson(request);
    return Response.json(await exchangeApprovedSetupSession(user.id, body), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return walletErrorResponse(error);
  }
}
