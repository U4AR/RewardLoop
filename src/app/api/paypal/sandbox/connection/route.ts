import { getUser } from "../../../../../lib/session";
import { getConfig } from "../../../../../config";
import { getPool } from "../../../../../db/client";
import { disconnectWallet, requireWalletOrigin, walletErrorResponse } from "../../../../../server/paypal-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read only a redacted local connection state; never return Vault IDs or buyer details. */
export async function GET(): Promise<Response> {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    const config = getConfig();
    const connected = await getPool().query(
      `SELECT 1 FROM payment_connections
       WHERE user_id = $1 AND environment = 'sandbox' AND status = 'ACTIVE' LIMIT 1`,
      [user.id],
    );
    return Response.json({
      status: connected.rowCount ? "CONNECTED" : "NOT_CONNECTED",
      environment: "sandbox",
      configured: Boolean(config.PAYPAL_SANDBOX_CLIENT_ID && config.PAYPAL_SANDBOX_CLIENT_SECRET && config.PAYPAL_SANDBOX_MERCHANT_ID),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return walletErrorResponse(error);
  }
}

/** Local revocation commits before the best-effort Sandbox token deletion. */
export async function DELETE(request: Request): Promise<Response> {
  try {
    requireWalletOrigin(request);
    const user = await getUser();
    if (!user) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    const result = await disconnectWallet(user.id);
    return Response.json(result, {
      status: result.providerDeletion === "PENDING" ? 202 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return walletErrorResponse(error);
  }
}
