import { z } from "zod";
import { getUser } from "@/lib/session";
import { getConfig } from "@/config";
import { assertAppMutationOrigin } from "@/server/http";
import { archiveReward, checkoutReward, createRewardPlan, inspectReward, submitCheckin, workspaceError, workspaceState } from "@/server/workspace";
import { ensureShoppingSchema, authorizePurchase, cancelShoppingRun, finishRetailerSetup, reconcileShoppingRun, resumeShoppingRun, revokePurchase, saveShoppingSetup, shoppingState, startRetailerSetup, startShoppingRun } from "@/server/shopping";

export const runtime = "nodejs";
export const maxDuration = 90;
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return Response.json({ user: null, signupEnabled: getConfig().ALLOW_LOCAL_SIGNUP === "true" }, { status: 401, headers });
    await ensureShoppingSchema();
    return Response.json({ user: { name: user.name, email: user.email }, ...await workspaceState(user.id) }, { headers });
  } catch (error) { return workspaceError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return Response.json({ message: "Please sign in to continue." }, { status: 401, headers });
    assertAppMutationOrigin(request);
    const text = await request.text();
    // Photo and voice check-ins carry their media inline (about 8 MB at most); everything else stays small.
    if (text.length > 11_500_000) return Response.json({ message: "This photo or recording is too large. Try a shorter one." }, { status: 413, headers });
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return Response.json({ message: "The request could not be read." }, { status: 400, headers }); }
    const handlers = { create: createRewardPlan, checkin: submitCheckin, inspect: inspectReward, checkout: checkoutReward, archive: archiveReward,
      shopping: shoppingState, saveSetup: saveShoppingSetup, setupStart: startRetailerSetup, setupFinish: finishRetailerSetup,
      authorize: authorizePurchase, revoke: revokePurchase, shop: startShoppingRun, resume: resumeShoppingRun, cancelRun: cancelShoppingRun, reconcile: reconcileShoppingRun };
    const { action, input } = z.object({ action: z.enum(Object.keys(handlers) as [keyof typeof handlers, ...(keyof typeof handlers)[]]), input: z.unknown() }).strict().parse(raw);
    if (action !== "checkin" && text.length > 12000) return Response.json({ message: "This submission is too large." }, { status: 413, headers });
    await ensureShoppingSchema();
    return Response.json(await handlers[action](user.id, input), { headers });
  } catch (error) { return workspaceError(error); }
}
