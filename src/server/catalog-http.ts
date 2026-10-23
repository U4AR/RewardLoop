import { ZodError } from "zod";
import { getConfig } from "../config";
import { Channel3Catalog, Channel3Error } from "../integrations/channel3";
import { getUser } from "../lib/session";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** Authentication and same-origin guard shared by catalog POST routes. */
export async function withCatalog(
  request: Request,
  action: (catalog: Channel3Catalog, body: unknown) => Promise<unknown>,
): Promise<Response> {
  try {
    const user = await getUser();
    if (!user) return json({ error: "UNAUTHENTICATED" }, 401);

    const config = getConfig();
    if (request.headers.get("origin") !== new URL(config.APP_ORIGIN).origin) {
      return json({ error: "INVALID_ORIGIN" }, 403);
    }
    if (!config.CHANNEL3_API_KEY) {
      return json({ error: "CHANNEL3_NOT_CONFIGURED", message: "Catalog access is not configured" }, 503);
    }

    // These routes only accept tiny search/lookup requests; reject large bodies
    // before parsing to avoid storing or forwarding unbounded user content.
    const bodyText = await request.text();
    if (bodyText.length > 4096) return json({ error: "REQUEST_TOO_LARGE" }, 413);
    let body: unknown;
    try { body = JSON.parse(bodyText); }
    catch { return json({ error: "INVALID_JSON" }, 400); }

    const result = await action(new Channel3Catalog({ apiKey: config.CHANNEL3_API_KEY }), body);
    return json(result, 200);
  } catch (error) {
    if (error instanceof ZodError) {
      return json({ error: "INVALID_INPUT", fields: error.issues.map((issue) => issue.path.join(".")) }, 400);
    }
    if (error instanceof Channel3Error) {
      return json({ error: "CATALOG_UNAVAILABLE", message: "Catalog could not be reached or understood" }, 502);
    }
    if (error instanceof Error && /public (?:HTTP\(S\)|product) URL|valid public product URL/.test(error.message)) {
      return json({ error: "INVALID_PRODUCT_URL" }, 400);
    }
    console.error("Catalog route failed", error instanceof Error ? error.name : "unknown error");
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
